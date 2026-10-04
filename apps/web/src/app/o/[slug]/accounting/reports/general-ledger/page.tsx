import {
  type AccountLedger,
  accountLedger,
  accountTypes,
  formatMoney,
  generalLedgerSummary,
} from "@bookalyze/core";
import {
  type AccountLedgerData,
  accountLedgerLines,
  formatEntryNumber,
  type LedgerLineRow,
  ledgerActivity,
} from "@bookalyze/db";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { Badge } from "@/components/ui/badge";
import { formatDate, nowIn } from "@/lib/dates";
import { getAccountingContext, inOrg, listAccounts } from "@/server/accounting";
import { fiscalConfigOf } from "@/server/org";
import { resolveRange } from "../periods";
import { RangeControls } from "../report-controls";
import { ReportCard, ReportHeader } from "../report-parts";
import { AccountPicker } from "./account-picker";

export const metadata: Metadata = { title: "General ledger" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_LIMIT = 1000;

type Money = { currency: string; locale: string };

export default async function GeneralLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; account?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const today = nowIn(ctx.profile.timezone).date;
  const { from, to, presets } = resolveRange(query, today, fiscalConfigOf(ctx.profile));
  const accountId = query.account && UUID.test(query.account) ? query.account : null;

  const [accounts, data] = await Promise.all([
    listAccounts(ctx),
    inOrg(ctx, async (tx) =>
      accountId
        ? {
            kind: "account" as const,
            ledger: await accountLedgerLines(tx, accountId, { from, to }, LINE_LIMIT),
          }
        : { kind: "summary" as const, activity: await ledgerActivity(tx, { from, to }) },
    ),
  ]);
  const options = accounts.map((a) => ({
    value: a.id,
    label: a.code ? `${a.code} · ${a.name}` : a.name,
    group: accountTypes[a.type].label,
    ...(a.isArchived ? { description: "Archived" } : {}),
  }));
  const money = { currency, locale };
  const period = `${formatDate(from, locale)} – ${formatDate(to, locale)}`;

  return (
    <div className="grid gap-6">
      <ReportHeader
        slug={slug}
        title="General ledger"
        company={ctx.org.name}
        period={period}
        description="Every line posted to each account, with balances at the start and end of the period. Pick an account to see its lines."
      />
      <div className="grid gap-4">
        <AccountPicker value={accountId ?? ""} options={options} />
        <RangeControls from={from} to={to} presets={presets} />
      </div>
      {data.kind === "summary" ? (
        <Summary
          slug={slug}
          from={from}
          to={to}
          summary={generalLedgerSummary(data.activity)}
          money={money}
        />
      ) : data.ledger ? (
        <AccountLines slug={slug} data={data.ledger} money={money} />
      ) : (
        <ReportCard>
          <p className="px-6 py-10 text-center text-muted-foreground text-sm">
            This account doesn't exist in {ctx.org.name}.{" "}
            <Link
              href={`?from=${from}&to=${to}`}
              className="font-medium text-primary hover:underline"
            >
              Show all accounts
            </Link>
          </p>
        </ReportCard>
      )}
    </div>
  );
}

const SUMMARY_GRID =
  "sm:grid sm:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_8.5rem_8.5rem_1rem] sm:items-baseline sm:gap-4";

