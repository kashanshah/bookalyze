"use server";

import {
  AMAZON_REGIONS,
  addDaysIso,
  CONNECTION_AREA,
  ebayMarketplace,
  FULFILMENT_MODES,
  isAmazonRegion,
  missingWalmartAccess,
  NOON_FULFILMENT,
  NOON_INPUT_NAME,
  NOON_TRANSACTIONS_EXPORT,
  type NoonExportCategory,
  noonMarketplace,
  noonReportParams,
  parseNoonKeyFile,
  parseWalmartCredentials,
  previewReport,
  type ReportPreview,
  WALMART_FULFILMENT,
  walmartMarketplace,
} from "@bookalyze/core";
import {
  addEbayChannel,
  addNoonChannel,
  addWalmartChannel,
  amazonConnectionsForRegion,
  attachNoonChannels,
  attachWalmartChannel,
  ChannelRemovalError,
  createConnection,
  disconnectAmazon,
  disconnectEbay,
  disconnectNoon,
  disconnectWalmart,
  getChannel,
  getConnection,
  getEbayConnection,
  getNoonConnection,
  getWalmartConnection,
  listAmazonConnections,
  listOrderConnections,
  recordConnectionSync,
  removeChannel,
  saveAmazonChannels,
  schema,
  setChannelActive,
  setChannelFulfilment,
  setConnectionSecret,
  startOrderSync,
  VaultError,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { isIsoDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { AmazonError, ownsOrder, resolveAmazonAccount } from "@/server/amazon";
import { type OrderSyncResult, syncOrgOrders } from "@/server/amazon-orders";
import { audit } from "@/server/audit";
import {
  getCommerceContext,
  openAmazonCredentials,
  openNoonCredentials,
  openWalmartCredentials,
  sealAmazonCredentials,
  sealNoonCredentials,
  sealWalmartCredentials,
} from "@/server/commerce";
import {
  EBAY_STATE_COOKIE,
  EbayError,
  ebayAccessToken,
  ebayApp,
  ebayConsentLink,
  getEbayUser,
  openEbayCredentials,
  signEbayState,
} from "@/server/ebay";
import { logError, logInfo, logWarn } from "@/server/log";
import {
  checkNoonKey,
  createNoonExport,
  downloadNoonExport,
  NoonError,
  noonExportStatus,
} from "@/server/noon";
import { isOrgAdmin } from "@/server/org";
import {
  checkWalmartKey,
  downloadWalmartSettlement,
  WalmartError,
  walmartSettlementDates,
} from "@/server/walmart";
import { bringInWfsStock } from "@/server/walmart-inventory";
import { bringInWalmartSettlements } from "@/server/walmart-settlements";

export type CommerceResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string; errors?: Record<string, string> };

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/commerce`, "layout");
}

function failure(error: unknown): { ok: false; message: string } {
  if (
    error instanceof AmazonError ||
    error instanceof NoonError ||
    error instanceof EbayError ||
    error instanceof WalmartError
  ) {
    return { ok: false, message: error.message };
  }
  if (error instanceof VaultError) {
    logError("vault.unavailable", error, { area: "commerce" });
    return {
      ok: false,
      message:
        "Connections aren't set up on this server yet: APP_ENCRYPTION_KEY is missing or invalid. See docs/SETUP.md.",
    };
  }
  throw error;
}

/** Connection and order actions pass CONNECTION_AREA: Review requests only may use them. */
async function adminContext(slug: string, area?: typeof CONNECTION_AREA) {
  const ctx = await getCommerceContext(slug, area);
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
): Promise<
  CommerceResult<{ channels: number; regionLabel: string; moved: boolean; connectionId: string }>
> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      errors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  const { region: chosen, ...creds } = parsed.data;
  if (!isAmazonRegion(chosen)) return { ok: false, message: "Choose a region." };
  try {
    const account = await resolveAmazonAccount(creds, chosen);
    const { region, marketplaces } = account;
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
    const connectionId = await inOrg(ctx, async (tx) => {
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
      return id;
    });
    revalidate(slug);
    return {
      ok: true,
      channels: marketplaces.filter((m) => m.participating).length,
      regionLabel,
      moved: region !== chosen,
      connectionId,
    };
  } catch (error) {
    return failure(error);
  }
}

/** Asks Amazon again with the saved credentials and refreshes the marketplaces. */
export async function testAmazonAction(
  slug: string,
  connectionId: string,
): Promise<CommerceResult<{ marketplaces: number }>> {
  const ctx = await getCommerceContext(slug, CONNECTION_AREA);
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
    const account = await resolveAmazonAccount(creds, region);
    if (account.region !== region) {
      const actual = AMAZON_REGIONS.find((r) => r.key === account.region)?.label ?? account.region;
      const chosen = AMAZON_REGIONS.find((r) => r.key === region)?.label ?? region;
      error = `These credentials are for ${actual}, and this connection is ${chosen}. Replace them and choose ${actual}.`;
    } else {
      const marketplaces = account.marketplaces;
      count = marketplaces.filter((m) => m.participating).length;
      await inOrg(ctx, (tx) =>
        saveAmazonChannels(tx, { orgId: ctx.org.id, connectionId, marketplaces }),
      );
    }
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
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
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

/**
 * Removes a Noon country or eBay site added by mistake, with everything brought in for it, while
 * nothing of it is in the books (db `removeChannel` checks).
 */
export async function removeChannelAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult<{ name: string }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(channelId).success)
    return { ok: false, message: "Unknown channel." };
  try {
    const removed = await inOrg(ctx, async (tx) => {
      const channel = await removeChannel(tx, channelId);
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "channel.removed",
        entityType: "sales_channel",
        entityId: channelId,
        before: { name: channel.name, kind: channel.kind },
      });
      return channel;
    });
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true, name: removed.name };
  } catch (e) {
    if (e instanceof ChannelRemovalError) return { ok: false, message: e.message };
    throw e;
  }
}

const noonChannelSchema = z.object({
  marketplace: z.string().refine((v) => noonMarketplace(v) !== null, "Choose a Noon country."),
  fulfilment: z.enum(FULFILMENT_MODES, { message: "Choose who ships the orders." }),
});

/** Adds a Noon country as a channel (or switches one added before back on). */
export async function addNoonChannelAction(
  slug: string,
  input: unknown,
): Promise<CommerceResult<{ name: string; created: boolean; channelId: string }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const parsed = noonChannelSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  const marketplace = noonMarketplace(parsed.data.marketplace);
  if (!marketplace) return { ok: false, message: "Choose a Noon country." };
  const result = await inOrg(ctx, async (tx) => {
    const added = await addNoonChannel(tx, {
      orgId: ctx.org.id,
      marketplace,
      fulfilment: parsed.data.fulfilment,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: added.created ? "channel.added" : "channel.switched_on",
      entityType: "sales_channel",
      entityId: added.channel.id,
      after: { name: marketplace.name, fulfilment: parsed.data.fulfilment },
    });
    return added;
  });
  revalidate(slug);
  return {
    ok: true,
    name: marketplace.name,
    created: result.created,
    channelId: result.channel.id,
  };
}

/** Adds an eBay site as a channel (or switches one added before back on). */
export async function addEbayChannelAction(
  slug: string,
  input: unknown,
): Promise<CommerceResult<{ name: string; created: boolean; channelId: string }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const parsed = z
    .object({
      marketplace: z.string().refine((v) => ebayMarketplace(v) !== null, "Choose an eBay site."),
    })
    .safeParse(input);
  const marketplace = parsed.success ? ebayMarketplace(parsed.data.marketplace) : null;
  if (!marketplace) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      errors: { marketplace: "Choose an eBay site." },
    };
  }
  const result = await inOrg(ctx, async (tx) => {
    const added = await addEbayChannel(tx, { orgId: ctx.org.id, marketplace });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: added.created ? "channel.added" : "channel.switched_on",
      entityType: "sales_channel",
      entityId: added.channel.id,
      after: { name: marketplace.name },
    });
    return added;
  });
  revalidate(slug);
  return {
    ok: true,
    name: marketplace.name,
    created: result.created,
    channelId: result.channel.id,
  };
}

const walmartChannelSchema = z.object({
  marketplace: z
    .string()
    .refine((v) => walmartMarketplace(v) !== null, "Choose a Walmart country."),
  fulfilment: z.enum(FULFILMENT_MODES, { message: "Choose who ships the orders." }),
});

/** Adds a Walmart country as a channel (or switches one added before back on). */
export async function addWalmartChannelAction(
  slug: string,
  input: unknown,
): Promise<CommerceResult<{ name: string; created: boolean; channelId: string }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const parsed = walmartChannelSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, message: "Check the highlighted fields.", errors };
  }
  const marketplace = walmartMarketplace(parsed.data.marketplace);
  if (!marketplace) return { ok: false, message: "Choose a Walmart country." };
  const result = await inOrg(ctx, async (tx) => {
    const added = await addWalmartChannel(tx, {
      orgId: ctx.org.id,
      marketplace,
      fulfilment: parsed.data.fulfilment,
    });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: added.created ? "channel.added" : "channel.switched_on",
      entityType: "sales_channel",
      entityId: added.channel.id,
      after: { name: marketplace.name, fulfilment: parsed.data.fulfilment },
    });
    return added;
  });
  revalidate(slug);
  return {
    ok: true,
    name: marketplace.name,
    created: result.created,
    channelId: result.channel.id,
  };
}

// --- eBay ------------------------------------------------------------------------------------

/**
 * Starts connecting the company's eBay account from one of its eBay sites: returns eBay's
 * consent page, with a signed state that comes back to the callback (and a cookie tying it to
 * this browser).
 */
export async function startEbayConnectAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult<{ url: string }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  if (!z.string().uuid().safeParse(channelId).success) {
    return { ok: false, message: "Unknown channel." };
  }
  if (!ebayApp()) {
    return {
      ok: false,
      message:
        "eBay isn't set up on this server yet: its eBay app keys are missing (docs/SETUP.md → eBay).",
    };
  }
  const channel = await inOrg(ctx, (tx) => getChannel(tx, channelId));
  if (!channel || channel.kind !== "ebay") return { ok: false, message: "Unknown channel." };
  const { state, nonce } = signEbayState({ slug, channelId, userId: ctx.session.user.id });
  (await cookies()).set(EBAY_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/ebay",
    maxAge: 10 * 60,
  });
  return { ok: true, url: ebayConsentLink(state) };
}

/** Asks eBay again with the saved sign-in: a fresh access token, and who the account is. */
export async function testEbayAction(slug: string): Promise<CommerceResult<{ username: string }>> {
  const ctx = await getCommerceContext(slug, CONNECTION_AREA);
  const connection = await inOrg(ctx, async (tx) => {
    const found = await getEbayConnection(tx);
    return found ? getConnection(tx, found.id) : null;
  });
  if (!connection?.secret || connection.status === "disconnected") {
    return { ok: false, message: "eBay isn't connected. Connect eBay first." };
  }
  let error: string | null = null;
  let username = "";
  try {
    const creds = openEbayCredentials(ctx.org.id, connection.id, connection.secret);
    const user = await getEbayUser(await ebayAccessToken(creds.refreshToken, true));
    username = user.username;
    await inOrg(ctx, (tx) =>
      tx
        .update(schema.connections)
        .set({
          settings: { ...connection.settings, username: user.username, userId: user.userId },
          name: `eBay · ${user.username}`,
        })
        .where(eq(schema.connections.id, connection.id)),
    );
  } catch (e) {
    error = failure(e).message;
  }
  await inOrg(ctx, (tx) => recordConnectionSync(tx, connection.id, { at: new Date(), error }));
  revalidate(slug);
  return error ? { ok: false, message: error } : { ok: true, username };
}

/** Deletes the eBay sign-in. The eBay sites stay, with everything brought in. */
export async function disconnectEbayAction(slug: string): Promise<CommerceResult> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const done = await inOrg(ctx, async (tx) => {
    const connection = await getEbayConnection(tx);
    if (!connection || connection.status === "disconnected") return false;
    await disconnectEbay(tx, connection.id);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "connection.disconnected",
      entityType: "connection",
      entityId: connection.id,
      after: { provider: "ebay" },
    });
    return true;
  });
  if (!done) return { ok: false, message: "eBay isn't connected." };
  revalidate(slug);
  return { ok: true };
}

/** Who ships a channel's orders (Noon: FBN, FBP or both; Walmart: WFS, the seller or both). */
export async function setChannelFulfilmentAction(
  slug: string,
  channelId: string,
  fulfilment: string,
): Promise<CommerceResult<{ label: string }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const parsed = z
    .object({ channelId: z.string().uuid(), fulfilment: z.enum(FULFILMENT_MODES) })
    .safeParse({ channelId, fulfilment });
  if (!parsed.success) return { ok: false, message: "Choose who ships the orders." };
  const row = await inOrg(ctx, async (tx) => {
    const updated = await setChannelFulfilment(tx, parsed.data.channelId, parsed.data.fulfilment);
    if (updated) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "channel.fulfilment_changed",
        entityType: "sales_channel",
        entityId: updated.id,
        after: { fulfilment: parsed.data.fulfilment },
      });
    }
    return updated;
  });
  if (!row) return { ok: false, message: "This channel no longer exists." };
  revalidate(slug);
  const labels = row.kind === "walmart" ? WALMART_FULFILMENT : NOON_FULFILMENT;
  return { ok: true, label: labels[parsed.data.fulfilment].label };
}

/** Forgets the credentials; channels are switched off and keep their history. */
export async function disconnectAmazonAction(
  slug: string,
  connectionId: string,
): Promise<CommerceResult> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
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
/** Amazon and eBay keep orders about two years back. */
const ORDERS_MAX_YEARS = 2;

/**
 * Starts bringing in orders from `from` on every switched-on marketplace (an earlier date reads
 * everything again from there). The sync itself runs with syncOrdersAction.
 */
export async function startOrdersAction(
  slug: string,
  from: string,
): Promise<CommerceResult<{ channels: number }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const today = nowIn(ctx.profile.timezone).date;
  const earliest = `${Number(today.slice(0, 4)) - ORDERS_MAX_YEARS}${today.slice(4)}`;
  if (!isIsoDate(from)) return { ok: false, message: "Choose a start date." };
  if (from > today) return { ok: false, message: "The start date can't be in the future." };
  if (from < earliest) {
    return {
      ok: false,
      message: "Marketplaces only keep orders for about two years. Pick a later date.",
    };
  }
  const channels = await inOrg(ctx, async (tx) => {
    const ids = (await listOrderConnections(tx)).channels.map((ch) => ch.id);
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
 * "Bring theirs in too": starts only the switched-on marketplaces that aren't bringing orders in
 * yet, from the date the others started (no further back than marketplaces keep orders). The
 * marketplaces already bringing orders in keep their own start date.
 */
export async function includeOrderChannelsAction(
  slug: string,
): Promise<CommerceResult<{ channels: number; from: string }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const today = nowIn(ctx.profile.timezone).date;
  const earliest = `${Number(today.slice(0, 4)) - ORDERS_MAX_YEARS}${today.slice(4)}`;
  const started = await inOrg(ctx, async (tx) => {
    const channels = (await listOrderConnections(tx)).channels;
    const fresh = channels.filter((ch) => !ch.ordersFrom).map((ch) => ch.id);
    const first = channels
      .map((ch) => ch.ordersFrom)
      .filter((d): d is string => Boolean(d))
      .sort()[0];
    const from = !first ? today : first < earliest ? earliest : first;
    await startOrderSync(tx, fresh, from);
    if (fresh.length) {
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "orders.sync_started",
        entityType: "organization",
        entityId: ctx.org.id,
        after: { from, channels: fresh.length },
      });
    }
    return { channels: fresh.length, from };
  });
  if (!started.channels) {
    return { ok: false, message: "Every switched-on marketplace is already bringing orders in." };
  }
  revalidate(slug);
  return { ok: true, ...started };
}

/**
 * Brings in new and changed orders, then their items, for up to ~20 seconds. `more` says to call
 * again (a first sync of a busy account takes several calls: Amazon rations its answers).
 */
export async function syncOrdersAction(slug: string): Promise<CommerceResult<OrderSyncResult>> {
  const ctx = await getCommerceContext(slug, CONNECTION_AREA);
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

// --- Noon's API ------------------------------------------------------------------------------

/** What's kept (not secret) about a Noon connection: its project and the reports it can get. */
function noonSettings(projectCode: string, categories: NoonExportCategory[]) {
  return {
    projectCode,
    reports: categories.map((c) => c.code).slice(0, 200),
    payoutsReport: categories.some((c) => c.code === NOON_TRANSACTIONS_EXPORT),
    /** The payouts report's inputs as Noon describes them (names and types). */
    payoutsParams: categories.find((c) => c.code === NOON_TRANSACTIONS_EXPORT)?.spec ?? null,
    /** Every report's inputs, for checking any of them. */
    reportParams: Object.fromEntries(categories.slice(0, 200).map((c) => [c.code, c.spec])),
  };
}

/**
 * Checks a service-account key file with Noon (signs in, lists the reports it can download),
 * then saves it sealed and puts the company's Noon channels on it. One Noon connection per
 * company: connecting again replaces the key. The file's text is read in the browser and sent
 * here once; it's never stored as it came.
 */
export async function connectNoonAction(
  slug: string,
  input: unknown,
): Promise<CommerceResult<{ reports: number; payoutsReport: boolean; replaced: boolean }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const parsed = z.object({ keyFile: z.string().max(20_000) }).safeParse(input);
  if (!parsed.success || !parsed.data.keyFile.trim()) {
    return {
      ok: false,
      message: "Choose the key file.",
      errors: { keyFile: "Choose the .json key file Noon downloaded." },
    };
  }
  let creds: ReturnType<typeof parseNoonKeyFile>;
  try {
    creds = parseNoonKeyFile(parsed.data.keyFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : "This isn't a Noon key file.";
    return { ok: false, message, errors: { keyFile: message } };
  }
  try {
    const categories = await checkNoonKey(creds);
    const settings = noonSettings(creds.projectCode, categories);
    const replaced = await inOrg(ctx, async (tx) => {
      const existing = await getNoonConnection(tx);
      const id =
        existing?.id ??
        (
          await createConnection(tx, {
            orgId: ctx.org.id,
            userId: ctx.session.user.id,
            provider: "noon",
            name: "Noon",
            settings,
          })
        ).id;
      if (existing) {
        await tx
          .update(schema.connections)
          .set({ settings, status: "active" })
          .where(eq(schema.connections.id, id));
      }
      await setConnectionSecret(tx, id, sealNoonCredentials(ctx.org.id, id, creds));
      await attachNoonChannels(tx, id);
      await recordConnectionSync(tx, id, { at: new Date(), error: null });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: existing ? "connection.credentials_replaced" : "connection.created",
        entityType: "connection",
        entityId: id,
        after: {
          provider: "noon",
          projectCode: creds.projectCode,
          reports: settings.reports.length,
        },
      });
      return Boolean(existing && existing.status !== "disconnected");
    });
    revalidate(slug);
    return {
      ok: true,
      reports: categories.length,
      payoutsReport: settings.payoutsReport,
      replaced,
    };
  } catch (error) {
    return failure(error);
  }
}

/** Signs in to Noon again with the saved key and refreshes the reports it can download. */
export async function testNoonAction(
  slug: string,
): Promise<CommerceResult<{ reports: number; payoutsReport: boolean }>> {
  const ctx = await getCommerceContext(slug, CONNECTION_AREA);
  const connection = await inOrg(ctx, async (tx) => {
    const found = await getNoonConnection(tx);
    return found ? getConnection(tx, found.id) : null;
  });
  if (!connection?.secret || connection.status === "disconnected") {
    return { ok: false, message: "Noon isn't connected. Upload the key file first." };
  }
  let error: string | null = null;
  let result = { reports: 0, payoutsReport: false };
  try {
    const creds = openNoonCredentials(ctx.org.id, connection.id, connection.secret);
    const categories = await checkNoonKey(creds);
    const settings = noonSettings(creds.projectCode, categories);
    result = { reports: categories.length, payoutsReport: settings.payoutsReport };
    await inOrg(ctx, (tx) =>
      tx
        .update(schema.connections)
        .set({ settings })
        .where(eq(schema.connections.id, connection.id)),
    );
  } catch (e) {
    const failed = failure(e);
    error = failed.message;
  }
  await inOrg(ctx, (tx) => recordConnectionSync(tx, connection.id, { at: new Date(), error }));
  revalidate(slug);
  return error ? { ok: false, message: error } : { ok: true, ...result };
}

/** Forgets Noon's key; the Noon channels and everything brought in stay. */
export async function disconnectNoonAction(slug: string): Promise<CommerceResult> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const done = await inOrg(ctx, async (tx) => {
    const connection = await getNoonConnection(tx);
    if (!connection || connection.status === "disconnected") return false;
    await disconnectNoon(tx, connection.id);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "connection.disconnected",
      entityType: "connection",
      entityId: connection.id,
      after: { provider: "noon" },
    });
    return true;
  });
  if (!done) return { ok: false, message: "Noon isn't connected." };
  revalidate(slug);
  return { ok: true };
}

export type NoonReportCheck =
  | { state: "working"; exportCode: string; status: string; from: string; to: string }
  | {
      state: "ready";
      exportCode: string;
      status: string;
      from: string;
      to: string;
      preview: ReportPreview;
    };

/**
 * Checks one of the reports the key can download end to end without keeping anything: asks for
 * the last 7 days (when the report takes dates), waits for it (about 25 s per call; the page
 * calls again with the export's code while Noon is still making it), downloads it and returns
 * only its kind, column names and row count.
 */
export async function checkNoonReportAction(
  slug: string,
  input: unknown,
): Promise<CommerceResult<{ check: NoonReportCheck }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const parsed = z
    .object({
      category: z.string().trim().min(1).max(200),
      exportCode: z.string().trim().max(200).optional(),
      from: z.string().refine(isIsoDate).optional(),
      to: z.string().refine(isIsoDate).optional(),
      inputs: z
        .record(z.string().regex(NOON_INPUT_NAME), z.string().trim().max(200))
        .refine((r) => Object.keys(r).length <= 20)
        .optional(),
    })
    .safeParse(input ?? {});
  if (!parsed.success) return { ok: false, message: "Start the check again." };
  const connection = await inOrg(ctx, async (tx) => {
    const found = await getNoonConnection(tx);
    return found ? getConnection(tx, found.id) : null;
  });
  if (!connection?.secret || connection.status === "disconnected") {
    return { ok: false, message: "Noon isn't connected. Upload the key file first." };
  }
  const { category } = parsed.data;
  const reports = Array.isArray(connection.settings.reports) ? connection.settings.reports : [];
  if (!reports.includes(category)) {
    return {
      ok: false,
      message: "This key can't download that report. Test the connection to refresh the list.",
    };
  }
  const allParams =
    connection.settings.reportParams && typeof connection.settings.reportParams === "object"
      ? (connection.settings.reportParams as Record<string, unknown>)
      : {};
  const spec =
    allParams[category] ??
    (category === NOON_TRANSACTIONS_EXPORT ? connection.settings.payoutsParams : null);
  const today = nowIn(ctx.profile.timezone).date;
  const to = parsed.data.to ?? addDaysIso(today, -1);
  const from = parsed.data.from ?? addDaysIso(to, -6);
  try {
    const creds = openNoonCredentials(ctx.org.id, connection.id, connection.secret);
    const exportCode =
      parsed.data.exportCode ||
      (await createNoonExport(
        creds,
        category,
        noonReportParams(spec, from, to, parsed.data.inputs ?? {}),
      ));
    const deadline = Date.now() + 25_000;
    for (;;) {
      const status = await noonExportStatus(creds, exportCode);
      if (status.state === "failed") {
        logWarn("noon.export_failed", {
          orgId: ctx.org.id,
          category,
          exportCode,
          status: status.status,
        });
        return {
          ok: false,
          message: `Noon couldn't make the report (it says “${status.status}”). Try again later.`,
        };
      }
      if (status.state === "ready" && status.downloadUrl) {
        const file = await downloadNoonExport(creds, status.downloadUrl);
        const preview = previewReport(file.bytes, file.gzip);
        logInfo("noon.report_checked", {
          orgId: ctx.org.id,
          category,
          exportCode,
          kind: preview.kind,
          columns: preview.columns.length,
          rows: preview.rows,
        });
        return {
          ok: true,
          check: { state: "ready", exportCode, status: status.status, from, to, preview },
        };
      }
      if (Date.now() + 2_500 > deadline) {
        return {
          ok: true,
          check: { state: "working", exportCode, status: status.status, from, to },
        };
      }
      await new Promise((r) => setTimeout(r, 2_500));
    }
  } catch (error) {
    return failure(error);
  }
}

