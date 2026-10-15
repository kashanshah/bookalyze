import { type EbayTransaction, ebayGroupTotals, formatDecimal } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { addEbayChannel, saveOrdersWithItems } from "../commerce";
import {
  dropEbayReportRows,
  ebayMonths,
  ebaySyncState,
  importEbayReport,
  importEbayTransactions,
  placeEbayTransactionsByOrder,
  saveEbaySyncState,
} from "../ebay-transactions";
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
let usId: string;
let caId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

// Synthetic rows in the account's payout currency (CAD).
const row = (over: Partial<EbayTransaction>): EbayTransaction => ({
  transactionId: "T",
  transactionType: "SALE",
  status: "FUNDS_AVAILABLE_FOR_PAYOUT",
  transactionDate: "2026-09-02T14:05:00.000Z",
  orderId: null,
  payoutId: null,
  feeType: null,
  currency: "CAD",
  amount: "26.1000",
  fees: "3.9000",
  ebayTax: "0.0000",
  ...over,
});
const ROWS = [
  row({ transactionId: "T1", orderId: "US-ORDER-1" }),
  row({ transactionId: "T2", orderId: "CA-ORDER-1", amount: "40.0000", fees: "5.0000" }),
  row({
    transactionId: "T3",
    transactionType: "NON_SALE_CHARGE",
    feeType: "AD_FEE",
    amount: "-2.5000",
    fees: "0.0000",
    transactionDate: "2026-09-20T10:00:00.000Z",
  }),
];

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "eBay Money Org", slug: "ebay-money-org", createdAt: new Date() },
      { name: "Other eBay Money Org", slug: "other-ebay-money-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  usId = (
    await scoped((tx) =>
      addEbayChannel(tx, {
        orgId,
        marketplace: { id: "EBAY_US", name: "eBay US", country: "US", currency: "USD" },
      }),
    )
  ).channel.id;
  caId = (
    await scoped((tx) =>
      addEbayChannel(tx, {
        orgId,
        marketplace: { id: "EBAY_CA", name: "eBay Canada", country: "CA", currency: "CAD" },
      }),
    )
  ).channel.id;
  // The US order is in; the Canadian one comes later.
  await scoped((tx) =>
    saveOrdersWithItems(tx, {
      orgId,
      channelId: usId,
      from: "2026-01-01",
      orders: [
        {
          order: usOrder,
          items: [],
        },
      ],
    }),
  );
});

