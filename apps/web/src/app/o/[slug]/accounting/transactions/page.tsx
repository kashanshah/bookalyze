import {
  can,
  formatDecimal,
  isMoneyAccountSubtype,
  parseDecimal,
  readPaging,
  TRANSACTION_KINDS,
  type TransactionKind,
} from "@bookalyze/core";
import {
  contactOptions,
  countNeedsAccount,
  countOpenDuplicates,
  formatEntryNumber,
  listDuplicateSuggestions,
  listTaxRates,
  listTransactions,
  matchedTransferIds,
  ruleNamesFor,
  schema,
  suggestedRules,
  suggestTransfers,
  TRANSACTION_STATUSES,
  type TransactionStatus,
} from "@bookalyze/db";
import { eq, sql } from "drizzle-orm";
import { Download, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { nowIn, openDate } from "@/lib/dates";
import { accountOptions, getAccountingContext, inOrg, listAccounts } from "@/server/accounting";
import { TransactionList } from "./transaction-list";
import type { TxFormContext, TxRow } from "./types";

export const metadata: Metadata = { title: "Transactions" };

/** A filter's choices from the address: `?category=<id>,<id>` (repeated keys work too). */
function listParam(value: string | string[] | undefined): string[] {
  const parts = (Array.isArray(value) ? value : [value ?? ""]).flatMap((v) => v.split(","));
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))].slice(0, 50);
}
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
    account?: string | string[];
    category?: string | string[];
    contact?: string;
    kind?: string | string[];
    status?: string | string[];
    q?: string;
    page?: string;
    per?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getAccountingContext(slug);
  const profile = ctx.profile;
  const { page, perPage } = readPaging(sp);

  const accounts = await listAccounts(ctx);
  const moneyAccounts = accounts.filter((a) => isMoneyAccountSubtype(a.subtype) && !a.isArchived);
  // Each filter takes several choices; any of them matches (filters still narrow each other).
  const accountIds = listParam(sp.account).filter(
    (id) => UUID.test(id) && moneyAccounts.some((a) => a.id === id),
  );
  const categoryIds = listParam(sp.category).filter(
    (id) => UUID.test(id) && accounts.some((a) => a.id === id && !isMoneyAccountSubtype(a.subtype)),
  );
  const kinds = listParam(sp.kind).filter((k): k is TransactionKind =>
    (TRANSACTION_KINDS as readonly string[]).includes(k),
  );
  const statuses = listParam(sp.status).filter((st): st is TransactionStatus =>
    (TRANSACTION_STATUSES as readonly string[]).includes(st),
  );
  // One account chosen: its balance shows, and new transactions start on it.
  const account = accountIds.length === 1 ? (accountIds[0] ?? "") : "";
  const accountFilter = accountIds.join(",");
  const category = categoryIds.join(",");
  const kind = kinds.join(",");
  const status = statuses.join(",");
  const q = (sp.q ?? "").slice(0, 100);
  const contact = sp.contact && UUID.test(sp.contact) ? sp.contact : "";

  const {
    result,
    hasAny,
    balance,
    contacts,
    taxRates,
    flags,
    duplicateCount,
    needsAccountCount,
    rules,
    transferPairs,
    partners,
    matched,
    ruleSuggestionCount,
  } = await inOrg(ctx, async (tx) => {
    const contacts = await contactOptions(tx, { includeArchived: true });
    const taxRates = await listTaxRates(tx, { includeArchived: true });
    const transferPairs = await suggestTransfers(tx);
    const result = await listTransactions(tx, {
      accountIds,
      categoryIds,
      contactId: contact || null,
      kinds,
      statuses,
      transferEntryIds: statuses.includes("transfers")
        ? transferPairs.flatMap((p) => [p.outId, p.inId])
        : undefined,
      search: q || null,
      limit: perPage,
      offset: (page - 1) * perPage,
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
    const needsAccountCount = await countNeedsAccount(tx);
    const rules = await ruleNamesFor(
      tx,
      result.rows.map((r) => r.id),
    );
    // The other side of each suggested transfer on this page, to show beside it.
    const onPage = new Set(result.rows.map((r) => r.id));
    const partnerIds = transferPairs
      .filter((p) => onPage.has(p.outId) || onPage.has(p.inId))
      .flatMap((p) => [p.outId, p.inId]);
    const partners = partnerIds.length
      ? (await listTransactions(tx, { entryIds: partnerIds, limit: partnerIds.length, offset: 0 }))
          .rows
      : [];
    const matched = await matchedTransferIds(tx, [...onPage]);
    const ruleSuggestionCount = can(ctx.plan, ctx.enabledModules, "banking.rules")
      ? (await suggestedRules(tx)).length
      : 0;
    return {
      result,
      hasAny,
      balance,
      contacts,
      taxRates,
      flags,
      duplicateCount,
      needsAccountCount,
      rules,
      transferPairs,
      partners,
      matched,
      ruleSuggestionCount,
    };
  });
  const flagOf = new Map(flags.map((f) => [f.entryId, f]));
  const partnerOf = new Map(partners.map((p) => [p.id, p]));
  const pairOf = new Map(
    transferPairs.flatMap((p) => [[p.outId, p] as const, [p.inId, p] as const]),
  );

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
    canMakeRules: can(ctx.plan, ctx.enabledModules, "banking.rules"),
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
      ...(r.view.needsAccount ? { needsAccount: true } : {}),
      ...(matched.has(r.id) ? { matchedTransfer: true } : {}),
      ...transferSuggestion(r.id),
      splits: r.view.splits.map((s) => ({
        accountId: s.accountId,
        amount: s.amount,
        ...(s.description ? { description: s.description } : {}),
        ...(s.taxRateId ? { taxRateId: s.taxRateId } : {}),
      })),
      ...(rules.get(r.id) ? { rule: rules.get(r.id) } : {}),
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

  function transferSuggestion(id: string): Pick<TxRow, "transfer"> {
    const pair = pairOf.get(id);
    const other = pair && partnerOf.get(pair.outId === id ? pair.inId : pair.outId);
    if (!pair || !other) return {};
    return {
      transfer: {
        outId: pair.outId,
        inId: pair.inId,
        other: {
          id: other.id,
          number: formatEntryNumber(other.entryNumber),
          date: other.date,
          memo: other.memo,
          accountId: other.view.moneyAccountIds[0] ?? "",
          amount: other.view.amount,
          currency: other.currency,
        },
      },
    };
  }

  const selected = moneyAccounts.find((a) => a.id === account);
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
          filters={{
            account: accountFilter,
            category,
            contact,
            kind,
            status,
            q,
            per: sp.per ?? "",
          }}
          ctx={ctxForForms}
          hasAny={hasAny}
          duplicateCount={duplicateCount}
          needsAccountCount={needsAccountCount}
          transferCount={transferPairs.length}
          ruleSuggestionCount={ruleSuggestionCount}
          footer={
            <Pagination
              page={page}
              perPage={perPage}
              total={result.total}
              noun={["transaction", "transactions"]}
              locale={profile.locale}
              query={{
                account: accountFilter || undefined,
                category: category || undefined,
                contact: contact || undefined,
                kind: kind || undefined,
                status: status || undefined,
                q: q || undefined,
              }}
            />
          }
        />
      )}
    </div>
  );
}