// --- Walmart ---------------------------------------------------------------------------------

/** The Walmart channel an action is about, with its country. */
async function walmartChannel(ctx: Awaited<ReturnType<typeof getCommerceContext>>, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const channel = await inOrg(ctx, (tx) => getChannel(tx, id));
  const marketplace =
    channel?.kind === "walmart" ? walmartMarketplace(channel.marketplaceId ?? "") : null;
  return channel && marketplace ? { channel, marketplace } : null;
}

/** What a Walmart connection keeps besides the key: its country and what the key may do. */
function walmartSettings(
  marketplace: { id: string; market: string },
  clientId: string,
  scopes: Awaited<ReturnType<typeof checkWalmartKey>>,
) {
  return {
    marketplace: marketplace.id,
    market: marketplace.market,
    // The client ID's last characters, so people can tell which key is saved.
    clientIdEnding: clientId.slice(-4),
    scopes,
  };
}

/**
 * Connects a Walmart country's seller account with its API key (client ID and secret): checked
 * with Walmart, then sealed. Saving a key again for the country replaces it.
 */
export async function connectWalmartAction(
  slug: string,
  input: unknown,
): Promise<CommerceResult<{ replaced: boolean; missing: string[] }>> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const parsed = z
    .object({
      channelId: z.string(),
      clientId: z.string().max(1000),
      clientSecret: z.string().max(1000),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter the client ID and secret." };
  const found = await walmartChannel(ctx, parsed.data.channelId);
  if (!found) return { ok: false, message: "Unknown channel." };
  const { marketplace } = found;
  let creds: ReturnType<typeof parseWalmartCredentials>;
  try {
    creds = parseWalmartCredentials(parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check the client ID and secret.";
    return {
      ok: false,
      message,
      errors: parsed.data.clientId.trim() ? { clientSecret: message } : { clientId: message },
    };
  }
  try {
    const scopes = await checkWalmartKey(creds, marketplace.market);
    const settings = walmartSettings(marketplace, creds.clientId, scopes);
    const replaced = await inOrg(ctx, async (tx) => {
      const existing = await getWalmartConnection(tx, marketplace.id);
      const id =
        existing?.id ??
        (
          await createConnection(tx, {
            orgId: ctx.org.id,
            userId: ctx.session.user.id,
            provider: "walmart",
            name: marketplace.name,
            settings,
          })
        ).id;
      if (existing) {
        await tx
          .update(schema.connections)
          .set({ settings, status: "active" })
          .where(eq(schema.connections.id, id));
      }
      await setConnectionSecret(tx, id, sealWalmartCredentials(ctx.org.id, id, creds));
      await attachWalmartChannel(tx, id, marketplace.id);
      await recordConnectionSync(tx, id, { at: new Date(), error: null });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: existing ? "connection.credentials_replaced" : "connection.created",
        entityType: "connection",
        entityId: id,
        after: { provider: "walmart", marketplace: marketplace.id, scopes },
      });
      return Boolean(existing && existing.status !== "disconnected");
    });
    revalidate(slug);
    return { ok: true, replaced, missing: missingWalmartAccess(scopes).map((a) => a.label) };
  } catch (error) {
    return failure(error);
  }
}

