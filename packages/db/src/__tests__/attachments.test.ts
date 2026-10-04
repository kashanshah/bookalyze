import { prepareJournalEntry, transactionLines } from "@bookalyze/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countAttachments,
  createAttachment,
  deleteAttachment,
  linkAttachments,
  listAttachmentsFor,
  listUnlinkedAttachments,
  markAttachmentReady,
  unlinkAttachment,
} from "../attachments";
import { createDb, type Transaction, withOrg } from "../client";
import { createDefaultChart, postJournalEntry } from "../ledger";
import * as schema from "../schema";
import { replaceJournalEntry } from "../transactions";

const ownerUrl =
  process.env.TEST_DATABASE_URL_MIGRATOR ??
  "postgres://bookalyze_owner:bookalyze_owner@localhost:5432/bookalyze_test";
const appUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://bookalyze_app:bookalyze_app@localhost:5432/bookalyze_test";
const owner = createDb(ownerUrl, { max: 1 });
const app = createDb(appUrl, { max: 2 });

let orgA: string;
let orgB: string;
const inA = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId: orgA }, fn);
const inB = <T>(fn: (tx: Transaction) => Promise<T>) => withOrg(app.db, { orgId: orgB }, fn);

async function upload(orgId: string, name: string, ready = true) {
  const id = crypto.randomUUID();
  const scoped = orgId === orgA ? inA : inB;
  await scoped(async (tx) => {
    await createAttachment(tx, {
      id,
      orgId,
      storageKey: `org/${orgId}/attachments/${id}/${name}`,
      fileName: name,
      contentType: "application/pdf",
      sizeBytes: 1234,
    });
    if (ready) await markAttachmentReady(tx, id);
  });
  return id;
}

async function postSale(amount: string) {
  const all = await inA((tx) => tx.select().from(schema.accounts));
  const code = new Map(all.map((a) => [a.code, a.id]));
  const prepared = prepareJournalEntry(
    {
      currency: "CAD",
      baseCurrency: "CAD",
      lines: transactionLines({
        kind: "deposit",
        moneyAccountId: code.get("1000") as string,
        splits: [{ accountId: code.get("4000") as string, amount }],
      }),
    },
    new Map(all.map((a) => [a.id, a])),
  );
  if (!prepared.ok) throw new Error("bad entry");
  return prepared.entry;
}

beforeAll(async () => {
  await owner.db
    .insert(schema.currencies)
    .values({ code: "CAD", name: "Canadian Dollar", minorUnits: 2 })
    .onConflictDoNothing();
  const [a, b] = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Files A", slug: "files-a", createdAt: new Date() },
      { name: "Files B", slug: "files-b", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  if (!a || !b) throw new Error("Failed to create organizations");
  orgA = a.id;
  orgB = b.id;
  await inA((tx) => createDefaultChart(tx, { orgId: orgA, baseCurrency: "CAD" }));
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe("attachments", () => {
  it("keeps files per organization and only lists finished uploads in the inbox", async () => {
    const receipt = await upload(orgA, "receipt.pdf");
    await upload(orgA, "half-uploaded.pdf", false);
    await upload(orgB, "other.pdf");
    const inbox = await inA((tx) => listUnlinkedAttachments(tx));
    expect(inbox.map((a) => a.fileName)).toEqual(["receipt.pdf"]);
    expect((await inB((tx) => listUnlinkedAttachments(tx))).map((a) => a.fileName)).toEqual([
      "other.pdf",
    ]);
    expect(
      await inB((tx) =>
        tx.select().from(schema.attachments).where(eq(schema.attachments.id, receipt)),
      ),
    ).toEqual([]);
  });

  it("links, counts and unlinks receipts on an entry, and follows the entry when it's replaced", async () => {
    const entry = await postSale("100");
    const posted = await inA((tx) =>
      postJournalEntry(tx, { orgId: orgA, date: "2026-07-01", entry }),
    );
    const r1 = await upload(orgA, "one.jpg");
    const r2 = await upload(orgA, "two.jpg");
    const pending = await upload(orgA, "pending.jpg", false);
    const linked = await inA((tx) =>
      linkAttachments(tx, {
        orgId: orgA,
        attachmentIds: [r1, r2, pending],
        entityType: "journal_entry",
        entityId: posted.id,
      }),
    );
    expect(linked).toBe(2);
    expect(
      (await inA((tx) => countAttachments(tx, "journal_entry", [posted.id]))).get(posted.id),
    ).toBe(2);
    expect((await inA((tx) => listUnlinkedAttachments(tx))).map((a) => a.fileName)).not.toContain(
      "one.jpg",
    );

    const replaced = await inA(async (tx) =>
      replaceJournalEntry(tx, {
        orgId: orgA,
        entryId: posted.id,
        date: "2026-07-01",
        entry: await postSale("120"),
      }),
    );
    const files = await inA((tx) => listAttachmentsFor(tx, "journal_entry", replaced.id));
    expect(files.map((f) => f.fileName)).toEqual(["one.jpg", "two.jpg"]);

    await inA((tx) =>
      unlinkAttachment(tx, {
        attachmentId: r2,
        entityType: "journal_entry",
        entityId: replaced.id,
      }),
    );
    expect(
      (await inA((tx) => listAttachmentsFor(tx, "journal_entry", replaced.id))).map(
        (f) => f.fileName,
      ),
    ).toEqual(["one.jpg"]);
  });

  it("can't link another organization's file", async () => {
    const foreign = await upload(orgB, "foreign.pdf");
    const entry = await postSale("5");
    const posted = await inA((tx) =>
      postJournalEntry(tx, { orgId: orgA, date: "2026-07-02", entry }),
    );
    // Not visible through RLS, so nothing is linked.
    const linked = await inA((tx) =>
      linkAttachments(tx, {
        orgId: orgA,
        attachmentIds: [foreign],
        entityType: "journal_entry",
        entityId: posted.id,
      }),
    );
    expect(linked).toBe(0);
  });

  it("deletes a file and returns its storage key", async () => {
    const id = await upload(orgA, "delete-me.pdf");
    const key = await inA((tx) => deleteAttachment(tx, id));
    expect(key).toContain("delete-me.pdf");
    expect(await inA((tx) => deleteAttachment(tx, id))).toBeNull();
  });
});
