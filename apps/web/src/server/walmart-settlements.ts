import "server-only";
import { readWalmartSettlement, type WalmartCredentials } from "@bookalyze/core";
import { getDb, saveWalmartSettlement, walmartSettlementDatesIn, withOrg } from "@bookalyze/db";
import { downloadWalmartSettlement, WalmartError, walmartSettlementDates } from "./walmart";

/**
 * Bringing a Walmart channel's settlement reports in: the dates Walmart has a report for that
 * aren't in yet, oldest first, each downloaded, read (buyer details left out) and kept row by
 * row, within a time budget. A run that runs out of time says so; the next carries on.
 */
export async function bringInWalmartSettlements(
  ctx: { orgId: string; userId: string | null },
  input: { channelId: string; market: string; creds: WalmartCredentials },
  deadline: number,
): Promise<{ added: number; available: number; more: boolean }> {
  const dates = await walmartSettlementDates(input.creds, input.market);
  const have = await withOrg(getDb(), ctx, (tx) => walmartSettlementDatesIn(tx, input.channelId));
  const missing = dates.filter((d) => !have.has(d)).sort();
  let added = 0;
  for (const date of missing) {
    if (Date.now() >= deadline) break;
    const bytes = await downloadWalmartSettlement(input.creds, input.market, date);
    let file: ReturnType<typeof readWalmartSettlement>;
    try {
      file = readWalmartSettlement(new TextDecoder("utf-8").decode(bytes));
    } catch (cause) {
      throw new WalmartError(
        `Walmart's settlement report for ${date} couldn't be read. Check it with "Check this report".`,
        "unexpected",
        { cause },
      );
    }
    await withOrg(getDb(), ctx, (tx) =>
      saveWalmartSettlement(tx, {
        orgId: ctx.orgId,
        channelId: input.channelId,
        reportDate: date,
        file,
      }),
    );
    added++;
  }
  return { added, available: dates.length, more: added < missing.length };
}
