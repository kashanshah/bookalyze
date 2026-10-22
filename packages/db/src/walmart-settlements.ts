import {
  storeWalmartTotals,
  WALMART_READER_VERSION,
  type WalmartSettlementFile,
  walmartSettlementTotals,
} from "@bookalyze/core";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { Transaction } from "./client";
import { walmartSettlementRows, walmartSettlements } from "./schema/commerce";

/**
 * Walmart settlement reports brought in for a channel, one per report date, with their rows as
 * Walmart sent them (core `readWalmartSettlement` has already left out buyer details). Bringing
 * a date in again replaces it, so a report Walmart corrects comes in whole. Its rows are added up
 * by group as it's saved (core `walmartSettlementTotals`), for posting (`walmart-posting.ts`).
 *
 * A report uploaded from Seller Center is the same report: one for a period already in replaces
 * it (under the date it's kept under), and the API's report for an uploaded period takes the
 * uploaded one's place, so a settlement is never in twice.
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
    source?: "api" | "upload";
  },
) {
  const { file } = input;
  const source = input.source ?? "api";
  let reportDate = input.reportDate;
  if (file.periodFrom && file.periodTo) {
    const [same] = await tx
      .select({
        id: walmartSettlements.id,
        reportDate: walmartSettlements.reportDate,
        source: walmartSettlements.source,
      })
      .from(walmartSettlements)
      .where(
        and(
          eq(walmartSettlements.channelId, input.channelId),
          eq(walmartSettlements.periodFrom, file.periodFrom),
          eq(walmartSettlements.periodTo, file.periodTo),
          ne(walmartSettlements.reportDate, reportDate),
        ),
      )
      .limit(1);
    if (same && source === "upload") {
      // Seller Center's copy of a settlement already in: kept under the date it has.
      reportDate = same.reportDate;
    } else if (same && same.source === "upload") {
      // Walmart's API now has the report that was uploaded: it moves to the API's date.
      await tx
        .update(walmartSettlements)
        .set({ reportDate })
        .where(eq(walmartSettlements.id, same.id));
    }
  }
  const values = {
    source,
    periodFrom: file.periodFrom,
    periodTo: file.periodTo,
    currency: file.currency,
    payout: file.payout,
    rows: file.rows.length,
    columns: file.columns,
    totals: storeWalmartTotals(walmartSettlementTotals(file.columns, file.rows)),
    totalsVersion: WALMART_READER_VERSION,
    broughtInAt: new Date(),
  };
  const [saved] = await tx
    .insert(walmartSettlements)
    .values({
      organizationId: input.orgId,
      channelId: input.channelId,
      reportDate,
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
      source: walmartSettlements.source,
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
