import "server-only";
import {
  type AmazonListing,
  type AmazonRegion,
  buildPricePatch,
  formatDecimal,
  isAmazonRegion,
  listingCost,
  minorUnits,
  type PriceProfit,
  parseDecimal,
  priceProfit,
  referralFee,
  roundUnits,
} from "@bookalyze/core";
import {
  amazonSellerId,
  expireStalePriceChanges,
  getChannelForSync,
  getDb,
  markPriceChange,
  nextUnitCosts,
  pendingPriceChanges,
  pricedSkus,
  recordPriceChange,
  saveAmazonSellerId,
  saveFeeEstimate,
  saveListingPrice,
  VaultError,
  withOrg,
} from "@bookalyze/db";
import {
  type AmazonCredentials,
  AmazonError,
  feesEstimate,
  listingItem,
  patchListing,
  sellerIdFromListing,
} from "./amazon";
import { openAmazonCredentials } from "./commerce";
import { suggestRate } from "./fx";

/**
 * Prices of Amazon listings (Inventory → Prices): reading them from Amazon, estimating fees and
 * profit at a price, and sending a new price. Amazon applies an accepted change within minutes,
 * so changes are checked back later until the listing shows them.
 */

type Ctx = { orgId: string; userId: string | null };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Give Amazon this long before reading a change back. */
const APPLY_DELAY_MS = 90_000;
/** A change still not on the listing after this is reported as not applied. */
const GIVE_UP_MS = 24 * 3_600_000;

export class PriceError extends Error {}

export const SELLER_ID_NEEDED =
  "Amazon didn't tell us your seller ID. Add it under Prices: in Seller Central, Settings → Account Info → Merchant Token.";

type Access = {
  channelId: string;
  marketplaceId: string;
  connectionId: string;
  region: AmazonRegion;
  creds: AmazonCredentials;
};

async function access(ctx: Ctx, channelId: string): Promise<Access> {
  const found = await withOrg(getDb(), ctx, (tx) => getChannelForSync(tx, channelId));
  if (!found) throw new PriceError("This marketplace no longer exists.");
  const { channel, connection } = found;
  const region = String(connection.settings.region ?? "");
  if (
    connection.provider !== "amazon_sp" ||
    connection.status === "disconnected" ||
    !connection.secret ||
    !isAmazonRegion(region) ||
    !channel.isActive ||
    !channel.marketplaceId
  ) {
    throw new PriceError(`${channel.name} isn't connected or is switched off on Channels.`);
  }
  try {
    return {
      channelId,
      marketplaceId: channel.marketplaceId,
      connectionId: connection.id,
      region,
      creds: openAmazonCredentials(ctx.orgId, connection.id, connection.secret),
    };
  } catch (error) {
    if (error instanceof VaultError) {
      throw new PriceError("Connections aren't set up on this server yet. See docs/SETUP.md.");
    }
    throw error;
  }
}

