"use server";

import {
  AMAZON_MARKETPLACES,
  CONNECTION_AREA,
  parseWalmartAdvertiserId,
  walmartMarketplace,
} from "@bookalyze/core";
import {
  createConnection,
  disconnectConnection,
  getChannel,
  listAmazonAdsConnections,
  listWalmartAdsConnections,
} from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { inOrg } from "@/server/accounting";
import {
  AMAZON_ADS_STATE_COOKIE,
  AmazonAdsError,
  amazonAdsApp,
  amazonAdsConsentLink,
  signAmazonAdsState,
} from "@/server/amazon-ads";
import { syncAmazonAdsConnection } from "@/server/amazon-ads-sync";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { checkWalmartAdvertiser, WalmartAdsError, walmartAdsApp } from "@/server/walmart-ads";
import { syncWalmartAdsConnection } from "@/server/walmart-ads-sync";
import type { CommerceResult } from "./actions";

/**
 * Amazon Ads on an Amazon channel's page (connect by consent, bring ads in now, disconnect), and
 * Walmart Connect on a Walmart channel's page (link an advertiser that gave Bookalyze access).
 */

async function adminContext(slug: string) {
  const ctx = await getCommerceContext(slug, CONNECTION_AREA);
  return {
    ctx,
    denied: isOrgAdmin(ctx)
      ? null
      : ({ ok: false, message: "Only owners and admins can manage connections." } as const),
  };
}

async function amazonChannel(ctx: Awaited<ReturnType<typeof getCommerceContext>>, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const channel = await inOrg(ctx, (tx) => getChannel(tx, id));
  if (channel?.kind !== "amazon") return null;
  const region = AMAZON_MARKETPLACES.find((m) => m.id === channel.marketplaceId)?.region;
  return region ? { channel, region } : null;
}

/** Sends the admin to Amazon's consent page for the channel's Ads region. */
export async function startAmazonAdsConnectAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult<{ url: string }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  if (!amazonAdsApp()) {
    return {
      ok: false,
      message:
        "Amazon Ads isn't set up on this server yet: its Amazon Ads app keys are missing (docs/SETUP.md → Amazon Ads).",
    };
  }
  const found = await amazonChannel(ctx, channelId);
  if (!found) return { ok: false, message: "Unknown channel." };
  const { state, nonce } = signAmazonAdsState({
    slug,
    channelId,
    userId: ctx.session.user.id,
    region: found.region,
  });
  (await cookies()).set(AMAZON_ADS_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/amazon-ads",
    maxAge: 10 * 60,
  });
  return { ok: true, url: amazonAdsConsentLink(found.region, state) };
}

/**
 * Asks Amazon for this channel's latest ad spend and waits up to about 45 seconds for the
 * reports; what isn't ready by then comes in with the next run (every few minutes).
 */