function Summary({
  slug,
  from,
  to,
  summary,
  money,
}: {
  slug: string;
  from: string;
  to: string;
  summary: ReturnType<typeof generalLedgerSummary>;
  money: Money;
}) {
  return (
    <ReportCard>
      <div
        className={`hidden border-b bg-muted/30 px-6 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider ${SUMMARY_GRID}`}
      >
        <span>Account</span>
        <span className="text-end">Opening</span>
        <span className="text-end">Debits</span>
        <span className="text-end">Credits</span>
        <span className="text-end">Closing</span>
        <span />
      </div>
      {summary.groups.length === 0 ? (
        <p className="px-6 py-10 text-center text-muted-foreground text-sm">
          Nothing posted up to the end of this period yet.
        </p>
      ) : (
        summary.groups.map((group) => (
          <div key={group.type} className="border-b last:border-b-0">
            <h3 className="px-5 pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider sm:px-6">
              {group.label}
            </h3>
            <ul>
              {group.rows.map((row) => (
                <li key={row.accountId}>
                  <Link
                    href={`/o/${slug}/accounting/reports/general-ledger?from=${from}&to=${to}&account=${row.accountId}`}
                    className={`group flex flex-col gap-1 px-5 py-2.5 text-sm transition-colors hover:bg-muted/40 sm:px-6 ${SUMMARY_GRID}`}
                  >
                    <span className="flex min-w-0 items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {row.code ? (
                          <span className="me-2 font-mono text-muted-foreground text-xs">
                            {row.code}
                          </span>
                        ) : null}
                        {row.name}
                      </span>
                      <Amount value={row.closing} {...money} className="font-medium sm:hidden" />
                    </span>
                    <span className="text-muted-foreground text-xs sm:hidden">
                      Opening {formatMoney(row.opening, money.currency, money.locale)} · Debits{" "}
                      {formatMoney(row.debits, money.currency, money.locale)} · Credits{" "}
                      {formatMoney(row.credits, money.currency, money.locale)}
                    </span>
                    <Amount
                      value={row.opening}
                      {...money}
                      muteZero
                      className="hidden text-end sm:block"
                    />
                    <Amount
                      value={row.debits}
                      {...money}
                      muteZero
                      className="hidden text-end sm:block"
                    />
                    <Amount
                      value={row.credits}
                      {...money}
                      muteZero
                      className="hidden text-end sm:block"
                    />
                    <Amount
                      value={row.closing}
                      {...money}
                      className="hidden text-end font-medium sm:block"
                    />
                    <ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block rtl:rotate-180" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {summary.groups.length > 0 ? (
        <div
          className={`flex justify-between gap-4 bg-primary/5 px-5 py-3.5 font-semibold text-sm sm:px-6 ${SUMMARY_GRID}`}
        >
          <span>Total posted in the period</span>
          <span className="hidden sm:block" />
          <Amount value={summary.totalDebits} {...money} className="hidden text-end sm:block" />
          <Amount value={summary.totalCredits} {...money} className="hidden text-end sm:block" />
          <span className="text-end text-muted-foreground text-xs sm:hidden">
            Debits {formatMoney(summary.totalDebits, money.currency, money.locale)} · Credits{" "}
            {formatMoney(summary.totalCredits, money.currency, money.locale)}
          </span>
        </div>
      ) : null}
    </ReportCard>
  );
}

const LINE_GRID =
  "sm:grid sm:grid-cols-[6.5rem_minmax(0,1fr)_8rem_8rem_8.5rem] sm:items-baseline sm:gap-4";

function AccountLines({
  slug,
  data,
  money,
}: {
  slug: string;
  data: AccountLedgerData;
  money: Money;
}) {
  const ledger: AccountLedger<LedgerLineRow> = accountLedger(
    data.account.type,
    data.opening,
    data.lines,
    {
      debits: data.debits,
      credits: data.credits,
    },
  );
  const { account } = data;
  const truncated = data.lineCount > data.lines.length;
  return (
    <ReportCard>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4 sm:px-6">
        <h2 className="font-semibold text-base">
          {account.code ? (
            <span className="me-2 font-mono text-muted-foreground text-sm">{account.code}</span>
          ) : null}
          {account.name}
        </h2>
        <span className="flex items-center gap-2 text-muted-foreground text-sm">
          {accountTypes[account.type].label}
          {account.currency && account.currency !== money.currency ? (
            <Badge variant="outline">{account.currency}</Badge>
          ) : null}
        </span>
      </div>
      <div
        className={`hidden border-b bg-muted/30 px-6 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider ${LINE_GRID}`}
      >
        <span>Date</span>
        <span>Details</span>
        <span className="text-end">Debit</span>
        <span className="text-end">Credit</span>
        <span className="text-end">Balance</span>
      </div>
      <BalanceRow label="Opening balance" value={ledger.opening} money={money} />
      {ledger.lines.length === 0 ? (
        <p className="border-b px-6 py-8 text-center text-muted-foreground text-sm">
          Nothing posted to this account in this period.
        </p>
      ) : (
        <ul className="divide-y border-b">
          {ledger.lines.map((line) => (
            <li key={line.id}>
              <Link
                href={`/o/${slug}/accounting/journal/${line.entryId}`}
                className={`flex flex-col gap-1 px-5 py-2.5 text-sm transition-colors hover:bg-muted/40 sm:px-6 ${LINE_GRID}`}
              >
                <span className="tabular text-muted-foreground sm:text-foreground">
                  {formatDate(line.date, money.locale)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{details(line)}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {formatEntryNumber(line.entryNumber)}
                    {line.reference ? ` · ${line.reference}` : ""}
                    {line.currency !== money.currency
                      ? ` · ${formatMoney(line.currencyAmount.replace("-", ""), line.currency, money.locale)}`
                      : ""}
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-3 sm:contents">
                  <span className="sm:hidden">
                    {line.debit ? (
                      <Amount value={line.debit} {...money} className="text-success" />
                    ) : (
                      <span className="text-destructive">
                        −<Amount value={line.credit} {...money} />
                      </span>
                    )}
                  </span>
                  <Amount value={line.debit} {...money} className="hidden text-end sm:block" />
                  <Amount value={line.credit} {...money} className="hidden text-end sm:block" />
                  <Amount
                    value={line.balance}
                    {...money}
                    className="text-end text-muted-foreground sm:text-foreground"
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {truncated ? (
        <p className="border-b bg-warning/10 px-5 py-3 text-sm sm:px-6">
          Showing the first {data.lines.length.toLocaleString(money.locale)} of{" "}
          {data.lineCount.toLocaleString(money.locale)} lines. Pick a shorter period to see the
          rest. The totals and closing balance below cover the whole period.
        </p>
      ) : null}
      <div
        className={`flex justify-between gap-4 px-5 py-2.5 font-medium text-sm sm:px-6 ${LINE_GRID}`}
      >
        <span className="sm:col-span-2">Total for the period</span>
        <span className="text-end text-muted-foreground text-xs sm:hidden">
          Debits {formatMoney(ledger.totalDebit, money.currency, money.locale)} · Credits{" "}
          {formatMoney(ledger.totalCredit, money.currency, money.locale)}
        </span>
        <Amount value={ledger.totalDebit} {...money} className="hidden text-end sm:block" />
        <Amount value={ledger.totalCredit} {...money} className="hidden text-end sm:block" />
        <span className="hidden sm:block" />
      </div>
      <BalanceRow label="Closing balance" value={ledger.closing} money={money} emphasis />
    </ReportCard>
  );
}

function details(line: LedgerLineRow): string {
  const parts = [line.description || line.memo, line.contactName].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Journal entry";
}

function BalanceRow({
  label,
  value,
  money,
  emphasis = false,
}: {
  label: string;
  value: string;
  money: Money;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 border-b px-5 py-2.5 font-semibold text-sm last:border-b-0 sm:px-6 ${
        emphasis ? "bg-primary/5 py-3.5 text-base" : "bg-muted/20"
      }`}
    >
      <span>{label}</span>
      <Amount value={value} {...money} />
    </div>
  );
}
