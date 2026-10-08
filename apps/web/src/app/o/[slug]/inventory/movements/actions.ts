"use server";

import { LEDGER_EVENT_TYPES } from "@bookalyze/core";
import { importLedgerEvents, inventoryChannels } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { syncChannelLedger } from "@/server/amazon-ledger";
import { audit } from "@/server/audit";
import { getInventoryContext } from "@/server/inventory";

const FEATURE = "inventory.cogs";
type Result = { ok: true; added: number; waiting?: boolean } | { ok: false; message: string };

/** Brings in each active marketplace's FBA inventory ledger from Amazon, up to yesterday. */
export async function syncLedgerAction(slug: string): Promise<Result> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const channels = (await inOrg(ctx, (tx) => inventoryChannels(tx))).filter((c) => c.isActive);
  const deadline = Date.now() + 50_000;
  let added = 0;
  let waiting = false;
  let error: string | null = null;
  for (const channel of channels) {
    if (Date.now() >= deadline) {
      waiting = true;
      break;
    }
    const r = await syncChannelLedger(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      channel.id,
      deadline,
    );
    added += r.added;
    waiting ||= r.waiting;
    error ??= r.error;
  }
  revalidatePath(`/o/${slug}/inventory`, "layout");
  if (error && !added) return { ok: false, message: error };
  return { ok: true, added, waiting };
}

const day = z.string().refine(isIsoDate);
const eventSchema = z.object({
  date: day,
  sku: z.string().min(1).max(200),
  fnsku: z.string().max(50).nullable(),
  asin: z.string().max(20).nullable(),
  title: z.string().max(500).nullable(),
  eventType: z.enum([...LEDGER_EVENT_TYPES, "Other"]),
  referenceId: z.string().max(100).nullable(),
  quantity: z.number().int().min(-1_000_000).max(1_000_000),
  fulfillmentCenter: z.string().max(20).nullable(),
  disposition: z.string().max(50).nullable(),
  reason: z.string().max(50).nullable(),
  country: z.string().max(10).nullable(),
  key: z.string().min(1).max(1000),
});
const uploadSchema = z.object({
  channelId: z.uuid(),
  events: z.array(eventSchema).max(2000),
  /** Set on the last part of a file: the day the report runs to. */
  through: day.nullable(),
});

/** One part (up to 2,000 rows) of a ledger file read in the browser. */
export async function uploadLedgerAction(slug: string, input: unknown): Promise<Result> {
  const ctx = await getInventoryContext(slug, FEATURE);
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That file couldn't be read as a ledger." };
  const { channelId, events, through } = parsed.data;
  const added = await inOrg(ctx, async (tx) => {
    const channels = await inventoryChannels(tx);
    if (!channels.some((c) => c.id === channelId)) return null;
    const r = await importLedgerEvents(tx, { orgId: ctx.org.id, channelId, events, through });
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "inventory_ledger.uploaded",
      entityType: "sales_channel",
      entityId: channelId,
      after: { rows: events.length, added: r.added, through },
    });
    return r.added;
  });
  if (added === null) return { ok: false, message: "Choose a marketplace." };
  revalidatePath(`/o/${slug}/inventory`, "layout");
  return { ok: true, added };
}
