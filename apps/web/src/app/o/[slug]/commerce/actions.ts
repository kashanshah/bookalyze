"use server";

import { AMAZON_REGIONS, isAmazonRegion } from "@bookalyze/core";
import {
  createConnection,
  disconnectAmazon,
  findAmazonConnection,
  getConnection,
  recordConnectionSync,
  saveAmazonChannels,
  schema,
  setChannelActive,
  setConnectionSecret,
  VaultError,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inOrg } from "@/server/accounting";
import { AmazonError, marketplaceParticipations } from "@/server/amazon";
import { audit } from "@/server/audit";
import {
  getCommerceContext,
  openAmazonCredentials,
  sealAmazonCredentials,
} from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";

export type CommerceResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string; errors?: Record<string, string> };

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/commerce`, "layout");
}

function failure(error: unknown): { ok: false; message: string } {
  if (error instanceof AmazonError) return { ok: false, message: error.message };
  if (error instanceof VaultError) {
    return {
      ok: false,
      message:
        "Connections aren't set up on this server yet: APP_ENCRYPTION_KEY is missing or invalid. See docs/SETUP.md.",
    };
  }
  throw error;
}

async function adminContext(slug: string) {
  const ctx = await getCommerceContext(slug);
  return {
    ctx,
    denied: isOrgAdmin(ctx)
      ? null
      : ({ ok: false, message: "Only owners and admins can manage connections." } as const),
  };
}

const connectSchema = z.object({
  region: z.string().refine(isAmazonRegion, "Choose a region."),
  clientId: z
    .string()
    .trim()
    .regex(
      /^amzn1\.application-oa2-client\.[\w.-]+$/,
      "This doesn't look like an LWA client ID (it starts with amzn1.application-oa2-client.).",
    ),
  clientSecret: z.string().trim().min(16, "Paste the client secret in full.").max(500),
  refreshToken: z
    .string()
    .trim()
    .regex(/^Atzr\|[\w|+/=-]+$/, "This doesn't look like a refresh token (it starts with Atzr|)."),
});

/**
 * Checks the app's credentials with Amazon, then saves them (sealed) and the marketplaces the
 * seller account sells in. One connection per region: connecting again replaces its credentials.
 */
export async function connectAmazonAction(
  slug: string,
  input: z.input<typeof connectSchema>,
): Promise<CommerceResult<{ channels: number }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  const { region, ...creds } = parsed.data;
  if (!isAmazonRegion(region)) return { ok: false, message: "Choose a region." };
  try {
    const marketplaces = await marketplaceParticipations(creds, region);
    const regionLabel = AMAZON_REGIONS.find((r) => r.key === region)?.label ?? region;
    const storeName = marketplaces.find((m) => m.storeName)?.storeName ?? null;
    await inOrg(ctx, async (tx) => {
      const existing = await findAmazonConnection(tx, region);
      const settings = { region, storeName };
      const id =
        existing?.id ??
        (
          await createConnection(tx, {
            orgId: ctx.org.id,
            userId: ctx.session.user.id,
            provider: "amazon_sp",
            name: `Amazon Seller Central · ${regionLabel}`,
            settings,
          })
        ).id;
      if (existing) {
        await tx
          .update(schema.connections)
          .set({ settings, status: "active" })
          .where(eq(schema.connections.id, id));
      }
      await setConnectionSecret(tx, id, sealAmazonCredentials(ctx.org.id, id, creds));
      await saveAmazonChannels(tx, { orgId: ctx.org.id, connectionId: id, marketplaces });
      await recordConnectionSync(tx, id, { at: new Date(), error: null });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: existing ? "connection.credentials_replaced" : "connection.created",
        entityType: "connection",
        entityId: id,
        after: { provider: "amazon_sp", region, marketplaces: marketplaces.map((m) => m.name) },
      });
    });
    revalidate(slug);
    return { ok: true, channels: marketplaces.filter((m) => m.participating).length };
  } catch (error) {
    return failure(error);
  }
}

/** Asks Amazon again with the saved credentials and refreshes the marketplaces. */
export async function testAmazonAction(
  slug: string,
  connectionId: string,
): Promise<CommerceResult<{ marketplaces: number }>> {
  const ctx = await getCommerceContext(slug);
  if (!z.string().uuid().safeParse(connectionId).success) {
    return { ok: false, message: "Unknown connection." };
  }
  const connection = await inOrg(ctx, (tx) => getConnection(tx, connectionId));
  const region = String(connection?.settings.region ?? "");
  if (connection?.provider !== "amazon_sp" || !connection.secret || !isAmazonRegion(region)) {
    return { ok: false, message: "This connection isn't active. Connect it again." };
  }
  let error: string | null = null;
  let count = 0;
  try {
    const creds = openAmazonCredentials(ctx.org.id, connectionId, connection.secret);
    const marketplaces = await marketplaceParticipations(creds, region);
    count = marketplaces.filter((m) => m.participating).length;
    await inOrg(ctx, (tx) =>
      saveAmazonChannels(tx, { orgId: ctx.org.id, connectionId, marketplaces }),
    );
  } catch (e) {
    if (!(e instanceof AmazonError) && !(e instanceof VaultError)) throw e;
    error = e.message;
  }
  await inOrg(ctx, (tx) => recordConnectionSync(tx, connectionId, { at: new Date(), error }));
  revalidate(slug);
  return error ? { ok: false, message: error } : { ok: true, marketplaces: count };
}

/** Switches a marketplace on or off (off: nothing is synced from it). */
export async function setChannelActiveAction(
  slug: string,
  channelId: string,
  isActive: boolean,
): Promise<CommerceResult> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(channelId).success)
    return { ok: false, message: "Unknown channel." };
  const row = await inOrg(ctx, async (tx) => {
    const updated = await setChannelActive(tx, channelId, isActive);
    if (updated) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: isActive ? "channel.switched_on" : "channel.switched_off",
        entityType: "sales_channel",
        entityId: channelId,
      });
    }
    return updated;
  });
  if (!row) return { ok: false, message: "This channel no longer exists." };
  revalidate(slug);
  return { ok: true };
}

/** Forgets the credentials; channels are switched off and keep their history. */
export async function disconnectAmazonAction(
  slug: string,
  connectionId: string,
): Promise<CommerceResult> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(connectionId).success) {
    return { ok: false, message: "Unknown connection." };
  }
  await inOrg(ctx, async (tx) => {
    await disconnectAmazon(tx, connectionId);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "connection.disconnected",
      entityType: "connection",
      entityId: connectionId,
    });
  });
  revalidate(slug);
  return { ok: true };
}
