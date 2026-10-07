import {
  addSettlementLines,
  can,
  channelProfit,
  convertUnits,
  emptyGroupTotals,
  type GroupTotals,
  localDate,
  minorUnits,
  SETTLEMENT_GROUPS,
} from "@bookalyze/core";
import { getSettlementAccounts, schema, settlementsForProfit } from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { AlertTriangle, ChartColumn } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { formatDate, nowIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { suggestRate } from "@/server/fx";
import { fiscalConfigOf } from "@/server/org";
import { resolveRange } from "../../accounting/reports/periods";
import { RangeControls } from "../../accounting/reports/report-controls";

export const metadata: Metadata = { title: "Channel profit" };

type Column = {
  key: string;
  label: string;
  currency: string;
  totals: GroupTotals;
  settlements: number;
};

/** Rows of the report: what makes up the net, with subtotals, then what isn't profit. */
const ROWS: { key: string; label: string; kind?: "subtotal" | "total" | "muted" }[] = [
  { key: "sales", label: "Sales" },
  { key: "refunds", label: "Refunds" },
  { key: "promotions", label: "Promotions" },
  { key: "netSales", label: "Net sales", kind: "subtotal" },
  { key: "fees", label: SETTLEMENT_GROUPS.fees },
  { key: "feeTax", label: SETTLEMENT_GROUPS.feeTax },
  { key: "advertising", label: SETTLEMENT_GROUPS.advertising },
  { key: "reimbursements", label: SETTLEMENT_GROUPS.reimbursements },
  { key: "other", label: SETTLEMENT_GROUPS.other },
  { key: "net", label: "Net from the channel", kind: "total" },
  { key: "margin", label: "Margin (net over net sales)", kind: "muted" },
  { key: "tax", label: "Sales tax (passed through)", kind: "muted" },
  { key: "reserve", label: "Held back and released", kind: "muted" },
  { key: "payout", label: "Paid out", kind: "subtotal" },
];

export default async function ChannelProfitPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { locale, timezone, baseCurrency } = ctx.profile;
  const today = nowIn(timezone).date;
  const { from, to, presets } = resolveRange(
    await searchParams,
    today,
    fiscalConfigOf(ctx.profile),
  );
  const { rows, feeTaxRecoverable } = await inOrg(ctx, async (tx) => {
    // Tax on fees recoverable: its account is an asset or liability (input tax), not the fees.
    const feeTax = (await getSettlementAccounts(tx)).feeTax;
    const [account] = feeTax
      ? await tx
          .select({ type: schema.accounts.type })
          .from(schema.accounts)
          .where(eq(schema.accounts.id, feeTax))
      : [];
    return {
      rows: await settlementsForProfit(tx, { from, to, timezone }),
      feeTaxRecoverable: account?.type === "asset" || account?.type === "liability",
    };
  });

  // One column per channel, in its own currency; plus all of them in the main currency.
  const columns = new Map<string, Column>();
  const all: Column = {
    key: "all",
    label: `All channels (${baseCurrency})`,
    currency: baseCurrency,
    totals: emptyGroupTotals(),
    settlements: 0,
  };
  const decimals = minorUnits(baseCurrency);
  const rates = new Map<string, string | null>();
  let unconverted = 0;
  let unbalanced = 0;
  for (const s of rows) {
    const key = `${s.channelId ?? s.marketplace ?? "amazon"}:${s.currency}`;
    const column = columns.get(key) ?? {
      key,
      label: s.channelName ?? s.marketplace ?? "Amazon",
      currency: s.currency,
      totals: emptyGroupTotals(),
      settlements: 0,
    };
    addSettlementLines(column.totals, s.lines);
    column.settlements++;
    columns.set(key, column);
    if (!s.balanced) unbalanced++;

    // The main-currency value: the rate it posted at, else that day's rate.
    let rate: string | null = s.currency === baseCurrency ? "1" : s.postedFxRate;
    if (!rate) {
      const date = localDate(s.endAt.toISOString(), timezone);
      const cacheKey = `${s.currency}:${date}`;
      if (!rates.has(cacheKey)) {
        rates.set(cacheKey, (await suggestRate(baseCurrency, s.currency, date))?.rate ?? null);
      }
      rate = rates.get(cacheKey) ?? null;
    }
    if (!rate) {
      unconverted++;
      continue;
    }
    const r = rate;
    addSettlementLines(all.totals, s.lines, (units) =>
      s.currency === baseCurrency ? units : convertUnits(units, r, decimals),
    );
    all.settlements++;
  }
  const channels = [...columns.values()].sort((a, b) => a.label.localeCompare(b.label));
  const showAll =
    channels.length > 1 || channels.some((c) => c.currency !== baseCurrency) || unconverted > 0;
  const shown = showAll ? [...channels, all] : channels;
  const results = shown.map((c) => ({
    column: c,
    profit: channelProfit(c.totals, { feeTaxRecoverable }),
  }));

  const cell = (key: string, profit: ReturnType<typeof channelProfit>, currency: string) => {
    if (key === "margin") {
      return profit.margin === null
        ? "—"
        : `${profit.margin.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
    }
    const value =
      key === "net" || key === "netSales" || key === "payout"
        ? profit[key]
        : profit.groups[key as keyof typeof profit.groups];
    return <Amount value={value} currency={currency} locale={locale} />;
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Commerce"
        title="Channel profit"
        description="What each marketplace earned you: sales less refunds, promotions, Amazon's fees and advertising, from its settlements. Before the cost of the products sold."
      />
      <RangeControls from={from} to={to} presets={presets} />

      {rows.length ? (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-xs">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                <th className="px-5 py-3 text-start font-medium">
                  {formatDate(from, locale)} – {formatDate(to, locale)}
                </th>
                {results.map(({ column }) => (
                  <th key={column.key} className="px-5 py-3 text-end font-medium">
                    <span className="block text-foreground">{column.label}</span>
                    <span className="block font-normal">
                      {column.settlements === 1
                        ? "1 settlement"
                        : `${column.settlements} settlements`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr
                  key={row.key}
                  className={cn(
                    "border-b last:border-b-0",
                    row.kind === "subtotal" && "bg-muted/20 font-medium",
                    row.kind === "total" && "bg-primary/5 font-semibold",
                    row.kind === "muted" && "text-muted-foreground",
                  )}
                >
                  <th scope="row" className="px-5 py-2.5 text-start font-[inherit]">
                    {row.label}
                  </th>
                  {results.map(({ column, profit }) => (
                    <td key={column.key} className="tabular px-5 py-2.5 text-end">
                      {cell(row.key, profit, column.currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ChartColumn className="size-6" />
          </span>
          <p className="font-medium">No settlements in this period</p>
          <p className="max-w-md text-muted-foreground text-sm">
            Choose another period, or bring in settlements on the{" "}
            <Link
              href={`/o/${slug}/commerce/settlements`}
              className="text-primary underline-offset-4 hover:underline"
            >
              Settlements
            </Link>{" "}
            page.
          </p>
        </div>
      )}

      <div className="grid gap-2 text-muted-foreground text-xs">
        <p>
          Each settlement counts in the period its last day falls in. Settlements in another
          currency are in {baseCurrency} at the rate they posted at, or that day's rate if they
          aren't in your books yet. Product costs come with inventory.
          {feeTaxRecoverable
            ? " Tax on Amazon's fees posts to a recoverable tax account, so it isn't counted as a cost."
            : ""}
        </p>
        {unconverted ? (
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            {unconverted === 1 ? "1 settlement isn't" : `${unconverted} settlements aren't`} in the{" "}
            {baseCurrency} total: there's no exchange rate for its day yet.
          </p>
        ) : null}
        {unbalanced ? (
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            {unbalanced === 1 ? "1 settlement's" : `${unbalanced} settlements'`} lines don't add up
            to the payout: upload the statement again from Seller Central.
          </p>
        ) : null}
      </div>
    </div>
  );
}