/** Amazon's answer, retried once a second while it asks us to slow down (until `deadline`). */
async function patiently<T>(deadline: number, fn: () => Promise<T>): Promise<T> {
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AmazonError && error.code === "throttled" && Date.now() < deadline) {
        await sleep(1_000);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Amazon's fee estimate at the listing's own price, kept on its price row: Profit by product
 * estimates a product's fees from it while too few of its orders are settled.
 */
async function keepFeeEstimate(
  ctx: Ctx,
  a: Access,
  listing: AmazonListing & { sku: string },
  deadline: number,
) {
  if (!listing.price || !listing.currency) return;
  const { price, currency } = listing;
  const fees = await patiently(deadline, () =>
    feesEstimate(a.creds, a.region, {
      sku: listing.sku,
      marketplaceId: a.marketplaceId,
      price,
      currency,
      fulfilledByAmazon: listing.fulfilledByAmazon,
    }),
  ).catch((error: unknown) => {
    if (error instanceof AmazonError) return { error: error.message };
    throw error;
  });
  if ("error" in fees || fees.currency !== currency) return;
  await withOrg(getDb(), ctx, (tx) =>
    saveFeeEstimate(tx, {
      channelId: a.channelId,
      sku: listing.sku,
      price,
      referral: referralFee(fees),
      total: fees.total,
    }),
  );
}

/** The seller ID for a channel's account: saved, or found from one of its listings' offers. */
async function sellerIdFor(ctx: Ctx, a: Access, skus: readonly string[], deadline: number) {
  const saved = await withOrg(getDb(), ctx, (tx) => amazonSellerId(tx, a.connectionId));
  if (saved) return saved;
  for (const sku of skus.slice(0, 5)) {
    if (Date.now() >= deadline) break;
    const id = await patiently(deadline, () =>
      sellerIdFromListing(a.creds, a.region, { sku, marketplaceId: a.marketplaceId }),
    );
    if (id) {
      await withOrg(getDb(), ctx, (tx) => saveAmazonSellerId(tx, a.connectionId, id));
      return id;
    }
  }
  return null;
}

export type PriceRefreshResult = {
  checked: number;
  /** SKUs still to read when time ran out (the screen asks again). */
  remaining: number;
  needsSellerId: boolean;
  error: string | null;
};

/** Reads the price of each linked SKU on a marketplace from Amazon, least recently read first. */
export async function refreshChannelPrices(
  ctx: Ctx,
  channelId: string,
  options: { deadline: number },
): Promise<PriceRefreshResult> {
  const result: PriceRefreshResult = {
    checked: 0,
    remaining: 0,
    needsSellerId: false,
    error: null,
  };
  try {
    const a = await access(ctx, channelId);
    const rows = (await withOrg(getDb(), ctx, (tx) => pricedSkus(tx)))
      .filter((r) => r.channelId === channelId)
      .sort((x, y) => (x.checkedAt?.getTime() ?? 0) - (y.checkedAt?.getTime() ?? 0));
    const sellerId = await sellerIdFor(
      ctx,
      a,
      rows.map((r) => r.sku),
      options.deadline,
    );
    if (!sellerId) return { ...result, needsSellerId: true, remaining: rows.length };
    for (const [i, row] of rows.entries()) {
      if (Date.now() >= options.deadline) {
        result.remaining = rows.length - i;
        break;
      }
      const listing = await patiently(options.deadline, () =>
        listingItem(a.creds, a.region, { sellerId, sku: row.sku, marketplaceId: a.marketplaceId }),
      );
      await withOrg(getDb(), ctx, (tx) =>
        saveListingPrice(tx, { orgId: ctx.orgId, channelId, sku: row.sku, listing }),
      );
      if (listing) await keepFeeEstimate(ctx, a, { ...listing, sku: row.sku }, options.deadline);
      result.checked++;
      // Listings allow about five reads a second, fee estimates about one.
      await sleep(listing ? 1_000 : 220);
    }
    await checkPriceChanges(ctx, options.deadline);
  } catch (error) {
    if (error instanceof AmazonError || error instanceof PriceError) {
      return { ...result, error: error.message };
    }
    throw error;
  }
  return result;
}

/** Reads back changes Amazon accepted, marking the ones now on the listing as applied. */
export async function checkPriceChanges(ctx: Ctx, deadline: number) {
  const now = Date.now();
  const pending = await withOrg(getDb(), ctx, (tx) =>
    pendingPriceChanges(tx, new Date(now - APPLY_DELAY_MS)),
  );
  const accessByChannel = new Map<string, Access | null>();
  for (const change of pending) {
    if (Date.now() >= deadline) break;
    if (!accessByChannel.has(change.channelId)) {
      accessByChannel.set(change.channelId, await access(ctx, change.channelId).catch(() => null));
    }
    const a = accessByChannel.get(change.channelId);
    const sellerId = a
      ? await withOrg(getDb(), ctx, (tx) => amazonSellerId(tx, a.connectionId))
      : null;
    if (!a || !sellerId) continue;
    const listing = await patiently(deadline, () =>
      listingItem(a.creds, a.region, {
        sellerId,
        sku: change.sku,
        marketplaceId: a.marketplaceId,
      }),
    ).catch(() => undefined);
    if (listing === undefined) continue;
    const applied =
      listing?.price != null && parseDecimal(listing.price) === parseDecimal(change.newPrice);
    await withOrg(getDb(), ctx, async (tx) => {
      await saveListingPrice(tx, {
        orgId: ctx.orgId,
        channelId: change.channelId,
        sku: change.sku,
        listing,
      });
      await markPriceChange(tx, change.id, applied ? "applied" : "sent");
    });
  }
  await withOrg(getDb(), ctx, (tx) => expireStalePriceChanges(tx, new Date(now - GIVE_UP_MS)));
}

export type PriceLine = {
  price: string;
  fees: string | null;
  feesError: string | null;
  profit: PriceProfit | null;
};

export type PriceEstimate = {
  currency: string;
  /** The listing as Amazon has it now. */
  current: PriceLine | null;
  next: PriceLine;
  /** What the listing holds costs, in its currency; null with the reason. */
  cost: string | null;
  costNote: string | null;
  fulfilledByAmazon: boolean;
};

/** Rounds a typed price to the currency's cents. */
export function roundPrice(price: string, currency: string): string {
  return formatDecimal(roundUnits(parseDecimal(price), minorUnits(currency)));
}

async function costOfListing(
  ctx: Ctx,
  input: { channelId: string; sku: string; currency: string; baseCurrency: string; today: string },
): Promise<{ cost: string | null; note: string | null }> {
  const row = (await withOrg(getDb(), ctx, (tx) => pricedSkus(tx))).find(
    (r) => r.channelId === input.channelId && r.sku === input.sku,
  );
  if (!row) return { cost: null, note: "This SKU isn't linked to a product." };
  const unitCosts = await withOrg(getDb(), ctx, (tx) =>
    nextUnitCosts(
      tx,
      row.components.map((c) => c.productId),
    ),
  );
  const needsRate = [...unitCosts.values()].some((u) => u.currency !== input.currency);
  const rate = needsRate
    ? ((await suggestRate(input.baseCurrency, input.currency, input.today))?.rate ?? null)
    : null;
  const result = listingCost({
    components: row.components,
    unitCosts,
    currency: input.currency,
    rate,
  });
  if (result.cost) return { cost: result.cost, note: null };
  if (result.needsRate) {
    return {
      cost: null,
      note: `There's no ${input.baseCurrency} to ${input.currency} rate for today yet, so profit can't be worked out.`,
    };
  }
  return {
    cost: null,
    note: `No cost yet for ${result.missing.join(", ")}: add a delivery or opening stock under Stock lots.`,
  };
}

async function line(
  a: Access,
  input: { sku: string; price: string; currency: string; fba: boolean; cost: string | null },
  deadline: number,
  /** The listing's own price: its estimate is kept for Profit by product. */
  keep?: Ctx,
): Promise<PriceLine> {
  const fees = await patiently(deadline, () =>
    feesEstimate(a.creds, a.region, {
      sku: input.sku,
      marketplaceId: a.marketplaceId,
      price: input.price,
      currency: input.currency,
      fulfilledByAmazon: input.fba,
    }),
  ).catch((error: unknown) => {
    if (error instanceof AmazonError) return { error: error.message };
    throw error;
  });
  if ("error" in fees)
    return { price: input.price, fees: null, feesError: fees.error, profit: null };
  if (keep && fees.currency === input.currency) {
    await withOrg(getDb(), keep, (tx) =>
      saveFeeEstimate(tx, {
        channelId: a.channelId,
        sku: input.sku,
        price: input.price,
        referral: referralFee(fees),
        total: fees.total,
      }),
    );
  }
  return {
    price: input.price,
    fees: fees.total,
    feesError: null,
    profit:
      input.cost !== null
        ? priceProfit({
            price: input.price,
            fees: fees.total,
            cost: input.cost,
            currency: input.currency,
          })
        : null,
  };
}

async function readListing(ctx: Ctx, a: Access, sku: string, deadline: number) {
  const sellerId = await sellerIdFor(ctx, a, [sku], deadline);
  if (!sellerId) throw new PriceError(SELLER_ID_NEEDED);
  const listing = await patiently(deadline, () =>
    listingItem(a.creds, a.region, { sellerId, sku, marketplaceId: a.marketplaceId }),
  );
  await withOrg(getDb(), ctx, (tx) =>
    saveListingPrice(tx, { orgId: ctx.orgId, channelId: a.channelId, sku, listing }),
  );
  if (!listing) {
    throw new PriceError("Amazon doesn't have a listing for this SKU in this marketplace.");
  }
  return { sellerId, listing };
}

/** Fees, cost and profit at the listing's price now and at a new one. */
export async function estimatePrice(
  ctx: Ctx,
  input: {
    channelId: string;
    sku: string;
    price: string;
    channelCurrency: string;
    baseCurrency: string;
    today: string;
  },
): Promise<PriceEstimate> {
  const deadline = Date.now() + 25_000;
  try {
    const a = await access(ctx, input.channelId);
    const { listing } = await readListing(ctx, a, input.sku, deadline);
    const currency = listing.currency ?? input.channelCurrency;
    const { cost, note } = await costOfListing(ctx, {
      channelId: input.channelId,
      sku: input.sku,
      currency,
      baseCurrency: input.baseCurrency,
      today: input.today,
    });
    const price = roundPrice(input.price, currency);
    const shared = { sku: input.sku, currency, fba: listing.fulfilledByAmazon, cost };
    const atListing = listing.price !== null && parseDecimal(listing.price) === parseDecimal(price);
    const current =
      listing.price && !atListing
        ? await line(a, { ...shared, price: listing.price }, deadline, ctx)
        : null;
    const next = await line(a, { ...shared, price }, deadline, atListing ? ctx : undefined);
    return {
      currency,
      current: current ?? (listing.price ? next : null),
      next,
      cost,
      costNote: note,
      fulfilledByAmazon: listing.fulfilledByAmazon,
    };
  } catch (error) {
    if (error instanceof AmazonError) throw new PriceError(error.message);
    throw error;
  }
}

export type PriceChangeResult =
  | { ok: true; status: "sent"; oldPrice: string | null; newPrice: string; currency: string }
  | { ok: false; message: string };

/** Sends a new price to Amazon, keeping the rest of the listing's offer, and records it. */
export async function changePrice(
  ctx: Ctx,
  input: { channelId: string; sku: string; price: string; channelCurrency: string },
): Promise<PriceChangeResult> {
  const deadline = Date.now() + 25_000;
  try {
    const a = await access(ctx, input.channelId);
    const { sellerId, listing } = await readListing(ctx, a, input.sku, deadline);
    if (!listing.productType) {
      return {
        ok: false,
        message: "Amazon didn't say what kind of product this is yet. Try again later.",
      };
    }
    const currency = listing.currency ?? input.channelCurrency;
    const price = roundPrice(input.price, currency);
    const result = await patchListing(a.creds, a.region, {
      sellerId,
      sku: input.sku,
      marketplaceId: a.marketplaceId,
      body: buildPricePatch({
        productType: listing.productType,
        marketplaceId: a.marketplaceId,
        currency,
        price,
        offer: listing.offer,
      }),
    });
    const accepted = result.status === "ACCEPTED";
    const message = accepted ? null : result.problems.join(" ") || "Amazon refused the change.";
    await withOrg(getDb(), ctx, (tx) =>
      recordPriceChange(tx, {
        orgId: ctx.orgId,
        userId: ctx.userId,
        channelId: input.channelId,
        sku: input.sku,
        currency,
        oldPrice: listing.price,
        newPrice: price,
        status: accepted ? "sent" : "refused",
        submissionId: result.submissionId,
        message,
      }),
    );
    if (!accepted) return { ok: false, message: message ?? "Amazon refused the change." };
    return { ok: true, status: "sent", oldPrice: listing.price, newPrice: price, currency };
  } catch (error) {
    if (error instanceof AmazonError || error instanceof PriceError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

export type { AmazonListing };
