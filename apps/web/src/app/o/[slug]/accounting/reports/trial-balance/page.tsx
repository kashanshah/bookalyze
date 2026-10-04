import { trialBalance } from "@bookalyze/core";
import { accountBalances } from "@bookalyze/db";
import type { Metadata } from "next";
import { Amount } from "@/components/accounting/amount";
import { formatDate, nowIn } from "@/lib/dates";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { fiscalConfigOf } from "@/server/org";
import { resolveDate } from "../periods";
import { DateControls } from "../report-controls";
import { BalanceCheck, ReportCard, ReportHeader } from "../report-parts";

export const metadata: Metadata = { title: "Trial balance" };

export default async function TrialBalancePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const today = nowIn(ctx.profile.timezone).date;
  const { date, presets } = resolveDate(await searchParams, today, fiscalConfigOf(ctx.profile));
  const tb = trialBalance(await inOrg(ctx, (tx) => accountBalances(tx, { to: date })));

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="Trial balance"
        company={ctx.org.name}
        period={`As of ${formatDate(date, locale, "long")}`}
        description="Every account with a balance, in debit and credit columns. The two totals always match."
      />
      <DateControls date={date} presets={presets} />
      <ReportCard>
        <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:px-6">
          <span>Account</span>
          <span className="text-end">Debit</span>
          <span className="text-end">Credit</span>
        </div>
        {tb.groups.length === 0 ? (
          <p className="px-6 py-10 text-center text-muted-foreground text-sm">
            No entries up to this date yet.
          </p>
        ) : (
          tb.groups.map((group) => (
            <div key={group.type} className="border-b">
              <h3 className="px-5 pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider sm:px-6">
                {group.label}
              </h3>
              <ul>
                {group.rows.map((row) => (
                  <li
                    key={row.accountId}
                    className="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] gap-4 px-5 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:px-6"
                  >
                    <span className="min-w-0">
                      {row.code ? (
                        <span className="me-2 font-mono text-muted-foreground text-xs">
                          {row.code}
                        </span>
                      ) : null}
                      {row.name}
                    </span>
                    <span className="text-end">
                      {row.debit ? (
                        <Amount value={row.debit} currency={currency} locale={locale} />
                      ) : null}
                    </span>
                    <span className="text-end">
                      {row.credit ? (
                        <Amount value={row.credit} currency={currency} locale={locale} />
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] gap-4 bg-primary/5 px-5 py-3.5 font-semibold text-sm sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:px-6">
          <span>Total</span>
          <Amount value={tb.totalDebit} currency={currency} locale={locale} className="text-end" />
          <Amount value={tb.totalCredit} currency={currency} locale={locale} className="text-end" />
        </div>
      </ReportCard>
      <BalanceCheck
        balanced={tb.balanced}
        okText="Debits equal credits."
        badText="Debits and credits don't match. Please contact support."
      />
    </div>
  );
}