/** Checks the saved Walmart key for a country again, and what it may do. */
export async function testWalmartAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult<{ missing: string[] }>> {
  const ctx = await getCommerceContext(slug, CONNECTION_AREA);
  const found = await walmartChannel(ctx, channelId);
  if (!found) return { ok: false, message: "Unknown channel." };
  const { marketplace } = found;
  const connection = await inOrg(ctx, async (tx) => {
    const live = await getWalmartConnection(tx, marketplace.id);
    return live ? getConnection(tx, live.id) : null;
  });
  if (!connection?.secret || connection.status === "disconnected") {
    return { ok: false, message: `${marketplace.name} isn't connected. Enter its API key first.` };
  }
  let error: string | null = null;
  let missing: string[] = [];
  try {
    const creds = openWalmartCredentials(ctx.org.id, connection.id, connection.secret);
    const scopes = await checkWalmartKey(creds, marketplace.market);
    missing = missingWalmartAccess(scopes).map((a) => a.label);
    const settings = walmartSettings(marketplace, creds.clientId, scopes);
    await inOrg(ctx, (tx) =>
      tx
        .update(schema.connections)
        .set({ settings })
        .where(eq(schema.connections.id, connection.id)),
    );
  } catch (e) {
    error = failure(e).message;
  }
  await inOrg(ctx, (tx) => recordConnectionSync(tx, connection.id, { at: new Date(), error }));
  revalidate(slug);
  return error ? { ok: false, message: error } : { ok: true, missing };
}

