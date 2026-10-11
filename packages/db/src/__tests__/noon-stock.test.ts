import { noonMarketplace, parseNoonLedger, parseNoonStockSummary } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg } from "../client";
import { addNoonChannel } from "../commerce";
import { createProduct, linkSku } from "../inventory";
import { importNoonLedger } from "../inventory-ledger";
import { importNoonStockDays, noonLedgerCheck, noonStockByProduct } from "../noon-stock";
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
let productId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);

// Noon's headers; synthetic rows. UAE's warehouse is DXB01, KSA's RUH01.
const LEDGER = [
  "transaction_date,transaction_type,reference_nr,reference_type,country_code,warehouse_code,fulfillment_type,nfsku,sku,partner_sku,partner_barcode,inventory_condition,quantity_delta,qc_fail_item_identifier",
  "2026-09-02,outbound,NAE001,customer_order,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,-2,",
  "2026-09-03,customer_return,NAE002,customer_order,AE,DXB01,FBN,N1,Z1,MUG-1,111,sellable,1,",
  "2026-09-02,outbound,NSA001,customer_order,SA,RUH01,FBN,N1,Z1,MUG-1,111,sellable,-1,",
].join("\n");
const SUMMARY = [
  "date,location,nfsku,sku,partner_sku,partner_barcode,inventory_condition,opening_quantity,inbound_quantity,vendor_return_quantity,disposal_quantity,customer_outbound_quantity,customer_return_quantity,transfer_in_quantity,transfer_out_quantity,transit_quantity,lost_quantity,found_quantity,damaged_quantity,other_quantity,closing_quantity",
  "2026-09-02,DXB01,N1,Z1,MUG-1,111,sellable,10,0,0,0,2,0,0,0,0,0,0,0,0,8",
  // Noon's summary misses the return the detailed ledger has.
  "2026-09-03,DXB01,N1,Z1,MUG-1,111,sellable,8,0,0,0,0,0,0,0,0,0,0,0,0,8",
  // After the detailed ledger's last day: not checked.
  "2026-09-04,DXB01,N1,Z1,MUG-1,111,sellable,8,0,0,0,1,0,0,0,0,0,0,0,0,7",
  "2026-09-04,DXB01,N1,Z1,MUG-1,111,damaged,0,0,0,0,0,0,0,0,0,0,0,1,0,1",
  "2026-09-04,DXB01,N2,Z2,MUG-2,222,sellable,3,0,0,0,0,0,0,0,0,0,0,0,0,3",
  "2026-09-02,RUH01,N1,Z1,MUG-1,111,sellable,5,0,0,0,1,0,0,0,0,0,0,0,0,4",
  "2026-09-04,RUH01,N1,Z1,MUG-1,111,sellable,4,0,0,0,0,0,0,0,0,0,0,0,0,4",
].join("\n");

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Noon Stock Org", slug: "noon-stock-org", createdAt: new Date() },
      { name: "Other Noon Stock Org", slug: "other-noon-stock-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  const channels: Record<string, string> = {};
  for (const id of ["noon-ae", "noon-sa"]) {
    const marketplace = noonMarketplace(id);
    if (!marketplace) throw new Error(`${id} is missing.`);
    const { channel } = await scoped((tx) =>
      addNoonChannel(tx, { orgId, marketplace, fulfilment: "marketplace" }),
    );
    channels[id] = channel.id;
  }
  const product = await scoped((tx) =>
    createProduct(tx, { orgId, userId: null, name: "Mug", sku: null, notes: null }),
  );
  productId = product.id;
  const uae = channels["noon-ae"] ?? "";
  await scoped(async (tx) => {
    await linkSku(tx, { orgId, userId: null, productId, channelId: uae, sku: "MUG-1", units: 1 });
    await linkSku(tx, { orgId, userId: null, productId, channelId: uae, sku: "MUG-2", units: 2 });
  });
  const ledger = parseNoonLedger(LEDGER);
  if (!ledger.ok) throw new Error(ledger.error);
  await scoped((tx) =>
    importNoonLedger(tx, { orgId, events: ledger.events, through: "2026-09-03" }),
  );
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("Noon's FBN ledger summary", () => {
  it("keeps one row per day, warehouse, SKU and condition", async () => {
    const parsed = parseNoonStockSummary(SUMMARY);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(await scoped((tx) => importNoonStockDays(tx, { orgId, rows: parsed.rows }))).toEqual({
      saved: 7,
    });
    // Brought in again, the days are replaced, not added.
    await scoped((tx) => importNoonStockDays(tx, { orgId, rows: parsed.rows }));
    const rows = await owner.db.select().from(schema.noonStockDays);
    expect(rows.filter((r) => r.organizationId === orgId)).toHaveLength(7);
  });

  it("says what Noon holds per product on its latest day, through each warehouse's channel", async () => {
    // MUG-1 at DXB01 (7) and MUG-2 (3 two-packs) are linked on Noon UAE; KSA's MUG-1 isn't.
    expect(await scoped((tx) => noonStockByProduct(tx))).toEqual({
      date: "2026-09-04",
      products: [{ productId, sellable: 13, other: 1 }],
    });
    expect(await scoped((tx) => noonStockByProduct(tx), otherOrgId)).toEqual({
      date: null,
      products: [],
    });
  });

  it("checks the detailed ledger against the summary on the days both cover", async () => {
    expect(await scoped((tx) => noonLedgerCheck(tx))).toEqual({
      from: "2026-09-02",
      to: "2026-09-03",
      mismatches: [{ date: "2026-09-03", sku: "MUG-1", summary: 0, ledger: 1 }],
    });
    expect(await scoped((tx) => noonLedgerCheck(tx), otherOrgId)).toEqual({
      from: null,
      to: null,
      mismatches: [],
    });
  });
});
