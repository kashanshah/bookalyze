import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applySubscription,
  billingOrgForCustomer,
  getBilling,
  saveBillingCustomer,
  setPaymentFailed,
} from "../billing";
import { createDb, type Transaction, withBillingWriter, withOrg } from "../client";
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
const read = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);
const write = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withBillingWriter(app.db, { orgId: org }, fn);

const update = (at: string, items: string[], status = "active") => ({
  orgId,
  stripeSubscriptionId: "sub_test_1",
  status,
  interval: "month" as const,
  currentPeriodEnd: new Date("2027-01-10T00:00:00Z"),
  cancelAtPeriodEnd: false,
  items: items.map((key) => ({
    itemKey: key,
    stripeItemId: `si_${key}`,
    stripePriceId: `price_${key}_month`,
  })),
  at: new Date(at),
});

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Billing Org", slug: "billing-org", createdAt: new Date() },
      { name: "Other Billing Org", slug: "other-billing-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("billing", () => {
  it("records the Stripe customer and finds the company by it", async () => {
    await write((tx) => saveBillingCustomer(tx, { orgId, stripeCustomerId: "cus_test_1" }));
    expect(await billingOrgForCustomer(app.db, "cus_test_1")).toBe(orgId);
    expect(await billingOrgForCustomer(app.db, "cus_unknown")).toBeNull();
  });

  it("refuses billing writes from an ordinary company request", async () => {
    await expect(
      read((tx) => saveBillingCustomer(tx, { orgId, stripeCustomerId: "cus_sneaky" })),
    ).rejects.toThrow();
    await expect(
      read((tx) => applySubscription(tx, update("2026-12-01T00:00:00Z", ["seller_plus"]))),
    ).rejects.toThrow();
  });

  it("applies the subscription's items, and ignores an older event", async () => {
    expect(
      await write((tx) =>
        applySubscription(tx, update("2026-12-01T10:00:00Z", ["seller", "stock"])),
      ),
    ).toBe("applied");
    expect(
      await write((tx) => applySubscription(tx, update("2026-12-02T10:00:00Z", ["seller"]))),
    ).toBe("applied");
    expect(
      await write((tx) =>
        applySubscription(tx, update("2026-12-01T12:00:00Z", ["seller", "stock"])),
      ),
    ).toBe("stale");
    const billing = await read((tx) => getBilling(tx));
    expect(billing.subscription?.status).toBe("active");
    expect(billing.items.map((i) => i.itemKey)).toEqual(["seller"]);
    expect(billing.account?.stripeCustomerId).toBe("cus_test_1");
  });

  it("keeps the first failed payment's time, and clears it when paid", async () => {
    await write((tx) => setPaymentFailed(tx, new Date("2026-12-05T00:00:00Z")));
    await write((tx) => setPaymentFailed(tx, new Date("2026-12-08T00:00:00Z")));
    let billing = await read((tx) => getBilling(tx));
    expect(billing.subscription?.paymentFailedAt?.toISOString()).toBe("2026-12-05T00:00:00.000Z");
    await write((tx) => setPaymentFailed(tx, null));
    billing = await read((tx) => getBilling(tx));
    expect(billing.subscription?.paymentFailedAt).toBeNull();
  });

  it("shows another company nothing", async () => {
    const other = await read((tx) => getBilling(tx), otherOrgId);
    expect(other).toEqual({ account: null, subscription: null, items: [] });
  });
});