/** Forgets a Walmart country's key; the channel and everything brought in stay. */
export async function disconnectWalmartAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult> {
  const { ctx, denied } = await adminContext(slug, CONNECTION_AREA);
  if (denied) return denied;
  const found = await walmartChannel(ctx, channelId);
  if (!found) return { ok: false, message: "Unknown channel." };
  const { marketplace } = found;
  const done = await inOrg(ctx, async (tx) => {
    const connection = await getWalmartConnection(tx, marketplace.id);
    if (!connection || connection.status === "disconnected") return false;
    await disconnectWalmart(tx, connection.id);
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "connection.disconnected",
      entityType: "connection",
      entityId: connection.id,
      after: { provider: "walmart", marketplace: marketplace.id },
    });
    return true;
  });
  if (!done) return { ok: false, message: `${marketplace.name} isn't connected.` };
  revalidate(slug);
  return { ok: true };
}

/** The saved key for a Walmart country's channel, opened, or a message saying why not. */
async function walmartKey(ctx: Awaited<ReturnType<typeof getCommerceContext>>, channelId: string) {
  const found = await walmartChannel(ctx, channelId);
  if (!found) return { message: "Unknown channel." } as const;
  const connection = await inOrg(ctx, async (tx) => {
    const live = await getWalmartConnection(tx, found.marketplace.id);
    return live ? getConnection(tx, live.id) : null;
  });
  if (!connection?.secret || connection.status === "disconnected") {
    return {
      message: `${found.marketplace.name} isn't connected. Enter its API key first.`,
    } as const;
  }
  return {
    marketplace: found.marketplace,
    creds: openWalmartCredentials(ctx.org.id, connection.id, connection.secret),
  } as const;
}

