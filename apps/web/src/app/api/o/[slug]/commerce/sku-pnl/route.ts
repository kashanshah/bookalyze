import {
  can,
  csvAmount,
  csvFileName,
  SKU_PNL_COLUMNS,
  skuPnlCsvRows,
  toCsv,
} from "@bookalyze/core";
import { nowIn } from "@/lib/dates";
import { getCommerceContext } from "@/server/commerce";
import { fiscalConfigOf } from "@/server/org";
import { readChannelIds, skuProfitAndLoss } from "@/server/sku-pnl";
import { resolveRange } from "../../../../../o/[slug]/accounting/reports/periods";

/**
 * Profit and loss by product as a CSV download: every channel together in the main currency,
 * then each channel in its own (or one channel, or one SKU), for the same period as its page.
 * Members only: the commerce context checks the session and membership; data is read in withOrg().
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) {
    return new Response("Not found", { status: 404 });
  }
  const search = new URL(request.url).searchParams;
  // resolveRange checks the dates and falls back to the default period.
  const asked = { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined };
  const { from, to } = resolveRange(
    asked,
    nowIn(ctx.profile.timezone).date,
    fiscalConfigOf(ctx.profile),
  );
  const channelIds = readChannelIds(search.getAll("channel"));
  const sku = search.get("sku")?.slice(0, 200) ?? null;
  const data = await skuProfitAndLoss(ctx, {
    from,
    to,
    allocateBrands: search.get("brands") === "shared",
    channelIds,
  });
  const chosen = data.channels.filter((c) => channelIds.includes(c.channelId));
  const only = <T extends { sku: string }>(rows: T[]) =>
    sku === null ? rows : rows.filter((r) => r.sku === sku);
  const groups = [
    // One channel ticked: just its own currency. Several, or none: their total first.
    ...(chosen.length === 1
      ? []
      : [
          {
            name: chosen.length ? chosen.map((c) => c.name).join(" + ") : "All channels",
            currency: data.currency,
            rows: only(data.summary.rows),
          },
        ]),
    ...(chosen.length ? chosen : data.channels).map((c) => ({
      name: c.name,
      currency: c.currency,
      rows: only(c.rows),
    })),
  ];
  const company = ctx.org.name;
  const csv = toCsv([
    ["Company", company],
    ["Report", sku ? `Profit and loss of ${sku}` : "Profit and loss by product"],
    ["Period", `${from} to ${to}`],
    [
      "Note",
      "Estimated amounts are not settled by the marketplace yet, shared out, or still changing",
    ],
    [],
    [...SKU_PNL_COLUMNS],
    ...skuPnlCsvRows(groups, (v, currency) => csvAmount(v, currency)),
  ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(company, "profit and loss by product", from, "to", to)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
