"use server";

import { can, NOON_AMOUNT_FIELDS } from "@bookalyze/core";
import { getNoonConnection, importNoonTransactions, type NoonImportResult } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { logError } from "@/server/log";
import { type NoonSyncResult, syncNoonTransactions } from "@/server/noon-transactions";
import { isOrgAdmin } from "@/server/org";

export type NoonResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function noonContext(slug: string) {
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) {
    return { ctx, denied: { ok: false, message: "Payouts aren't part of this company's plan." } };
  }
  if (!isOrgAdmin(ctx)) {
    return {
      ctx,
      denied: { ok: false, message: "Only owners and admins can bring in Noon's transactions." },
    };
  }
  return { ctx, denied: null };
}

const revalidate = (slug: string) => revalidatePath(`/o/${slug}/commerce/noon`);

/**
 * Brings in Noon's transactions through its API for up to ~25 seconds: a year back, a month at
 * a time. `more` says to call again (each month is a report Noon makes in the background).
 */
export async function syncNoonTransactionsAction(
  slug: string,
): Promise<NoonResult<NoonSyncResult>> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  try {
    const result = await syncNoonTransactions(
      { orgId: ctx.org.id, userId: ctx.session.user.id },
      nowIn(ctx.profile.timezone).date,
      25_000,
    );
    if (!result) {
      return { ok: false, message: "Connect Noon's API on the Channels page first." };
    }
    revalidate(slug);
    return { ok: true, ...result };
  } catch (error) {
    logError("noon.transactions_sync_failed", error, { orgId: ctx.org.id });
    return {
      ok: false,
      message: "Noon's transactions couldn't be brought in. Try again in a minute.",
    };
  }
}

const amount = z.string().regex(/^-?\d+(\.\d{1,4})?$/);
const day = z.iso.date();
const text = (max: number) => z.string().trim().min(1).max(max);
/** A row of Noon's transaction view, read in the browser (core `parseNoonTransactions`). */
const rowSchema = z.object({
  contract: text(200).nullable(),
  referenceNr: text(200),
  orderNr: text(200).nullable(),
  itemNr: text(200).nullable(),
  orderDate: day.nullable(),
  transactionDate: day,
  title: text(500).nullable(),
  sku: text(200).nullable(),
  partnerSku: text(200).nullable(),
  transactionType: text(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amounts: z.record(z.enum(NOON_AMOUNT_FIELDS), amount),
  total: amount,
  balanced: z.boolean(),
  key: text(1_500),
});
/** Rows per call: a year's file is sent in parts. */
const UPLOAD_ROWS = 1_000;
const uploadSchema = z.object({
  fileName: z.string().max(200),
  rows: z.array(rowSchema).min(1).max(UPLOAD_ROWS),
});

/**
 * Adds rows of Noon's transaction view from a file (seller portal → Finance → Transaction view),
 * read in the browser and sent in parts. Rows already in only get their amounts refreshed.
 */
export async function uploadNoonTransactionsAction(
  slug: string,
  input: z.input<typeof uploadSchema>,
): Promise<NoonResult<NoonImportResult>> {
  const { ctx, denied } = await noonContext(slug);
  if (denied) return denied as { ok: false; message: string };
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those rows couldn't be read." };
  const { rows, fileName } = parsed.data;
  const result = await inOrg(ctx, async (tx) => {
    const connection = await getNoonConnection(tx);
    const saved = await importNoonTransactions(tx, {
      orgId: ctx.org.id,
      rows,
      source: "upload",
      connectionId: connection && connection.status !== "disconnected" ? connection.id : null,
    });
    const dates = rows.map((r) => r.transactionDate).sort();
    await audit(tx, {
      orgId: ctx.org.id,
      actorUserId: ctx.session.user.id,
      action: "noon.transactions_uploaded",
      entityType: "organization",
      entityId: ctx.org.id,
      after: { fileName, from: dates[0], to: dates.at(-1), ...saved },
    });
    return saved;
  });
  revalidate(slug);
  return { ok: true, ...result };
}
