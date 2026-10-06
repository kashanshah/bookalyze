"use server";

import { AMAZON_REGIONS, isAmazonRegion } from "@bookalyze/core";
import {
  amazonConnectionsForRegion,
  createConnection,
  disconnectAmazon,
  getConnection,
  listAmazonConnections,
  recordConnectionSync,
  saveAmazonChannels,
  schema,
  setChannelActive,
  setConnectionSecret,
  startOrderSync,
  VaultError,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { AmazonError, marketplaceParticipations, ownsOrder } from "@/server/amazon";
import { type OrderSyncResult, syncOrgOrders } from "@/server/amazon-orders";
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
 * seller account sells in. One connected account per region: connecting again replaces it.
 * The same seller account (Amazon can see an order brought in before) carries on with its
 * marketplaces and orders; a different one gets a connection of its own, and the previous
 * account's orders stay out of sight until that account is connected again.
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
    const candidates = await inOrg(ctx, (tx) => amazonConnectionsForRegion(tx, region));
    let existing: (typeof candidates)[number] | undefined;
    for (const c of candidates) {
      if (c.latestOrderId && (await ownsOrder(creds, region, c.latestOrderId))) {
        existing = c;
        break;
      }
    }
    // A connection with no orders has nothing to tell accounts apart by, or to show by mistake.
    existing ??= candidates.find((c) => !c.latestOrderId);
    await inOrg(ctx, async (tx) => {
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
      // Another seller account connected for the region is replaced by this one.
      for (const other of candidates) {
        if (other.id === id || other.status === "disconnected") continue;
        await disconnectAmazon(tx, other.id);
        await audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "connection.disconnected",
          entityType: "connection",
          entityId: other.id,
          after: { replacedBy: id },
        });
      }
      await setConnectionSecret(tx, id, sealAmazonCredentials(ctx.org.id, id, creds));
      await saveAmazonChannels(tx, {
        orgId: ctx.org.id,
        connectionId: id,
        marketplaces,
        reset: existing?.status === "disconnected",
      });
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

/** How long one "bring in orders" request may run; the screen calls again while there's more. */
const ORDER_SYNC_BUDGET_MS = 20_000;
/** Amazon keeps orders about two years back. */
const ORDERS_MAX_YEARS = 2;

/**
 * Starts bringing in orders from `from` on every switched-on marketplace (an earlier date reads
 * everything again from there). The sync itself runs with syncOrdersAction.
 */
export async function startOrdersAction(
  slug: string,
  from: string,
): Promise<CommerceResult<{ channels: number }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const today = nowIn(ctx.profile.timezone).date;
  const earliest = `${Number(today.slice(0, 4)) - ORDERS_MAX_YEARS}${today.slice(4)}`;
  if (!isIsoDate(from)) return { ok: false, message: "Choose a start date." };
  if (from > today) return { ok: false, message: "The start date can't be in the future." };
  if (from < earliest) {
    return {
      ok: false,
      message: "Amazon only keeps orders for about two years. Pick a later date.",
    };
  }
  const channels = await inOrg(ctx, async (tx) => {
    const ids = (await listAmazonConnections(tx))
      .filter((c) => c.status !== "disconnected")
      .flatMap((c) => c.channels.filter((ch) => ch.isActive).map((ch) => ch.id));
    await startOrderSync(tx, ids, from);
    if (ids.length) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "orders.sync_started",
        entityType: "organization",
        entityId: ctx.org.id,
        after: { from, channels: ids.length },
      });
    }
    return ids.length;
  });
  if (!channels) {
    return { ok: false, message: "Switch on a marketplace on the Channels page first." };
  }
  revalidate(slug);
  return { ok: true, channels };
}

/**
 * Brings in new and changed orders, then their items, for up to ~20 seconds. `more` says to call
 * again (a first sync of a busy account takes several calls: Amazon rations its answers).
 */
export async function syncOrdersAction(slug: string): Promise<CommerceResult<OrderSyncResult>> {
  const ctx = await getCommerceContext(slug);
  const result = await syncOrgOrders(
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    ORDER_SYNC_BUDGET_MS,
  );
  if (!result.channels) {
    return { ok: false, message: "No marketplace is bringing orders in yet." };
  }
  revalidate(slug);
  const { channels: _, ...rest } = result;
  return { ok: true, ...rest };
}
