import type { AmazonOrder } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "../banking";
import { createDb, type Transaction, withOrg } from "../client";
import { saveAmazonChannels, upsertOrders } from "../commerce";
import {
  ensureInvoiceInbox,
  getInvoiceInbox,
  invoiceInboxOrg,
  invoiceRequestForOrder,
  listInvoiceRequests,
  noteInboxEmail,
  openInvoiceRequests,
  recordInvoiceRequest,
  setInvoiceRequestStatus,
} from "../invoice-requests";
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
let channelId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org }, fn);
const TOKEN = "testtokeninvoices0000000001";

const order = (id: string): AmazonOrder => ({
  orderId: id,
  marketplaceId: "A2VIGQ35RCS4UG",
  purchasedAt: "2026-09-24T10:00:00Z",
  lastUpdatedAt: "2026-09-24T10:00:00Z",
  status: "Shipped",
  fulfillment: "amazon",
  currency: "AED",
  total: "49.0000",
  itemsShipped: 1,
  itemsUnshipped: 0,
  shipCountry: "AE",
  shipRegion: "Dubai",
  isBusiness: false,
  isPrime: false,
  isReplacement: false,
  earliestDelivery: null,
  latestDelivery: null,
});

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Invoice Requests Org", slug: "invoice-requests-org", createdAt: new Date() },
      { name: "Other Invoice Org", slug: "other-invoice-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  await scoped(async (tx) => {
    const connection = await createConnection(tx, {
      orgId,
      userId: null,
      provider: "amazon_sp",
      name: "Amazon Seller Central · Europe",
      settings: { region: "eu" },
    });
    await saveAmazonChannels(tx, {
      orgId,
      connectionId: connection.id,
      marketplaces: [
        {
          marketplaceId: "A2VIGQ35RCS4UG",
          name: "Amazon.ae",
          country: "AE",
          currency: "AED",
          participating: true,
          hasSuspendedListings: false,
          storeName: null,
        },
      ],
    });
    const [channel] = await tx.select().from(schema.salesChannels);
    channelId = channel?.id ?? "";
    await upsertOrders(tx, {
      orgId,
      channelId,
      from: "2026-09-01",
      orders: [order("171-0000000-0000001")],
    });
  });
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("invoice inbox", () => {
  it("is made once and found by its token outside any tenant", async () => {
    const first = await scoped((tx) => ensureInvoiceInbox(tx, { orgId, token: TOKEN }));
    const again = await scoped((tx) =>
      ensureInvoiceInbox(tx, { orgId, token: "differenttoken0000000000001" }),
    );
    expect(again.token).toBe(first.token);
    expect(await invoiceInboxOrg(app.db, TOKEN)).toBe(orgId);
    expect(await invoiceInboxOrg(app.db, "nosuchtoken000000000000000")).toBeNull();
  });

  it("keeps the latest other email's subject", async () => {
    await scoped((tx) =>
      noteInboxEmail(tx, {
        subject: "(#100200300) Gmail Forwarding Confirmation",
        from: "forwarding-noreply@google.com",
        at: new Date("2026-10-20T10:00:00Z"),
      }),
    );
    const inbox = await scoped((tx) => getInvoiceInbox(tx));
    expect(inbox?.lastOtherSubject).toContain("100200300");
  });

  it("is invisible to another company", async () => {
    expect(await scoped((tx) => getInvoiceInbox(tx), otherOrgId)).toBeNull();
  });
});

describe("invoice requests", () => {
  it("matches the synced order, and links one that syncs later", async () => {
    await scoped(async (tx) => {
      await recordInvoiceRequest(tx, {
        orgId,
        externalOrderId: "171-0000000-0000001",
        buyerName: "Sample Buyer",
        requestedAt: new Date("2026-10-20T09:00:00Z"),
      });
      await recordInvoiceRequest(tx, {
        orgId,
        externalOrderId: "171-0000000-0000002",
        buyerName: null,
        requestedAt: new Date("2026-10-20T09:05:00Z"),
      });
    });
    let open = await scoped((tx) => listInvoiceRequests(tx, { status: "open" }));
    expect(open).toHaveLength(2);
    expect(open.find((r) => r.externalOrderId === "171-0000000-0000002")?.orderId).toBeNull();

    await scoped((tx) =>
      upsertOrders(tx, {
        orgId,
        channelId,
        from: "2026-09-01",
        orders: [order("171-0000000-0000002")],
      }),
    );
    open = await scoped((tx) => listInvoiceRequests(tx, { status: "open" }));
    expect(open.every((r) => r.orderId)).toBe(true);
    expect((await scoped((tx) => openInvoiceRequests(tx))).count).toBe(2);
  });

  it("closes with the order, ignores the same email again, and opens on a newer request", async () => {
    const first = (await scoped((tx) => listInvoiceRequests(tx))).find(
      (r) => r.externalOrderId === "171-0000000-0000001",
    );
    const orderId = first?.orderId ?? "";
    expect(
      await scoped((tx) => setInvoiceRequestStatus(tx, { orderId, status: "done", userId: null })),
    ).toBe(1);
    const repeat = await scoped((tx) =>
      recordInvoiceRequest(tx, {
        orgId,
        externalOrderId: "171-0000000-0000001",
        buyerName: "Sample Buyer",
        requestedAt: new Date("2026-10-20T09:00:00Z"),
      }),
    );
    expect(repeat).toBeNull();
    let row = await scoped((tx) =>
      invoiceRequestForOrder(tx, { orderId, externalId: "171-0000000-0000001" }),
    );
    expect(row?.status).toBe("done");

    await scoped((tx) =>
      recordInvoiceRequest(tx, {
        orgId,
        externalOrderId: "171-0000000-0000001",
        buyerName: null,
        requestedAt: new Date(Date.now() + 60_000),
      }),
    );
    row = await scoped((tx) =>
      invoiceRequestForOrder(tx, { orderId, externalId: "171-0000000-0000001" }),
    );
    expect(row?.status).toBe("open");
    expect(row?.buyerName).toBe("Sample Buyer");
  });

  it("can't be read by another company", async () => {
    expect(await scoped((tx) => listInvoiceRequests(tx), otherOrgId)).toEqual([]);
  });
});
