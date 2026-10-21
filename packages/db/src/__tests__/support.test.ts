import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Transaction, withOrg, withSupportDesk } from "../client";
import * as schema from "../schema";
import {
  addSupportMessage,
  countSupportRepliesWaiting,
  createSupportTicket,
  getSupportTicket,
  listSupportTickets,
  setSupportTicketStatus,
  supportStatusCounts,
  supportTicketByToken,
  updateSupportTicketDesk,
} from "../support";

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
let userId: string;
let agentId: string;
const scoped = <T>(fn: (tx: Transaction) => Promise<T>, org = orgId) =>
  withOrg(app.db, { orgId: org, userId }, fn);
const desk = <T>(fn: (tx: Transaction) => Promise<T>) =>
  withSupportDesk(app.db, { userId: agentId }, fn);
const token = (n: number) => `supporttesttoken${String(n).padStart(8, "0")}`;

beforeAll(async () => {
  const orgs = await owner.db
    .insert(schema.organization)
    .values([
      { name: "Support Org", slug: "support-org", createdAt: new Date() },
      { name: "Other Support Org", slug: "other-support-org", createdAt: new Date() },
    ])
    .returning({ id: schema.organization.id });
  orgId = orgs[0]?.id ?? "";
  otherOrgId = orgs[1]?.id ?? "";
  const users = await owner.db
    .insert(schema.user)
    .values([
      { name: "Sam Seller", email: "sam@support-test.example" },
      { name: "Avery Agent", email: "avery@support-test.example" },
    ])
    .returning({ id: schema.user.id });
  userId = users[0]?.id ?? "";
  agentId = users[1]?.id ?? "";
});

afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

const newTicket = (n: number, org: string | null = orgId) => ({
  orgId: org,
  requesterUserId: org ? userId : null,
  requesterEmail: "Sam@Support-Test.example",
  requesterName: "Sam Seller",
  subject: `Payout not matching ${n}`,
  topic: "help" as const,
  body: "My Amazon payout doesn't match the deposit.",
  source: org ? ("app" as const) : ("website" as const),
  token: token(n),
});