/** The dates Walmart has a settlement report for, newest first (admins; nothing is saved). */
export async function walmartSettlementDatesAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult<{ dates: string[] }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  try {
    const key = await walmartKey(ctx, channelId);
    if ("message" in key) return { ok: false, message: key.message ?? "Unknown channel." };
    return { ok: true, dates: await walmartSettlementDates(key.creds, key.marketplace.market) };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Downloads one settlement report and returns only its kind, column names and row count, so
 * the next step can read it. Nothing is kept.
 */
export async function checkWalmartSettlementAction(
  slug: string,
  input: unknown,
): Promise<CommerceResult<{ date: string; preview: ReportPreview }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  const parsed = z
    .object({ channelId: z.string(), date: z.string().refine(isIsoDate) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a settlement date." };
  try {
    const key = await walmartKey(ctx, parsed.data.channelId);
    if ("message" in key) return { ok: false, message: key.message ?? "Unknown channel." };
    const bytes = await downloadWalmartSettlement(
      key.creds,
      key.marketplace.market,
      parsed.data.date,
    );
    const preview = previewReport(bytes);
    logInfo("walmart.settlement_checked", {
      marketplace: key.marketplace.id,
      date: parsed.data.date,
      kind: preview.kind,
      columns: preview.columns.length,
      rows: preview.rows,
    });
    return { ok: true, date: parsed.data.date, preview };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Brings in what Walmart Fulfillment Services holds for a Walmart channel (admins): every SKU's
 * sellable and held units, shown on Stock beside your lots.
 */
export async function bringInWfsStockAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult<{ skus: number; units: number }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  try {
    const key = await walmartKey(ctx, channelId);
    if ("message" in key) return { ok: false, message: key.message ?? "Unknown channel." };
    const result = await bringInWfsStock(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      { channelId, market: key.marketplace.market, creds: key.creds },
      Date.now() + 50_000,
    );
    await inOrg(ctx, (tx) =>
      audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: "walmart.wfs_stock_brought_in",
        entityType: "sales_channel",
        entityId: channelId,
        after: result,
      }),
    );
    revalidate(slug);
    revalidatePath(`/o/${slug}/inventory`, "layout");
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Brings in the Walmart settlement reports not in yet for a country (admins), within about 50
 * seconds; the button says when there's more to bring in.
 */
export async function bringInWalmartSettlementsAction(
  slug: string,
  channelId: string,
): Promise<CommerceResult<{ added: number; available: number; more: boolean }>> {
  const { ctx, denied } = await adminContext(slug);
  if (denied) return denied;
  try {
    const key = await walmartKey(ctx, channelId);
    if ("message" in key) return { ok: false, message: key.message ?? "Unknown channel." };
    const result = await bringInWalmartSettlements(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      { channelId, market: key.marketplace.market, creds: key.creds },
      Date.now() + 50_000,
    );
    if (result.added) {
      await inOrg(ctx, (tx) =>
        audit(tx, {
          orgId: ctx.org.id,
          actorUserId: ctx.session.user.id,
          action: "walmart.settlements_brought_in",
          entityType: "sales_channel",
          entityId: channelId,
          after: { added: result.added },
        }),
      );
    }
    revalidate(slug);
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}
