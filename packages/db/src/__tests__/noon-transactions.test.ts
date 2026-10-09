import { parseNoonTransactions } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { listNoonChannels } from "../commerce";
import {
  importNoonTransactions,
  noonSyncState,
  noonTransactionMonths,
  noonTransactionTypes,
  saveNoonSyncState,
} from "../noon-transactions";
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
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

// Noon's header as the transaction view prints it; synthetic rows.
const HEADER =
  "Contract,Contract Title,Reference Nr,Order Nr,Item Nr,Order Date,Transaction Date,Title,SKUs,Partner SKUs,Transaction Type,Currency,Net Proceeds,Referral Fee including VAT,Fullfilment & Logistics Fees including VAT,Shipping Credits including VAT,Other Order Fees including VAT,Order Subsidies including VAT,Non-Order Fees including VAT,Non-Order Subsidies including VAT,Others including VAT,Total";
const ROWS = [
  "C1,Noon UAE,REF-1,NAE001,ITEM-1,2026-08-28,2026-08-30,Maple mug,Z1,MUG-1,Order,AED,100.00,-8.40,-6.30,0,0,2.00,0,0,0,87.30",
  "C1,Noon UAE,REF-1,NAE001,ITEM-1,2026-08-28,2026-09-02,,Z1,MUG-1,Order Update,AED,0,-0.50,0,0,0,0,0,0,0,-0.50",
  "C1,Noon UAE,REF-9,,,,2026-09-05,,,,Storage Fee,AED,0,0,0,0,0,0,-12.00,0,0,-12.00",
  "C2,Noon KSA,REF-20,NSA001,ITEM-2,2026-09-01,2026-09-03,Maple mug,Z1,MUG-1,Order,SAR,50.00,-4.00,-3.00,0,0,0,0,0,0,43.00",
  "C9,Elsewhere,REF-30,X1,I1,2026-09-01,2026-09-03,,,,Order,USD,10,0,0,0,0,0,0,0,0,10",
];

const parse = (rows: string[]) => {
  const parsed = parseNoonTransactions([HEADER, ...rows].join("\n"));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.rows;
};

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Noon Tx Org", slug: "noon-tx-org", createdAt: new Date() },
      { name: "Other Noon Tx Org", slug: "other-noon-tx-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("Noon transactions", () => {
  it("adds rows to the Noon country of their currency, adding the country when missing", async () => {
    const result = await scoped((tx) =>
      importNoonTransactions(tx, {
        orgId,
        rows: parse(ROWS),
        source: "upload",
        connectionId: null,
      }),
    );
    expect(result).toEqual({
      added: 4,
      updated: 0,
      unknownCurrency: 1,
      channelsAdded: ["Noon UAE", "Noon KSA"],
    });
    const channels = await scoped((tx) => listNoonChannels(tx));
    expect(channels.map((c) => [c.name, c.isActive])).toEqual([
      ["Noon KSA", true],
      ["Noon UAE", true],
    ]);
  });

  it("brings the same rows in again without doubling them, refreshing their amounts", async () => {
    const changed = ROWS.map((r) => r.replace(",-12.00,0,0,-12.00", ",-15.00,0,0,-15.00"));
    const result = await scoped((tx) =>
      importNoonTransactions(tx, {
        orgId,
        rows: parse(changed),
        source: "api",
        connectionId: null,
      }),
    );
    expect(result).toMatchObject({ added: 0, updated: 4, channelsAdded: [] });
  });

  it("sums each month's columns per country, and counts the transaction types", async () => {
    const channels = await scoped((tx) => listNoonChannels(tx));
    const uae = channels.find((c) => c.currency === "AED")?.id;
    const months = await scoped((tx) => noonTransactionMonths(tx));
    const uaeMonths = months.filter((m) => m.channelId === uae);
    expect(uaeMonths.map((m) => [m.month, m.rows, m.total])).toEqual([
      ["2026-09", 2, "-15.5000"],
      ["2026-08", 1, "87.3000"],
    ]);
    expect(uaeMonths[1]).toMatchObject({
      netProceeds: "100.0000",
      referralFee: "-8.4000",
      orderSubsidies: "2.0000",
      unbalanced: 0,
    });
    const types = await scoped((tx) => noonTransactionTypes(tx));
    expect(types.filter((t) => t.channelId === uae).map((t) => t.transactionType)).toEqual(
      expect.arrayContaining(["Order", "Order Update", "Storage Fee"]),
    );
  });

  it("keeps each company's transactions to itself", async () => {
    expect(await scoped((tx) => noonTransactionMonths(tx), otherOrgId)).toEqual([]);
    const rows = await scoped((tx) => tx.select().from(schema.noonTransactions), otherOrgId);
    expect(rows).toEqual([]);
  });

  it("keeps where bringing in has got to on the connection", async () => {
    const connectionId = await scoped(async (tx) => {
      const { id } = await createConnection(tx, {
        orgId,
        userId: null,
        provider: "noon",
        name: "Noon",
        settings: { projectCode: "PRJ000001", payoutsReport: true },
      });
      await saveNoonSyncState(tx, id, {
        through: "2026-09-30",
        pending: { exportCode: "EXP-1", from: "2026-10-01", to: "2026-10-08" },
        refreshedAt: null,
      });
      return id;
    });
    const [row] = await scoped((tx) => tx.select().from(schema.connections));
    expect(row?.id).toBe(connectionId);
    const settings = row?.settings as Record<string, unknown>;
    expect(settings.projectCode).toBe("PRJ000001");
    expect(noonSyncState(settings)).toEqual({
      through: "2026-09-30",
      pending: { exportCode: "EXP-1", from: "2026-10-01", to: "2026-10-08" },
      refreshedAt: null,
    });
    expect(noonSyncState({})).toEqual({ through: null, pending: null, refreshedAt: null });
  });
});
