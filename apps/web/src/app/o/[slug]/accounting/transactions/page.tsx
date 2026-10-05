import {
  formatDecimal,
  isMoneyAccountSubtype,
  parseDecimal,
  TRANSACTION_KINDS,
  type TransactionKind,
} from "@bookalyze/core";
import {
  contactOptions,
  countOpenDuplicates,
  formatEntryNumber,
  listDuplicateSuggestions,
  listTaxRates,
  listTransactions,
  schema,
} from "@bookalyze/db";
import { eq, sql } from "drizzle-orm";
import { ArrowLeft, ArrowRight, Download, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { nowIn, openDate } from "@/lib/dates";
import { accountOptions, getAccountingContext, inOrg, listAccounts } from "@/server/accounting";
import { TransactionList } from "./transaction-list";
import type { TxFormContext, TxRow } from "./types";

export const metadata: Metadata = { title: "Transactions" };

const PAGE_SIZE = 50;
const STATUSES = ["reviewed", "unreviewed", "duplicates"] as const;
const ORIGINS: Record<string, string> = {
  manual: "Entered by hand",
  bank_import: "From your bank",
  wave_import: "Imported from Wave",
  import: "Imported",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    account?: string;
    contact?: string;
    kind?: string;
    status?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getAccountingContext(slug);
  const profile = ctx.profile;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const accounts = await listAccounts(ctx);
  const moneyAccounts = accounts.filter((a) => isMoneyAccountSubtype(a.subtype) && !a.isArchived);
  const account =
    sp.account && UUID.test(sp.account) && moneyAccounts.some((a) => a.id === sp.account)
      ? sp.account
      : "";
  const kind = (TRANSACTION_KINDS as readonly string[]).includes(sp.kind ?? "")
    ? (sp.kind as TransactionKind)
    : null;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as (typeof STATUSES)[number])
    : "";
  const q = (sp.q ?? "").slice(0, 100);
  const contact = sp.contact && UUID.test(sp.contact) ? sp.contact : "";

  const { result, hasAny, balance, contacts, taxRates, flags, duplicateCount } = await inOrg(
    ctx,
    async (tx) => {
      const contacts = await contactOptions(tx, { includeArchived: true });
      const taxRates = await listTaxRates(tx, { includeArchived: true });
      const result = await listTransactions(tx, {
        accountId: account || null,
        contactId: contact || null,
        kind,
        reviewed: status === "reviewed" ? true : status === "unreviewed" ? false : null,
        possibleDuplicates: status === "duplicates",
        search: q || null,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      const hasAny =
        result.total > 0 || (await listTransactions(tx, { limit: 1, offset: 0 })).total > 0;
      const balance = account
        ? ((
            await tx
              .select({ total: sql<string>`coalesce(sum(${schema.journalLines.amount}), 0)::text` })
              .from(schema.journalLines)
              .where(eq(schema.journalLines.accountId, account))
          )[0]?.total ?? "0")
        : null;
      const flags = await listDuplicateSuggestions(tx, { entryIds: result.rows.map((r) => r.id) });
      const duplicateCount = await countOpenDuplicates(tx);
      return { result, hasAny, balance, contacts, taxRates, flags, duplicateCount };
    },
  );
  const flagOf = new Map(flags.map((f) => [f.entryId, f]));

  const categoryAccounts = accounts.filter((a) => !isMoneyAccountSubtype(a.subtype));
  const ctxForForms: TxFormContext = {
    slug,
    today: openDate(nowIn(profile.timezone).date, profile.booksLockedThrough),
    baseCurrency: profile.baseCurrency,
    locale: profile.locale,
    lockedThrough: profile.booksLockedThrough,
    moneyAccounts: moneyAccounts.map((a) => ({
      id: a.id,
      label: a.code ? `${a.code} · ${a.name}` : a.name,
      currency: a.currency ?? profile.baseCurrency,
    })),
    categories: accountOptions(categoryAccounts).map((g) => ({
      type: g.type,
      options: g.options.map((o) => ({ id: o.id, label: o.label })),
    })),
    accountNames: Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    contacts,
    taxRates: taxRates.map((r) => ({
      id: r.id,
      name: r.name,
      rate: r.rate,
      isRecoverable: r.isRecoverable,
      isArchived: r.isArchived,
    })),
  };

  const rows: TxRow[] = result.rows.map((r) => {
    const flag = flagOf.get(r.id);
    return {
      id: r.id,
      number: formatEntryNumber(r.entryNumber),
      date: r.date,
      memo: r.memo,
      currency: r.currency,
      fxRate: r.fxRate,
      reviewed: r.reviewed,
      reconciledThrough: r.reconciledThrough,
      contactId: r.contactId,
      attachments: r.attachments,
      kind: r.view.kind,
      amount: r.view.amount,
      moneyAccountIds: r.view.moneyAccountIds,
      fromAccountId: r.view.fromAccountId,
      toAccountId: r.view.toAccountId,
      receivedAmount: r.view.receivedAmount,
      receivedCurrency: r.view.receivedCurrency,
      splits: r.view.splits.map((s) => ({
        accountId: s.accountId,
        amount: s.amount,
        ...(s.description ? { description: s.description } : {}),
        ...(s.taxRateId ? { taxRateId: s.taxRateId } : {}),
      })),
      ...(flag
        ? {
            duplicate: {
              suggestionId: flag.id,
              of: {
                id: flag.duplicateOf.id,
                number: formatEntryNumber(flag.duplicateOf.entryNumber),
                date: flag.duplicateOf.date,
                memo: flag.duplicateOf.memo,
                origin: ORIGINS[flag.duplicateOf.source] ?? "In your books",
              },
            },
          }
        : {}),
    };
  });

  const selected = moneyAccounts.find((a) => a.id === account);
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const pageHref = (n: number) => {
    const next = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    next.set("page", String(n));
    return `?${next}`;
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Accounting"
        title="Transactions"
        description="Money in and out of your bank, card and cash accounts. Tick each one once you've checked it."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="outline">
              <Link href={`/o/${slug}/accounting/reports/transactions`}>
                <Download />
                Export for accountant
              </Link>
            </Button>
            {selected && balance !== null ? (
              <div className="rounded-xl border bg-card px-4 py-2.5 text-end shadow-xs">
                <p className="text-muted-foreground text-xs">{selected.name} balance</p>
                <Amount
                  value={formatDecimal(
                    selected.subtype === "credit_card"
                      ? -parseDecimal(balance)
                      : parseDecimal(balance),
                  )}
                  currency={selected.currency ?? profile.baseCurrency}
                  locale={profile.locale}
                  className="font-semibold text-lg"
                />
              </div>
            ) : null}
          </div>
        }
      />

      {moneyAccounts.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-14 text-center shadow-xs">
          <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.06]" />
          <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
            <span className="zoom-in-75 flex size-14 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
              <Landmark className="size-7" />
            </span>
            <div>
              <h2 className="font-semibold text-lg tracking-tight">Add a bank or card account</h2>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                Transactions happen in your bank, card and cash accounts. Add them to your chart of
                accounts first, for example "RBC Chequing" or "Wise USD".
              </p>
            </div>
            <Button asChild>
              <Link href={`/o/${slug}/accounting/accounts?type=asset`}>
                Go to chart of accounts
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <TransactionList
          rows={rows}
          filters={{ account, contact, kind: kind ?? "", status, q }}
          ctx={ctxForForms}
          hasAny={hasAny}
          duplicateCount={duplicateCount}
        />
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {result.total} transactions
          </span>
          <div className="flex gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className={page <= 1 ? "pointer-events-none opacity-50" : ""}
            >
              <Link href={pageHref(page - 1)}>
                <ArrowLeft className="rtl:rotate-180" />
                Newer
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className={page >= pages ? "pointer-events-none opacity-50" : ""}
            >
              <Link href={pageHref(page + 1)}>
                Older
                <ArrowRight className="rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