export async function syncAmazonAdsAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult<{ collected: number; rows: number; pending: number }>> {
  const ctx = await getCommerceContext(slug, CONNECTION_AREA);
  const found = await amazonChannel(ctx, channelId);
  if (!found) return { ok: false, message: "Unknown channel." };
  const connection = (await inOrg(ctx, (tx) => listAmazonAdsConnections(tx))).find(
    (c) => c.settings.region === found.region && c.hasSecret && c.status !== "disconnected",
  );
  if (!connection) return { ok: false, message: "Amazon Ads isn't connected. Connect it first." };
  const deadline = Date.now() + 45_000;
  const total = { collected: 0, rows: 0, pending: 0 };
  try {
    let first = true;
    for (;;) {
      const r = await syncAmazonAdsConnection(
        { orgId: ctx.org.id, userId: ctx.session.user.id },
        connection.id,
        { requestNew: first, channelId, deadline },
      );
      first = false;
      if (r.error) return { ok: false, message: r.error };
      total.collected += r.collected;
      total.rows += r.rows;
      total.pending = r.pending;
      if (!r.pending || Date.now() + 5_000 > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  } catch (error) {
    if (error instanceof AmazonAdsError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(`/o/${slug}/commerce`, "layout");
  return { ok: true, ...total };
}

/** Forgets the Ads account's sign-in. Ad spend already brought in stays. */
export async function disconnectAmazonAdsAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const found = await amazonChannel(ctx, channelId);
  if (!found) return { ok: false, message: "Unknown channel." };
  const done = await inOrg(ctx, async (tx) => {
    const connection = (await listAmazonAdsConnections(tx)).find(
      (c) => c.settings.region === found.region && c.status !== "disconnected",
    );
    if (!connection) return false;
    await disconnectConnection(tx, connection.id);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "connection.disconnected",
      entityType: "connection",
      entityId: connection.id,
      after: { provider: "amazon_ads", region: found.region },
    });
    return true;
  });
  if (!done) return { ok: false, message: "Amazon Ads isn't connected." };
  revalidatePath(`/o/${slug}/commerce`, "layout");
  return { ok: true };
}

// --- Walmart Connect -----------------------------------------------------------------------

async function walmartChannel(ctx: Awaited<ReturnType<typeof getCommerceContext>>, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const channel = await inOrg(ctx, (tx) => getChannel(tx, id));
  return channel?.kind === "walmart" && walmartMarketplace(channel.marketplaceId ?? "")
    ? channel
    : null;
}

/** The channel's live Walmart Connect advertiser, if one is linked. */
async function walmartAdsConnection(
  ctx: Awaited<ReturnType<typeof getCommerceContext>>,
  channelId: string,
) {
  return (await inOrg(ctx, (tx) => listWalmartAdsConnections(tx))).find(
    (c) => c.settings.channelId === channelId && c.status !== "disconnected",
  );
}

/**
 * Links a Walmart Connect advertiser to a Walmart channel, once Walmart confirms Bookalyze can
 * read it (the advertiser added Bookalyze as an API partner in Ad Center). Then brings its ads in.
 */
export async function connectWalmartAdsAction(
  slug: string,
  channelId: string,
  input: { advertiserId: string },
): Promise<CommerceResult<{ campaigns: number }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  if (!walmartAdsApp()) {
    return {
      ok: false,
      message:
        "Walmart Connect isn't set up on this server yet: Bookalyze's partner keys are missing (docs/SETUP.md → Walmart Connect).",
    };
  }
  const channel = await walmartChannel(ctx, channelId);
  if (!channel) return { ok: false, message: "Unknown channel." };
  const advertiserId = parseWalmartAdvertiserId(String(input.advertiserId ?? ""));
  if (!advertiserId) {
    return {
      ok: false,
      message: "Enter the advertiser ID: the number Ad Center shows (digits only).",
    };
  }
  if (await walmartAdsConnection(ctx, channelId)) {
    return { ok: false, message: "An advertiser is already linked. Disconnect it first." };
  }
  let campaigns: number;
  try {
    campaigns = await checkWalmartAdvertiser(advertiserId);
  } catch (error) {
    if (error instanceof WalmartAdsError) return { ok: false, message: error.message };
    throw error;
  }
  const connection = await inOrg(ctx, async (tx) => {
    const saved = await createConnection(tx, {
      orgId: ctx.org.id,
      userId: ctx.session.user.id,
      provider: "walmart_ads",
      name: `Walmart Connect · ${advertiserId}`,
      settings: { advertiserId, channelId },
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "connection.created",
      entityType: "connection",
      entityId: saved.id,
      after: { provider: "walmart_ads", advertiserId, channelId, campaigns },
    });
    return saved;
  });
  // The first window is asked for at once; it comes in with "Bring in ads now" or the next run.
  await syncWalmartAdsConnection(
    { orgId: ctx.org.id, userId: ctx.session.user.id },
    connection.id,
    { requestNew: true, deadline: Date.now() + 15_000 },
  ).catch(() => null);
  revalidatePath(`/o/${slug}/commerce`, "layout");
  return { ok: true, campaigns };
}

/**
 * Asks Walmart Connect for this channel's latest ad spend and waits up to about 45 seconds for
 * the report; what isn't ready by then comes in with the next run (every few minutes).
 */
export async function syncWalmartAdsAction(
  slug: string,
  channelId: string,
): Promise<
  CommerceResult<{ collected: number; rows: number; pending: number; unmatched: number }>
> {
  const ctx = await getCommerceContext(slug, CONNECTION_AREA);
  const channel = await walmartChannel(ctx, channelId);
  if (!channel) return { ok: false, message: "Unknown channel." };
  const connection = await walmartAdsConnection(ctx, channelId);
  if (!connection) return { ok: false, message: "Walmart Connect isn't linked. Link it first." };
  const deadline = Date.now() + 45_000;
  const total = { collected: 0, rows: 0, pending: 0, unmatched: 0 };
  let first = true;
  for (;;) {
    const r = await syncWalmartAdsConnection(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      connection.id,
      { requestNew: first, deadline },
    );
    first = false;
    if (r.error) return { ok: false, message: r.error };
    total.collected += r.collected;
    total.rows += r.rows;
    total.unmatched += r.unmatched;
    total.pending = r.pending;
    if (!r.pending || Date.now() + 5_000 > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  revalidatePath(`/o/${slug}/commerce`, "layout");
  return { ok: true, ...total };
}

/** Unlinks the advertiser. Ad spend already brought in stays. */
export async function disconnectWalmartAdsAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const channel = await walmartChannel(ctx, channelId);
  if (!channel) return { ok: false, message: "Unknown channel." };
  const connection = await walmartAdsConnection(ctx, channelId);
  if (!connection) return { ok: false, message: "Walmart Connect isn't linked." };
  await inOrg(ctx, async (tx) => {
    await disconnectConnection(tx, connection.id);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "connection.disconnected",
      entityType: "connection",
      entityId: connection.id,
      after: { provider: "walmart_ads", advertiserId: connection.settings.advertiserId ?? null },
    });
  });
  revalidatePath(`/o/${slug}/commerce`, "layout");
  return { ok: true };
}
