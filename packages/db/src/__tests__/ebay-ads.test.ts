import type { EbayTransaction } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { addEbayChannel, saveOrdersWithItems } from "../commerce";
import { importEbayTransactions, refreshEbayAdMetrics } from "../ebay-transactions";
import * as schema from "../schema";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

let orgId: string;
let otherOrgId: string;
let caId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

// Synthetic eBay rows in CAD: a promoted sale's ad fee, and a Priority (click) charge.
const row = (over: Partial<EbayTransaction>): EbayTransaction => ({
  transactionId: "T",
  transactionType: "NON_SALE_CHARGE",
  status: "FUNDS_AVAILABLE_FOR_PAYOUT",
  transactionDate: "2026-10-05T10:00:00.000Z",
  orderId: null,
  payoutId: null,
  feeType: "AD_FEE",
  currency: "CAD",
  amount: "-4.0000",
  fees: "0.0000",
  ebayTax: "0.0000",
  ...over,
});

const item = (sku: string, quantity: number, price: string) => ({
  itemId: `${sku}-1`,
  asin: `EBAY-${sku}`,
  sku,
  title: sku,
  quantityOrdered: quantity,
  quantityShipped: quantity,
  itemPrice: price,
  itemTax: null,
  shippingPrice: null,
  shippingTax: null,
  promotionDiscount: null,
});

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "eBay Ads Org", slug: "ebay-ads-org", createdAt: new Date() },
      { name: "Other eBay Ads Org", slug: "other-ebay-ads-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  caId = (
    await scoped((tx) =>
      addEbayChannel(tx, {
        orgId,
        marketplace: { id: "EBAY_CA", name: "eBay Canada", country: "CA", currency: "CAD" },
      }),
    )
  ).channel.id;
  await scoped((tx) =>
    saveOrdersWithItems(tx, {
      orgId,
      channelId: caId,
      from: "2026-01-01",
      orders: [
        {
          order: {
            orderId: "CA-PROMO-1",
            marketplaceId: "EBAY_CA",
            purchasedAt: "2026-10-04T10:00:00Z",
            lastUpdatedAt: "2026-10-05T10:00:00Z",
            status: "Shipped",
            fulfillment: "merchant",
            currency: "CAD",
            total: "40.00",
            itemsShipped: 3,
            itemsUnshipped: 0,
            shipCountry: "CA",
            shipRegion: "ON",
            isBusiness: false,
            isPrime: false,
            isReplacement: false,
            earliestDelivery: null,
            latestDelivery: null,
          },
          items: [item("MUG", 2, "30.00"), item("TOTE", 1, "10.00")],
        },
      ],
    }),
  );
  await scoped((tx) =>
    importEbayTransactions(tx, {
      orgId,
      rows: [
        row({ transactionId: "AD-1", orderId: "CA-PROMO-1" }),
        row({
          transactionId: "AD-2",
          amount: "-12.0000",
          transactionDate: "2026-10-06T09:00:00.000Z",
        }),
        row({
          transactionId: "SALE-1",
          transactionType: "SALE",
          feeType: null,
          amount: "35.0000",
          orderId: "CA-PROMO-1",
        }),
      ],
    }),
  );
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("eBay Promoted Listings as ad metrics", () => {
  it("ties an order's ad fee to its SKUs and keeps the rest tied to no product, again and again", async () => {
    expect(await scoped((tx) => refreshEbayAdMetrics(tx, { orgId, baseCurrency: "CAD" }))).toBe(3);
    // Made again, not added twice.
    expect(await scoped((tx) => refreshEbayAdMetrics(tx, { orgId, baseCurrency: "CAD" }))).toBe(3);
    const rows = await scoped((tx) => tx.select().from(schema.adMetrics));
    expect(
      rows
        .map((r) => [
          r.channelId === caId,
          r.source,
          r.adType,
          r.date,
          r.sku,
          r.spend,
          r.spendBase,
          r.attributedSales,
        ])
        .sort(),
    ).toEqual([
      [true, "ebay", "promoted_listings", "2026-10-05", "MUG", "3.0000", "3.0000", "30.0000"],
      [true, "ebay", "promoted_listings", "2026-10-05", "TOTE", "1.0000", "1.0000", "10.0000"],
      [true, "ebay", "promoted_listings", "2026-10-06", null, "12.0000", "12.0000", "0.0000"],
    ]);
    expect(await scoped((tx) => tx.select().from(schema.adMetrics), otherOrgId)).toEqual([]);
  });
});
