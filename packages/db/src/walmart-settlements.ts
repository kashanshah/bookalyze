import type { WalmartSettlementFile } from "@bookalyze/core";
import { asc, desc, eq } from "drizzle-orm";
import type { Transaction } from "./client";
import { walmartSettlementRows, walmartSettlements } from "./schema/commerce";

/**
 * Walmart settlement reports brought in for a channel, one per report date, with their rows as
 * Walmart sent them (core `readWalmartSettlement` has already left out buyer details). Bringing
 * a date in again replaces it, so a report Walmart corrects comes in whole. Nothing posts.
 */

/** Rows are written in batches, so a long report stays within one statement's limits. */
const BATCH = 500;

export async function saveWalmartSettlement(
  tx: Transaction,
  input: {
    orgId: string;
    channelId: string;
    reportDate: string;
    file: WalmartSettlementFile;
  },
) {
  const { file } = input;
  const values = {
    periodFrom: file.periodFrom,
    periodTo: file.periodTo,
    currency: file.currency,
    payout: file.payout,
    rows: file.rows.length,
    columns: file.columns,
    broughtInAt: new Date(),
  };
  const [saved] = await tx
    .insert(walmartSettlements)
    .values({
      organizationId: input.orgId,
      channelId: input.channelId,
      reportDate: input.reportDate,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        walmartSettlements.organizationId,
        walmartSettlements.channelId,
        walmartSettlements.reportDate,
      ],
      set: values,
    })
    .returning({ id: walmartSettlements.id });
  if (!saved) throw new Error("The Walmart settlement couldn't be saved.");
  await tx.delete(walmartSettlementRows).where(eq(walmartSettlementRows.settlementId, saved.id));
  for (let i = 0; i < file.rows.length; i += BATCH) {
    await tx.insert(walmartSettlementRows).values(
      file.rows.slice(i, i + BATCH).map((data, j) => ({
        organizationId: input.orgId,
        settlementId: saved.id,
        line: i + j + 1,
        data,
      })),
    );
  }
  return saved.id;
}

/** A channel's settlements, newest first, without their rows. */
export async function listWalmartSettlements(tx: Transaction, channelId: string) {
  return tx
    .select({
      id: walmartSettlements.id,
      reportDate: walmartSettlements.reportDate,
      periodFrom: walmartSettlements.periodFrom,
      periodTo: walmartSettlements.periodTo,
      currency: walmartSettlements.currency,
      payout: walmartSettlements.payout,
      rows: walmartSettlements.rows,
      columns: walmartSettlements.columns,
      broughtInAt: walmartSettlements.broughtInAt,
    })
    .from(walmartSettlements)
    .where(eq(walmartSettlements.channelId, channelId))
    .orderBy(desc(walmartSettlements.reportDate));
}

/** The report dates already brought in for a channel. */
export async function walmartSettlementDatesIn(tx: Transaction, channelId: string) {
  const rows = await tx
    .select({ reportDate: walmartSettlements.reportDate })
    .from(walmartSettlements)
    .where(eq(walmartSettlements.channelId, channelId));
  return new Set(rows.map((r) => r.reportDate));
}

/** A settlement's rows, in the report's order. */
export async function walmartSettlementRowsOf(tx: Transaction, settlementId: string) {
  return tx
    .select({ line: walmartSettlementRows.line, data: walmartSettlementRows.data })
    .from(walmartSettlementRows)
    .where(eq(walmartSettlementRows.settlementId, settlementId))
    .orderBy(asc(walmartSettlementRows.line));
}
