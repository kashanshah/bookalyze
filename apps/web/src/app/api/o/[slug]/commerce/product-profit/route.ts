import {
  can,
  csvAmount,
  csvFileName,
  PRODUCT_PROFIT_COLUMNS,
  productProfitCsvRows,
  toCsv,
} from "@bookalyze/core";
import { nowIn } from "@/lib/dates";
import { getCommerceContext } from "@/server/commerce";
import { fiscalConfigOf } from "@/server/org";
import { productProfit } from "@/server/product-profit";
import { resolveRange } from "../../../../../o/[slug]/accounting/reports/periods";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Profit by product as a CSV download, for the same period and channel as its page. Members
 * only: the commerce context checks the session and membership; data is read inside withOrg().
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
  const channel = search.get("channel");
  const data = await productProfit(ctx, {
    from,
    to,
    channelId: channel && UUID.test(channel) ? channel : null,
  });
  const company = ctx.org.name;
  const csv = toCsv([
    ["Company", company],
    ["Report", "Profit by product, after ads"],
    ["Period", `${from} to ${to}`],
    [],
    [...PRODUCT_PROFIT_COLUMNS],
    ...productProfitCsvRows(data.channels, (v, currency) => csvAmount(v, currency)),
  ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(company, "profit by product", from, "to", to)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
