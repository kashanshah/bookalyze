import { sumDecimals } from "@bookalyze/core";
import {
  type CogsPreview,
  listCogsPeriods,
  type MonthSales,
  previewCogs,
  salesByMonth,
} from "@bookalyze/db";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getInventoryContext } from "@/server/inventory";
import { PostMonthButton, UndoMonthButton } from "./cogs-buttons";

export const metadata: Metadata = { title: "Cost of goods sold" };

function monthName(month: string, locale: string) {
  return new Date(`${month}-15T00:00:00Z`).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function CogsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getInventoryContext(slug, "inventory.cogs");
  const { locale, timezone, baseCurrency } = ctx.profile;
  const current = nowIn(timezone).date.slice(0, 7);

  const { sales, periods, previews } = await inOrg(ctx, async (tx) => {
    const [sales, periods] = [await salesByMonth(tx, { timezone }), await listCogsPeriods(tx)];
    const done = new Set(periods.map((p) => `${p.channelId}:${p.month}`));
    const latestPosted = periods.reduce((m, p) => (p.month > m ? p.month : m), "");
    // The next month to post: the oldest finished month with sales not yet posted, as long as
    // no later month is posted already.
    const next = sales
      .filter((m) => m.month < current && !done.has(`${m.channelId}:${m.month}`))
      .reduce((m, s) => (!m || s.month < m ? s.month : m), "");
    const previews = new Map<string, CogsPreview>();
    if (next && next >= latestPosted) {
      for (const m of sales.filter(
        (s) => s.month === next && !done.has(`${s.channelId}:${s.month}`),
      )) {
        previews.set(
          `${m.channelId}:${m.month}`,
          await previewCogs(tx, { channelId: m.channelId, month: m.month, timezone, baseCurrency }),
        );
      }
    }
    return { sales, periods, previews };
  });

  const posted = new Map(periods.map((p) => [`${p.channelId}:${p.month}`, p]));
  const latestPosted = periods.reduce((m, p) => (p.month > m ? p.month : m), "");
  const months = [...new Set(sales.map((s) => s.month))].sort().reverse();
  const n = new Intl.NumberFormat(locale);
  const totalPosted = sumDecimals(periods.map((p) => p.cost));

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Inventory"
        title="Cost of goods sold"
        description="Each month, the units you shipped on each marketplace are costed from your oldest stock lots first (FIFO), and posted to your books: cost of goods sold up, inventory down. Months post in order, once they're over."
      />

      {months.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Receipt className="size-6" />
          </span>
          <p className="font-medium">No sales to cost yet</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            Once orders come in from your marketplaces, each month shows here, ready to post.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {periods.length ? (
            <p className="text-muted-foreground text-sm">
              Posted so far:{" "}
              <Amount
                value={totalPosted}
                currency={baseCurrency}
                locale={locale}
                className="font-medium text-foreground"
              />
            </p>
          ) : null}
          {months.map((month, mi) => (
            <section
              key={month}
              aria-label={monthName(month, locale)}
              className="fade-in-0 animate-in overflow-hidden rounded-2xl border bg-card fill-mode-both shadow-xs"
              style={{ animationDelay: `${Math.min(mi, 12) * 25}ms` }}
            >
              <h2 className="border-b px-5 py-3 font-medium">{monthName(month, locale)}</h2>
              <ul className="divide-y">
                {sales
                  .filter((s) => s.month === month)
                  .map((s) => (
                    <MonthRow
                      key={s.channelId}
                      slug={slug}
                      sale={s}
                      locale={locale}
                      baseCurrency={baseCurrency}
                      label={`${monthName(month, locale)} on ${s.channelName}`}
                      period={posted.get(`${s.channelId}:${month}`) ?? null}
                      canUndo={month === latestPosted}
                      preview={previews.get(`${s.channelId}:${month}`) ?? null}
                      inProgress={month >= current}
                      units={n.format(s.units)}
                    />
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthRow({
  slug,
  sale,
  locale,
  baseCurrency,
  label,
  period,
  canUndo,
  preview,
  inProgress,
  units,
}: {
  slug: string;
  sale: MonthSales;
  locale: string;
  baseCurrency: string;
  label: string;
  period: Awaited<ReturnType<typeof listCogsPeriods>>[number] | null;
  canUndo: boolean;
  preview: CogsPreview | null;
  inProgress: boolean;
  units: string;
}) {
  let status: React.ReactNode;
  let detail: React.ReactNode = null;
  let action: React.ReactNode = null;
  if (period) {
    status = (
      <Badge variant="success">
        <CheckCircle2 />
        Posted
      </Badge>
    );
    detail = (
      <span>
        <Amount value={period.cost} currency={period.currency} locale={locale} /> for {period.units}{" "}
        units
        <Extras
          returned={period.returnedUnits}
          returnedCost={period.returnedCost}
          lost={period.lostUnits}
          lostCost={period.lostCost}
          found={period.foundUnits}
          foundCost={period.foundCost}
          currency={period.currency}
          locale={locale}
        />
        {period.journalEntryId ? (
          <>
            {" · "}
            <Link
              href={`/o/${slug}/accounting/journal/${period.journalEntryId}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              See the entry
            </Link>
          </>
        ) : null}
      </span>
    );
    if (canUndo) action = <UndoMonthButton slug={slug} periodId={period.id} label={label} />;
  } else if (inProgress) {
    status = (
      <Badge variant="secondary">
        <Clock />
        In progress
      </Badge>
    );
    detail = "Posts once the month is over.";
  } else if (
    preview &&
    !preview.problems.length &&
    (preview.units || preview.returned || preview.lost || preview.found)
  ) {
    status = <Badge variant="default">Ready</Badge>;
    detail = (
      <span>
        <Amount value={preview.cost} currency={baseCurrency} locale={locale} /> at FIFO cost
        <Extras
          returned={preview.returned}
          returnedCost={preview.returnedCost}
          lost={preview.lost}
          lostCost={preview.lostCost}
          found={preview.found}
          foundCost={preview.foundCost}
          currency={baseCurrency}
          locale={locale}
        />
        {preview.lines.length ? (
          <span className="block text-xs">
            {preview.lines.map((line) => `${line.productName} × ${line.units}`).join(" · ")}
          </span>
        ) : null}
      </span>
    );
    action = (
      <PostMonthButton slug={slug} channelId={sale.channelId} month={sale.month} label={label} />
    );
  } else if (preview) {
    status = (
      <Badge variant="warning">
        <AlertTriangle />
        Needs attention
      </Badge>
    );
    detail = (
      <ul className="grid gap-1">
        {(preview.problems.length ? preview.problems : ["Nothing linked shipped this month."]).map(
          (problem) => (
            <li key={problem}>{problem}</li>
          ),
        )}
      </ul>
    );
  } else {
    status = (
      <Badge variant="secondary">
        <CalendarClock />
        Waiting
      </Badge>
    );
    detail = "Posts after the months before it.";
  }

  return (
    <li
      aria-label={`${label}`}
      className="grid gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center"
    >
      <div>
        <p className="font-medium text-sm">{sale.channelName}</p>
        <p className="text-muted-foreground text-xs">
          {units} units shipped
          {sale.returned ? ` · ${sale.returned} returned` : ""}
          {sale.adjusted < 0 ? ` · ${-sale.adjusted} lost or damaged` : ""}
          {sale.adjusted > 0 ? ` · ${sale.adjusted} found` : ""}
          {sale.unlinkedUnits ? ` · ${sale.unlinkedUnits} on unlinked SKUs` : ""}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 text-muted-foreground text-sm sm:flex-row sm:items-start sm:gap-3">
        <span className="shrink-0">{status}</span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{detail}</span>
      </div>
      <div className="flex justify-end">{action}</div>
    </li>
  );
}

/** Returns, losses and units found, after the month's cost: only the ones that happened. */
function Extras({
  returned,
  returnedCost,
  lost,
  lostCost,
  found,
  foundCost,
  currency,
  locale,
}: {
  returned: number;
  returnedCost: string;
  lost: number;
  lostCost: string;
  found: number;
  foundCost: string;
  currency: string;
  locale: string;
}) {
  const parts = [
    returned
      ? { key: "r", label: `${returned} returned back into stock`, amount: returnedCost }
      : null,
    lost ? { key: "l", label: `${lost} lost or damaged, written off`, amount: lostCost } : null,
    found ? { key: "f", label: `${found} found back into stock`, amount: foundCost } : null,
  ].filter((p) => p !== null);
  if (!parts.length) return null;
  return (
    <span className="block text-xs">
      {parts.map((p, i) => (
        <span key={p.key}>
          {i ? " · " : ""}
          {p.label} (<Amount value={p.amount} currency={currency} locale={locale} />)
        </span>
      ))}
    </span>
  );
}
