"use server";

import { AMAZON_MARKETPLACES, CONNECTION_AREA } from "@bookalyze/core";
import { disconnectConnection, getChannel, listAmazonAdsConnections } from "@bookalyze/db";
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
import type { CommerceResult } from "./actions";

/** Amazon Ads on an Amazon channel's page: connect by consent, bring ads in now, disconnect. */

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
