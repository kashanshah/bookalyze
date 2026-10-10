import { noonMarketplace, parseNoonLedger } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { salesByMonth } from "../cogs";
import { addNoonChannel } from "../commerce";
import { importNoonLedger, ledgerChannels, ledgerOtherTypes } from "../inventory-ledger";
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

// Noon's header (fbn_inventoryv2_ledgerdetailedview); synthetic rows.
const FILE = [
  "transaction_date,transaction_type,reference_nr,reference_type,country_code,warehouse_code,fulfillment_type,nfsku,sku,partner_sku,partner_barcode,inventory_condition,quantity_delta,qc_fail_item_identifier",
  "2026-09-10,customer_return,NAE001,customer_order,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,1,",
  "2026-09-12,lost,ADJ-1,adjustment,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,-2,",
  "2026-09-14,mystery,X-1,,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,3,",
  "2026-09-15,lost,ADJ-2,adjustment,EG,CAI01,FBN,N1,Z1,MUG-1,111,sellable,-1,",
].join("\n");

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Noon Ledger Org", slug: "noon-ledger-org", createdAt: new Date() },
      { name: "Other Noon Ledger Org", slug: "other-noon-ledger-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  for (const id of ["noon-ae", "noon-sa"]) {
    const marketplace = noonMarketplace(id);
    if (!marketplace) throw new Error(`${id} is missing.`);
    await scoped((tx) => addNoonChannel(tx, { orgId, marketplace, fulfilment: "marketplace" }));
  }
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("Noon's FBN inventory ledger", () => {
  it("puts each row on its Noon country, counts every country in, and names countries not added", async () => {
    const parsed = parseNoonLedger(FILE);
    if (!parsed.ok) throw new Error(parsed.error);
    const first = await scoped((tx) =>
      importNoonLedger(tx, { orgId, events: parsed.events, through: "2026-09-30" }),
    );
    expect(first).toEqual({ added: 3, countriesMissing: ["EG"] });
    // The same file again adds nothing.
    const again = await scoped((tx) =>
      importNoonLedger(tx, { orgId, events: parsed.events, through: "2026-09-30" }),
    );
    expect(again.added).toBe(0);

    const channels = await scoped((tx) => ledgerChannels(tx));
    expect(channels.map((c) => [c.name, c.kind, c.through, c.events])).toEqual([
      ["Noon KSA", "noon", "2026-09-30", 0],
      ["Noon UAE", "noon", "2026-09-30", 3],
    ]);
    expect(await scoped((tx) => ledgerChannels(tx), otherOrgId)).toEqual([]);
  });

  it("counts Noon's returns and losses for cost of goods sold, and lists types not read", async () => {
    const months = await scoped((tx) => salesByMonth(tx, { timezone: "Asia/Dubai" }));
    expect(months.map((m) => [m.channelName, m.month, m.returned, m.adjusted])).toEqual([
      ["Noon UAE", "2026-09", 1, -2],
    ]);
    const others = await scoped((tx) => ledgerOtherTypes(tx));
    expect(others.map((o) => [o.type, o.rows, o.units])).toEqual([["mystery", 1, 3]]);
  });
});