const usOrder = {
  orderId: "US-ORDER-1",
  marketplaceId: "EBAY_US",
  purchasedAt: "2026-09-01T10:00:00Z",
  lastUpdatedAt: "2026-09-02T10:00:00Z",
  status: "Shipped",
  fulfillment: "merchant" as const,
  currency: "USD",
  total: "19.99",
  itemsShipped: 1,
  itemsUnshipped: 0,
  shipCountry: "US",
  shipRegion: "WA",
  isBusiness: false,
  isPrime: false,
  isReplacement: false,
  earliestDelivery: null,
  latestDelivery: null,
} as const;

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("eBay transactions", () => {
  it("puts each row on its order's site, else the site in its currency", async () => {
    expect(await scoped((tx) => importEbayTransactions(tx, { orgId, rows: ROWS }))).toEqual({
      added: 3,
      updated: 0,
    });
    const rows = await scoped((tx) => tx.select().from(schema.ebayTransactions));
    const site = Object.fromEntries(rows.map((r) => [r.transactionId, r.channelId]));
    expect(site).toEqual({ T1: usId, T2: caId, T3: caId });
  });

  it("updates rows brought in again, and moves rows to an order's site once it comes in", async () => {
    expect(
      await scoped((tx) =>
        importEbayTransactions(tx, {
          orgId,
          rows: [
            row({ transactionId: "T1", orderId: "US-ORDER-1", status: "PAYOUT", payoutId: "P1" }),
          ],
        }),
      ),
    ).toEqual({ added: 0, updated: 1 });
    // The Canadian order comes in (listed on the US site, say): its row follows it.
    await scoped((tx) =>
      saveOrdersWithItems(tx, {
        orgId,
        channelId: usId,
        from: "2026-01-01",
        orders: [{ order: { ...usOrder, orderId: "CA-ORDER-1" }, items: [] }],
      }),
    );
    expect(await scoped((tx) => placeEbayTransactionsByOrder(tx))).toBe(1);
    const [t2] = await scoped((tx) =>
      tx.select().from(schema.ebayTransactions).where(eqTransaction("T2")),
    );
    expect(t2?.channelId).toBe(usId);
    const [t1] = await scoped((tx) =>
      tx.select().from(schema.ebayTransactions).where(eqTransaction("T1")),
    );
    expect(t1).toMatchObject({ status: "PAYOUT", payoutId: "P1" });
  });

  it("sums each site's month by type, for the month's groups", async () => {
    const months = await scoped((tx) => ebayMonths(tx));
    expect(months.map((m) => [m.channelName, m.month, m.rows])).toEqual([
      ["eBay Canada", "2026-09", 1],
      ["eBay US", "2026-09", 2],
    ]);
    const us = months.find((m) => m.channelName === "eBay US");
    const { groups, earned } = ebayGroupTotals(us?.sums ?? []);
    expect(formatDecimal(groups.sales)).toBe("75.0000");
    expect(formatDecimal(groups.fees)).toBe("-8.9000");
    expect(formatDecimal(earned)).toBe("66.1000");
    expect(await scoped((tx) => ebayMonths(tx, { from: "2026-09-10", to: "2026-09-30" }))).toEqual([
      expect.objectContaining({ channelName: "eBay Canada", rows: 1 }),
    ]);
  });

  it("keeps how far the rows are in on the eBay connection", async () => {
    const connection = await scoped((tx) =>
      createConnection(tx, { orgId, provider: "ebay", name: "eBay", settings: {} }),
    );
    const id = connection.id;
    const state = {
      through: "2026-09-30",
      refreshedAt: null,
      pending: { from: "2026-10-01", to: "2026-10-12", offset: 1000 },
      payoutsThrough: "2026-09-30",
    };
    await scoped((tx) => saveEbaySyncState(tx, id, state));
    const [saved] = await scoped((tx) => tx.select().from(schema.connections).where(eqId(id)));
    expect(ebaySyncState(saved?.settings ?? {})).toEqual(state);
  });

  it("adds the transaction report's rows on days the API hasn't read, and the API replaces them", async () => {
    const report = [
      // A day the API already read: the API's rows stay, this one is left out.
      row({ transactionId: "report:a", transactionDate: "2026-09-02T00:00:00.000Z" }),
      row({ transactionId: "report:b", transactionDate: "2026-08-15T00:00:00.000Z" }),
    ];
    const payouts = [
      {
        payoutId: "PO-REPORT",
        status: "SUCCEEDED",
        payoutDate: "2026-08-17T00:00:00.000Z",
        currency: "CAD",
        amount: "22.2000",
        accountLast4: null,
      },
    ];
    expect(await scoped((tx) => importEbayReport(tx, { orgId, rows: report, payouts }))).toEqual({
      added: 1,
      updated: 0,
      fromApi: 1,
      payouts: 1,
    });
    // The same file again: nothing new.
    expect(await scoped((tx) => importEbayReport(tx, { orgId, rows: report, payouts }))).toEqual({
      added: 0,
      updated: 1,
      fromApi: 1,
      payouts: 0,
    });
    const months = await scoped((tx) => ebayMonths(tx));
    expect(months.map((m) => [m.channelName, m.month, m.rows])).toContainEqual([
      "eBay Canada",
      "2026-08",
      1,
    ]);
    // The API reads August: the report's row makes way for the API's.
    expect(
      await scoped((tx) => dropEbayReportRows(tx, { from: "2026-08-01", to: "2026-08-31" })),
    ).toBe(1);
    expect(
      await scoped((tx) => dropEbayReportRows(tx, { from: "2026-09-01", to: "2026-09-30" })),
    ).toBe(0);
    const left = await scoped((tx) => tx.select().from(schema.ebayTransactions));
    expect(left.map((r) => r.transactionId).sort()).toEqual(["T1", "T2", "T3"]);
  });

  it("keeps each company's eBay money to itself", async () => {
    expect(await scoped((tx) => ebayMonths(tx), otherOrgId)).toEqual([]);
    expect(await scoped((tx) => tx.select().from(schema.ebayTransactions), otherOrgId)).toEqual([]);
  });
});

const eqTransaction = (id: string) => eq(schema.ebayTransactions.transactionId, id);
const eqId = (id: string) => eq(schema.connections.id, id);
