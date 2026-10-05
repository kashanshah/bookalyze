import { complianceCalendar } from "@bookalyze/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAttachment, listUnlinkedAttachments, markAttachmentReady } from "../attachments";
import { createDb, type Transaction, withOrg } from "../client";
import {
  completedOccurrences,
  complianceInput,
  createEntityDocument,
  deleteEntityDocument,
  listEntityDocuments,
  recordReminder,
  saveComplianceItem,
  saveEntityDetails,
  saveIdentifier,
  savePerson,
  sentReminders,
  setOccurrenceDone,
} from "../entity";
import { createDefaultChart } from "../ledger";
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
const code: Record<string, string> = {};
const scoped = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId }, fn);

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const [org] = await owner.db
    .insert(schema.organization)
    .values({ name: "Entity Org", slug: "entity-org", createdAt: new Date() })
    .returning({ id: schema.organization.id });
  if (!org) throw new Error("Failed to create organization");
  orgId = org.id;
  await scoped((tx) => createDefaultChart(tx, { orgId, baseCurrency: "CAD" }));
  const [card] = await scoped((tx) =>
    tx
      .insert(schema.accounts)
      .values({
        organizationId: orgId,
        code: "2100",
        name: "Visa",
        type: "liability",
        subtype: "credit_card",
        currency: "CAD",
      })
      .returning(),
  );
  const all = await scoped((tx) => tx.select().from(schema.accounts));
  for (const a of all) if (a.code) code[a.code] = a.id;
  if (card) code["2100"] = card.id;
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("entity & compliance", () => {
  it("builds the calendar from the company's details, documents and own items", async () => {
    await scoped(async (tx) => {
      await saveEntityDetails(tx, {
        orgId,
        jurisdiction: "CA-ON",
        registeredAddress: "1 King St W",
      });
      await saveIdentifier(tx, {
        orgId,
        kind: "ca_bn",
        label: null,
        value: "123456789",
        expiresOn: null,
        notes: null,
      });
      await savePerson(tx, {
        orgId,
        name: "Sam Director",
        roles: ["director", "shareholder"],
        title: "President",
        ownershipPercent: "100",
        email: null,
        startDate: "2020-03-15",
        endDate: null,
        notes: null,
      });
      await saveComplianceItem(tx, {
        orgId,
        title: "WSIB premium",
        notes: null,
        firstDue: "2027-01-31",
        recurrence: "quarterly",
      });
    });
    // A document in the vault: linked, so not in the receipts inbox.
    const attachmentId = crypto.randomUUID();
    await scoped(async (tx) => {
      await createAttachment(tx, {
        id: attachmentId,
        orgId,
        storageKey: `${orgId}/${attachmentId}`,
        fileName: "articles.pdf",
        contentType: "application/pdf",
        sizeBytes: 1200,
      });
      await markAttachmentReady(tx, attachmentId);
    });
    const doc = await scoped((tx) =>
      createEntityDocument(tx, {
        orgId,
        attachmentId,
        title: "Insurance certificate",
        kind: "other",
        expiresOn: "2027-03-01",
      }),
    );
    expect((await scoped((tx) => listUnlinkedAttachments(tx))).map((a) => a.id)).not.toContain(
      attachmentId,
    );
    expect((await scoped((tx) => listEntityDocuments(tx))).map((d) => d.fileName)).toEqual([
      "articles.pdf",
    ]);

    const input = await scoped((tx) =>
      complianceInput(tx, {
        country: "CA",
        entityType: "corporation",
        incorporationDate: "2020-03-15",
        fiscal: { endMonth: 12, endDay: 31 },
      }),
    );
    expect(
      complianceCalendar(input, "2027-01-01", "2027-06-30").map((i) => [i.dueDate, i.key]),
    ).toEqual([
      ["2027-01-31", expect.stringMatching(/^custom:/)],
      ["2027-02-28", "rule:ca_t2_balance"],
      ["2027-03-01", `document:${doc.id}`],
      ["2027-04-30", expect.stringMatching(/^custom:/)],
      ["2027-05-14", "rule:ca_on_annual_return"],
      ["2027-06-30", "rule:ca_t2"],
    ]);

    // Done ticks and reminders are kept per occurrence.
    await scoped((tx) =>
      setOccurrenceDone(tx, { orgId, itemKey: "rule:ca_t2", dueDate: "2027-06-30", done: true }),
    );
    expect(await scoped((tx) => completedOccurrences(tx))).toEqual(
      new Set(["rule:ca_t2|2027-06-30"]),
    );
    await scoped((tx) =>
      setOccurrenceDone(tx, { orgId, itemKey: "rule:ca_t2", dueDate: "2027-06-30", done: false }),
    );
    expect(await scoped((tx) => completedOccurrences(tx))).toEqual(new Set());
    await scoped((tx) =>
      recordReminder(tx, { orgId, itemKey: "rule:ca_t2", dueDate: "2027-06-30", leadDays: 30 }),
    );
    await scoped((tx) =>
      recordReminder(tx, { orgId, itemKey: "rule:ca_t2", dueDate: "2027-06-30", leadDays: 30 }),
    );
    expect(await scoped((tx) => sentReminders(tx, ["rule:ca_t2"]))).toEqual(
      new Map([["rule:ca_t2|2027-06-30", new Set([30])]]),
    );

    // Deleting a document takes its file with it.
    const key = await scoped((tx) => deleteEntityDocument(tx, doc.id));
    expect(key).toBe(`${orgId}/${attachmentId}`);
    expect(await scoped((tx) => listEntityDocuments(tx))).toEqual([]);
  });
});
