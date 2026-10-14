import {
  addSettlementLines,
  can,
  channelProfit,
  convertUnits,
  ebayProfitTotals,
  emptyGroupTotals,
  formatDecimal,
  formatMoney,
  type GroupTotals,
  localDate,
  minorUnits,
  monthEnd,
  noonProfitTotals,
  parseDecimal,
  SETTLEMENT_GROUPS,
} from "@bookalyze/core";
import {
  channelCostsForProfit,
  cogsForProfit,
  ebayMonths,
  ebayPostedRates,
  getSettlementAccounts,
  noonMonthsForProfit,
  schema,
  settlementsForProfit,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { AlertTriangle, ChartColumn, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  /** The sales channel, when the column is one (not "All channels"). */
  channelId?: string | null;
  label: string;
  currency: string;
  totals: GroupTotals;
  settlements: number;
  /** Noon's rows (Noon has no settlements). */
  transactions: number;
  /** eBay's money rows. */
  ebayRows?: number;
  /** eBay's payouts aren't in yet: what was paid out isn't known. */
  noPayouts?: boolean;
  /** From the books, in the column's currency (positive: a cost). */
  cogs?: bigint;
  writeOffs?: bigint;
  own?: bigint;
  /** Each counted category's part of `own`, for the cell's hint. */
  ownDetail?: Map<string, bigint>;
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "3 settlements", "120 transactions", or both for "All channels". */
const countOf = (c: Column) =>
  [
    c.settlements ? plural(c.settlements, "settlement") : null,
    c.transactions ? plural(c.transactions, "Noon transaction") : null,
    c.ebayRows ? plural(c.ebayRows, "eBay transaction") : null,
  ]
    .filter(Boolean)
    .join(" · ") || "Nothing yet";

/** Rows of the report: what makes up the profit, with subtotals, then what isn't profit. */
const ROWS: { key: string; label: string; kind?: "subtotal" | "total" | "muted"; hint?: string }[] =
  [
    { key: "sales", label: "Sales" },
    { key: "refunds", label: "Refunds" },
    { key: "promotions", label: "Promotions and subsidies" },
    { key: "netSales", label: "Net sales", kind: "subtotal" },
    { key: "fees", label: "Marketplace fees" },
    { key: "feeTax", label: "Tax on the marketplace's fees" },
    { key: "advertising", label: SETTLEMENT_GROUPS.advertising },
    { key: "reimbursements", label: SETTLEMENT_GROUPS.reimbursements },
    { key: "other", label: SETTLEMENT_GROUPS.other },
    { key: "net", label: "Net from the marketplace", kind: "subtotal" },
    {
      key: "cogs",
      label: "Cost of goods sold",
      hint: "What the products shipped cost (less those returned), from each month posted on Cost of goods sold",
    },
    {
      key: "writeOffs",
      label: "Stock lost or written off",
      hint: "Units the marketplace lost, damaged or disposed of, less those found",
    },
    {
      key: "own",
      label: "Your own costs",
      hint: "The expense categories you count against each channel (Your own costs, above). Shared ones are under All channels only.",
    },
    { key: "profit", label: "Profit", kind: "total" },
    { key: "margin", label: "Margin (profit over net sales)", kind: "muted" },
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
  const { rows, noon, ebay, ebayRates, feeTaxRecoverable, channelStates, costs, cogs } =
    await inOrg(ctx, async (tx) => {
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
        noon: await noonMonthsForProfit(tx, { from, to }),
        ebay: await ebayMonths(tx, { from, to }),
        ebayRates: await ebayPostedRates(tx),
        costs: await channelCostsForProfit(tx, { from, to }),
        cogs: await cogsForProfit(tx, { from, to }),
        feeTaxRecoverable: account?.type === "asset" || account?.type === "liability",
        // A channel switched off, or whose account was disconnected, still shows what it earned.
        channelStates: await tx
          .select({
            id: schema.salesChannels.id,
            name: schema.salesChannels.name,
            currency: schema.salesChannels.currency,
            isActive: schema.salesChannels.isActive,
            connection: schema.connections.status,
          })
          .from(schema.salesChannels)
          .leftJoin(
            schema.connections,
            eq(schema.connections.id, schema.salesChannels.connectionId),
          ),
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
    transactions: 0,
  };
  const decimals = minorUnits(baseCurrency);
  const rates = new Map<string, string | null>();
  let unconverted = 0;
  let unbalanced = 0;
  for (const s of rows) {
    const key = `${s.channelId ?? s.marketplace ?? "amazon"}:${s.currency}`;
    const column = columns.get(key) ?? {
      key,
      channelId: s.channelId,
      label: s.channelName ?? s.marketplace ?? "Amazon",
      currency: s.currency,
      totals: emptyGroupTotals(),
      settlements: 0,
      transactions: 0,
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
  // Noon: its rows in the period, a month at a time (each month at the rate it posted at, else
  // its last day's rate).
  for (const m of noon) {
    const key = `noon:${m.channelId}:${m.currency}`;
    const column = columns.get(key) ?? {
      key,
      channelId: m.channelId,
      label: m.channelName,
      currency: m.currency,
      totals: emptyGroupTotals(),
      settlements: 0,
      transactions: 0,
    };
    noonProfitTotals(m.sums, undefined, column.totals);
    column.transactions += m.rows;
    columns.set(key, column);
    let rate: string | null = m.currency === baseCurrency ? "1" : m.postedFxRate;
    if (!rate) {
      const date = monthEnd(m.month) < to ? monthEnd(m.month) : to;
      const cacheKey = `${m.currency}:${date}`;
      if (!rates.has(cacheKey)) {
        rates.set(cacheKey, (await suggestRate(baseCurrency, m.currency, date))?.rate ?? null);
      }
      rate = rates.get(cacheKey) ?? null;
    }
    if (!rate) {
      unconverted++;
      continue;
    }
    const r = rate;
    noonProfitTotals(
      m.sums,
      (units) => (m.currency === baseCurrency ? units : convertUnits(units, r, decimals)),
      all.totals,
    );
    all.transactions += m.rows;
  }
  // eBay: its money rows in the period, a month at a time (each at the rate it posted at, else its
  // last day's rate). Payouts are for the whole eBay account, not a site, so they aren't shown.
  for (const m of ebay) {
    const key = `ebay:${m.channelId}:${m.currency}`;
    const column = columns.get(key) ?? {
      key,
      channelId: m.channelId,
      label: m.channelName,
      currency: m.currency,
      totals: emptyGroupTotals(),
      settlements: 0,
      transactions: 0,
      ebayRows: 0,
      noPayouts: true,
    };
    ebayProfitTotals(m.sums, undefined, column.totals);
    column.ebayRows = (column.ebayRows ?? 0) + m.rows;
    columns.set(key, column);
    let rate: string | null =
      m.currency === baseCurrency ? "1" : (ebayRates.get(`${m.channelId}|${m.month}`) ?? null);
    if (!rate) {
      const date = monthEnd(m.month) < to ? monthEnd(m.month) : to;
      const cacheKey = `${m.currency}:${date}`;
      if (!rates.has(cacheKey)) {
        rates.set(cacheKey, (await suggestRate(baseCurrency, m.currency, date))?.rate ?? null);
      }
      rate = rates.get(cacheKey) ?? null;
    }
    if (!rate) {
      unconverted++;
      continue;
    }
    const r = rate;
    ebayProfitTotals(
      m.sums,
      (units) => (m.currency === baseCurrency ? units : convertUnits(units, r, decimals)),
      all.totals,
    );
    all.ebayRows = (all.ebayRows ?? 0) + m.rows;
    all.noPayouts = true;
  }
  // Costs from the books, kept in the main currency: each channel's in its column (at its rate
  // on the day), all of them, shared ones too, under All channels.
  const columnOf = (channelId: string) => {
    const found = [...columns.values()].find((c) => c.channelId === channelId);
    if (found) return found;
    const channel = channelStates.find((c) => c.id === channelId);
    if (!channel) return null;
    const column: Column = {
      key: `costs:${channelId}`,
      channelId,
      label: channel.name,
      currency: channel.currency,
      totals: emptyGroupTotals(),
      settlements: 0,
      transactions: 0,
    };
    columns.set(column.key, column);
    return column;
  };
  /** Main-currency units in `currency`, at that day's rate (null: no rate yet). */
  const fromBase = async (units: bigint, currency: string, date: string) => {
    if (currency === baseCurrency) return units;
    const cacheKey = `${currency}:${date}`;
    if (!rates.has(cacheKey)) {
      rates.set(cacheKey, (await suggestRate(baseCurrency, currency, date))?.rate ?? null);
    }
    const rate = rates.get(cacheKey);
    if (!rate) return null;
    // The rate is main-currency units per unit of `currency`.
    return (units * 10n ** 10n) / parseDecimal(rate, 10);
  };
  let costsUnconverted = 0;
  for (const c of cogs) {
    const date = monthEnd(c.month) < to ? monthEnd(c.month) : to;
    const cost = parseDecimal(c.cogs);
    const writeOffs = parseDecimal(c.writeOffs);
    all.cogs = (all.cogs ?? 0n) + cost;
    all.writeOffs = (all.writeOffs ?? 0n) + writeOffs;
    const column = columnOf(c.channelId);
    if (!column) continue;
    const [inCost, inWriteOffs] = [
      await fromBase(cost, column.currency, date),
      await fromBase(writeOffs, column.currency, date),
    ];
    if (inCost === null || inWriteOffs === null) {
      costsUnconverted++;
      continue;
    }
    column.cogs = (column.cogs ?? 0n) + inCost;
    column.writeOffs = (column.writeOffs ?? 0n) + inWriteOffs;
  }
  const addOwn = (column: Column, label: string, units: bigint) => {
    column.own = (column.own ?? 0n) + units;
    column.ownDetail ??= new Map();
    column.ownDetail.set(label, (column.ownDetail.get(label) ?? 0n) + units);
  };
  for (const c of costs) {
    const units = parseDecimal(c.base);
    addOwn(all, c.label, units);
    const column = c.channelId ? columnOf(c.channelId) : null;
    if (!column) continue;
    const inColumn = await fromBase(units, column.currency, to);
    if (inColumn === null) {
      costsUnconverted++;
      continue;
    }
    addOwn(column, c.label, inColumn);
  }

  const channels = [...columns.values()].sort((a, b) => a.label.localeCompare(b.label));
  const shared = costs.some((c) => c.channelId === null);
  const showAll =
    channels.length > 1 ||
    channels.some((c) => c.currency !== baseCurrency) ||
    unconverted > 0 ||
    shared;
  const shown = showAll ? [...channels, all] : channels;
  /** Why a channel's column is past earnings only: switched off, or its account disconnected. */
  const stateOf = (c: Column) => {
    const state = c.channelId ? channelStates.find((s) => s.id === c.channelId) : undefined;
    if (!state) return null;
    if (state.connection === "disconnected") {
      return {
        label: "Disconnected",
        hint: "Its account was disconnected: what it earned before stays here.",
      };
    }
    if (!state.isActive) {
      return {
        label: "Switched off",
        hint: "Switched off on Channels: what it earned before stays here.",
      };
    }
    return null;
  };

  const results = shown.map((c) => {
    const base = channelProfit(c.totals, { feeTaxRecoverable });
    const costsOf = (c.cogs ?? 0n) + (c.writeOffs ?? 0n) + (c.own ?? 0n);
    const profitUnits = parseDecimal(base.net) - costsOf;
    const sales = parseDecimal(base.netSales);
    return {
      column: c,
      profit: {
        ...base,
        cogs: formatDecimal(-(c.cogs ?? 0n)),
        writeOffs: formatDecimal(-(c.writeOffs ?? 0n)),
        own: formatDecimal(-(c.own ?? 0n)),
        profit: formatDecimal(profitUnits),
        margin: sales > 0n ? Number((profitUnits * 10_000n) / sales) / 100 : null,
      },
    };
  });
  const anyWriteOffs = results.some(({ column }) => (column.writeOffs ?? 0n) !== 0n);
  const shownRows = ROWS.filter((row) => row.key !== "writeOffs" || anyWriteOffs);

  const cell = (
    key: string,
    profit: (typeof results)[number]["profit"],
    currency: string,
    noPayouts?: boolean,
  ) => {
    if (noPayouts && (key === "payout" || key === "reserve")) {
      return <span title="eBay's payouts aren't brought in yet">—</span>;
    }
    if (key === "margin") {
      return profit.margin === null
        ? "—"
        : `${profit.margin.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
    }
    const value =
      key === "net" ||
      key === "netSales" ||
      key === "payout" ||
      key === "cogs" ||
      key === "writeOffs" ||
      key === "own" ||
      key === "profit"
        ? profit[key]
        : profit.groups[key as keyof typeof profit.groups];
    return <Amount value={value} currency={currency} locale={locale} />;
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Commerce"
        title="Channel profit"
        description="What each marketplace earned you: sales less refunds, promotions, the marketplace's fees and advertising, from Amazon's settlements and Noon's and eBay's transactions; then what the products cost and your own costs from your books."
        actions={
          <Button asChild variant="ghost">
            <Link href={`/o/${slug}/commerce/profit/costs`}>
              <Settings2 />
              Your own costs
            </Link>
          </Button>
        }
      />
      <RangeControls from={from} to={to} presets={presets} />

      {rows.length || noon.length || ebay.length || costs.length || cogs.length ? (
        <div className="overflow-x-auto rounded-2xl border bg-card shadow-xs">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                <th className="px-5 py-3 text-start font-medium">
                  {formatDate(from, locale)} – {formatDate(to, locale)}
                </th>
                {results.map(({ column }) => {
                  const state = stateOf(column);
                  return (
                    <th key={column.key} className="px-5 py-3 text-end align-top font-medium">
                      <span className="block text-foreground">{column.label}</span>
                      {state ? (
                        <Badge variant="outline" className="my-1 font-normal" title={state.hint}>
                          {state.label}
                        </Badge>
                      ) : null}
                      <span className="block font-normal">{countOf(column)}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row) => (
                <tr
                  key={row.key}
                  className={cn(
                    "border-b last:border-b-0",
                    row.kind === "subtotal" && "bg-muted/20 font-medium",
                    row.kind === "total" && "bg-primary/5 font-semibold",
                    row.kind === "muted" && "text-muted-foreground",
                  )}
                >
                  <th
                    scope="row"
                    className="px-5 py-2.5 text-start font-[inherit]"
                    title={row.hint}
                  >
                    {row.label}
                  </th>
                  {results.map(({ column, profit }) => (
                    <td
                      key={column.key}
                      className="tabular px-5 py-2.5 text-end"
                      title={
                        row.key === "own" && column.ownDetail?.size
                          ? [...column.ownDetail]
                              .map(
                                ([label, units]) =>
                                  `${label}: ${formatMoney(formatDecimal(units), column.currency, locale)}`,
                              )
                              .join("\n")
                          : undefined
                      }
                    >
                      {cell(row.key, profit, column.currency, column.noPayouts)}
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
          <p className="font-medium">Nothing sold in this period</p>
          <p className="max-w-md text-muted-foreground text-sm">
            Choose another period, or bring in Amazon's{" "}
            <Link
              href={`/o/${slug}/commerce/settlements`}
              className="text-primary underline-offset-4 hover:underline"
            >
              settlements
            </Link>{" "}
            or Noon's{" "}
            <Link
              href={`/o/${slug}/commerce/noon`}
              className="text-primary underline-offset-4 hover:underline"
            >
              transactions
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid gap-2 text-muted-foreground text-xs">
        <p>
          Each Amazon settlement counts in the period its last day falls in; each Noon row on its
          own day, and Noon's "held back and released" is what stayed in your Noon balance, so "paid
          out" is what Noon paid. Amounts in another currency are in {baseCurrency} at the rate they
          posted at, or that day's rate if they aren't in your books yet. Cost of goods sold counts
          each month posted on Cost of goods sold whose last day is in the period; your own costs
          count each entry dated in it (entries the marketplaces' own rows already count are left
          out). Channels switched off or disconnected still show what they earned before. eBay's
          rows count on their own day; its payouts aren't in yet, so what eBay paid out shows as —.
          {feeTaxRecoverable
            ? " Tax on Amazon's fees posts to a recoverable tax account, so it isn't counted as a cost."
            : ""}
        </p>
        {unconverted ? (
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            {unconverted === 1
              ? "1 settlement or Noon month isn't"
              : `${unconverted} settlements or Noon months aren't`}{" "}
            in the {baseCurrency} total: there's no exchange rate for its day yet.
          </p>
        ) : null}
        {costsUnconverted ? (
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            Some costs are only in the {baseCurrency} total: there's no exchange rate into their
            channel's currency for the day yet.
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