describe("support tickets", () => {
  it("numbers tickets in one sequence for everyone", async () => {
    const a = await scoped((tx) => createSupportTicket(tx, newTicket(1)));
    const b = await scoped((tx) => createSupportTicket(tx, newTicket(2, otherOrgId)), otherOrgId);
    const c = await desk((tx) => createSupportTicket(tx, newTicket(3, null)));
    expect(b.number).toBe(a.number + 1);
    expect(c.number).toBe(b.number + 1);
  });

  it("shows a company only its own tickets, and the desk every ticket", async () => {
    const mine = await scoped((tx) => listSupportTickets(tx));
    expect(mine.map((t) => t.subject)).toEqual(["Payout not matching 1"]);
    expect(mine[0]?.orgName).toBe("Support Org");
    expect(mine[0]?.requesterEmail).toBe("sam@support-test.example");
    const all = await desk((tx) => listSupportTickets(tx));
    expect(all.map((t) => t.subject).sort()).toEqual([
      "Payout not matching 1",
      "Payout not matching 2",
      "Payout not matching 3",
    ]);
    const website = all.find((t) => t.source === "website");
    expect(website?.orgId).toBeNull();
  });

  it("refuses a company writing a ticket for another company", async () => {
    await expect(
      scoped((tx) => createSupportTicket(tx, newTicket(4, otherOrgId))),
    ).rejects.toThrow();
    await expect(scoped((tx) => createSupportTicket(tx, newTicket(5, null)))).rejects.toThrow();
  });

  it("moves the ticket between the desk and the customer, and keeps notes internal", async () => {
    const ticket = await desk((tx) => supportTicketByToken(tx, token(1)));
    if (!ticket) throw new Error("no ticket");
    expect(ticket.status).toBe("waiting_on_us");
    await desk((tx) =>
      addSupportMessage(tx, {
        ticketId: ticket.id,
        authorUserId: agentId,
        authorEmail: null,
        authorName: null,
        fromSupport: true,
        internal: true,
        body: "Looks like an AED payout into a CAD account.",
      }),
    );
    expect((await desk((tx) => getSupportTicket(tx, ticket.id)))?.status).toBe("waiting_on_us");
    await desk((tx) =>
      addSupportMessage(tx, {
        ticketId: ticket.id,
        authorUserId: agentId,
        authorEmail: null,
        authorName: null,
        fromSupport: true,
        body: "Match it at the bank's rate; the difference posts as an exchange loss.",
      }),
    );
    expect(await scoped((tx) => countSupportRepliesWaiting(tx))).toBe(1);
    const seen = await scoped((tx) => getSupportTicket(tx, ticket.id));
    expect(seen?.status).toBe("waiting_on_you");
    expect(seen?.messages.map((m) => m.fromSupport)).toEqual([false, true]);
    expect(seen?.messages[1]?.authorName).toBe("Avery Agent");
    const deskView = await desk((tx) => getSupportTicket(tx, ticket.id));
    expect(deskView?.messages.filter((m) => m.internal)).toHaveLength(1);

    await scoped((tx) => setSupportTicketStatus(tx, ticket.id, "solved"));
    await scoped((tx) =>
      addSupportMessage(tx, {
        ticketId: ticket.id,
        authorUserId: userId,
        authorEmail: "sam@support-test.example",
        authorName: "Sam Seller",
        fromSupport: false,
        body: "One more question.",
      }),
    );
    expect((await scoped((tx) => getSupportTicket(tx, ticket.id)))?.status).toBe("waiting_on_us");
    expect(await scoped((tx) => countSupportRepliesWaiting(tx))).toBe(0);
  });

  it("refuses notes from customers and posting onto another company's ticket", async () => {
    const other = await desk((tx) => supportTicketByToken(tx, token(2)));
    if (!other) throw new Error("no ticket");
    await expect(
      scoped((tx) =>
        addSupportMessage(tx, {
          ticketId: other.id,
          authorUserId: userId,
          authorEmail: null,
          authorName: null,
          fromSupport: false,
          body: "Hello",
        }),
      ),
    ).rejects.toThrow();
    const mine = await desk((tx) => supportTicketByToken(tx, token(1)));
    await expect(
      scoped((tx) =>
        addSupportMessage(tx, {
          ticketId: mine?.id ?? "",
          authorUserId: userId,
          authorEmail: null,
          authorName: null,
          fromSupport: false,
          internal: true,
          body: "Secret",
        }),
      ),
    ).rejects.toThrow("Only the support desk");
  });

  it("adds an emailed reply once, and copies the ticket's company onto it", async () => {
    const ticket = await desk((tx) => supportTicketByToken(tx, token(1)));
    if (!ticket) throw new Error("no ticket");
    const reply = {
      ticketId: ticket.id,
      authorUserId: null,
      authorEmail: "sam@support-test.example",
      authorName: "Sam Seller",
      fromSupport: false,
      body: "Thanks, that worked.",
      via: "email" as const,
      emailRef: "email-123",
    };
    expect(await desk((tx) => addSupportMessage(tx, reply))).not.toBeNull();
    expect(await desk((tx) => addSupportMessage(tx, reply))).toBeNull();
    const seen = await scoped((tx) => getSupportTicket(tx, ticket.id));
    expect(seen?.messages.at(-1)?.body).toBe("Thanks, that worked.");
  });

  it("lets the desk assign and prioritise, and counts the queue", async () => {
    const ticket = await desk((tx) => supportTicketByToken(tx, token(3)));
    if (!ticket) throw new Error("no ticket");
    await desk((tx) =>
      updateSupportTicketDesk(tx, ticket.id, { assignedTo: agentId, priority: "high" }),
    );
    const updated = await desk((tx) => getSupportTicket(tx, ticket.id));
    expect(updated?.assignedTo).toBe(agentId);
    expect(updated?.priority).toBe("high");
    const counts = await desk((tx) => supportStatusCounts(tx));
    expect(counts.waiting_on_us).toBe(3);
  });

  it("hides tickets without a company or a desk", async () => {
    const none = await app.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('role', 'app_runtime', true)`);
      return listSupportTickets(tx);
    });
    expect(none).toEqual([]);
  });

  it("opens no other tenant table as the desk, even on the owner's connection", async () => {
    await owner.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, type: "vendor", name: "Desk-hidden vendor" });
    const seen = await withSupportDesk(owner.db, { userId: agentId }, (tx) =>
      tx.select().from(schema.contacts),
    );
    expect(seen).toEqual([]);
    const tickets = await withSupportDesk(owner.db, { userId: agentId }, (tx) =>
      listSupportTickets(tx),
    );
    expect(tickets.length).toBeGreaterThan(0);
  });
});
