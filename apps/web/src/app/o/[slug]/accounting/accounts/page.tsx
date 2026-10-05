import {
  ACCOUNT_TYPES,
  type AccountType,
  accountTypes,
  formatDecimal,
  getAccountSubtype,
  isAccountType,
  parseDecimal,
  subtypesOf,
} from "@bookalyze/core";
import { currencies } from "@bookalyze/core/reference-data";
import { accountBalances, schema } from "@bookalyze/db";
import { eq, isNotNull, sql } from "drizzle-orm";
import { Lock, Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type AccountRow, getAccountingContext, inOrg } from "@/server/accounting";
import { AccountDialog, type EditableAccount } from "./account-dialog";
import { ArchiveButton } from "./archive-button";
import { ChartSetup } from "./chart-setup";

export const metadata: Metadata = { title: "Chart of accounts" };

export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { slug } = await params;
  const { type: typeParam } = await searchParams;
  const type: AccountType = typeParam && isAccountType(typeParam) ? typeParam : "asset";
  const ctx = await getAccountingContext(slug);
  const { accounts, balances, native, used } = await inOrg(ctx, async (tx) => {
    const accounts = await tx.select().from(schema.accounts);
    const balances = await accountBalances(tx);
    const used = await tx
      .selectDistinct({ id: schema.journalLines.accountId })
      .from(schema.journalLines);
    // Balances in each account's own currency, for accounts held in one (bank, card, cash).
    const native = await tx
      .select({
        accountId: schema.journalLines.accountId,
        balance: sql<string>`sum(${schema.journalLines.amount})::numeric(20,4)::text`,
      })
      .from(schema.journalLines)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
      .where(isNotNull(schema.accounts.currency))
      .groupBy(schema.journalLines.accountId);
    return { accounts, balances, native, used: new Set(used.map((u) => u.id)) };
  });
  const balanceOf = new Map(balances.map((b) => [b.accountId, parseDecimal(b.balance)]));
  const nativeOf = new Map(native.map((b) => [b.accountId, parseDecimal(b.balance)]));
  const currencyOptions = currencies.map((c) => ({ code: c.code, name: c.name }));
  const base = ctx.profile.baseCurrency;
  const locale = ctx.profile.locale;

  const toEditable = (a: AccountRow): EditableAccount => ({
    id: a.id,
    name: a.name,
    code: a.code,
    type: a.type,
    subtype: a.subtype,
    description: a.description,
    currency: a.currency,
    isSystem: Boolean(a.systemKey),
    isUsed: used.has(a.id),
  });

  const addButton = (
    <AccountDialog
      slug={slug}
      baseCurrency={base}
      currencies={currencyOptions}
      defaultType={type}
      trigger={
        <Button>
          <Plus />
          Add account
        </Button>
      }
    />
  );

  if (accounts.length === 0) {
    return (
      <div className="grid gap-8">
        <PageHeader
          eyebrow="Accounting"
          title="Chart of accounts"
          description="The categories every transaction is sorted into, from bank accounts to expenses."
        />
        <ChartSetup slug={slug} companyName={ctx.org.name} />
      </div>
    );
  }

  const ofType = accounts
    .filter((a) => a.type === type)
    .sort(
      (a, b) =>
        (a.code ?? "~").localeCompare(b.code ?? "~", undefined, { numeric: true }) ||
        a.name.localeCompare(b.name),
    );
  const active = ofType.filter((a) => !a.isArchived);
  const archived = ofType.filter((a) => a.isArchived);
  const natural = (a: AccountRow, from = balanceOf) => {
    const units = from.get(a.id) ?? 0n;
    return formatDecimal(accountTypes[a.type].normalBalance === "debit" ? units : -units);
  };
  /** In the account's own currency, with what it's worth in the main currency underneath. */
  const balance = (a: AccountRow) =>
    a.currency && a.currency !== base ? (
      <span className="flex flex-col items-end">
        <Amount
          value={natural(a, nativeOf)}
          currency={a.currency}
          locale={locale}
          muteZero
          className="text-sm"
        />
        <Amount
          value={natural(a)}
          currency={base}
          locale={locale}
          muteZero
          className="text-muted-foreground text-xs"
        />
      </span>
    ) : (
      <Amount value={natural(a)} currency={base} locale={locale} muteZero className="text-sm" />
    );

  const row = (a: AccountRow) => (
    <li
      key={a.id}
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5"
    >
      <span className="hidden w-12 shrink-0 font-mono text-muted-foreground text-xs sm:block">
        {a.code}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("font-medium text-sm", a.isArchived && "text-muted-foreground")}>
            <span className="me-1.5 font-mono text-muted-foreground text-xs sm:hidden">
              {a.code}
            </span>
            {a.name}
          </span>
          {a.currency && a.currency !== base ? <Badge variant="outline">{a.currency}</Badge> : null}
          {a.systemKey ? (
            <span
              className="inline-flex items-center gap-1 text-muted-foreground text-xs"
              title="Bookalyze posts to this account automatically, so it can't be archived."
            >
              <Lock className="size-3" />
              Built in
            </span>
          ) : null}
        </div>
        {a.description ? (
          <p className="mt-0.5 truncate text-muted-foreground text-xs">{a.description}</p>
        ) : null}
      </div>
      {balance(a)}
      <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <AccountDialog
          slug={slug}
          baseCurrency={base}
          currencies={currencyOptions}
          account={toEditable(a)}
          trigger={
            <Button variant="ghost" size="icon" aria-label={`Edit ${a.name}`} title="Edit">
              <Pencil />
            </Button>
          }
        />
        {a.systemKey ? (
          <span className="size-9" />
        ) : (
          <ArchiveButton slug={slug} id={a.id} name={a.name} archived={a.isArchived} />
        )}
      </div>
    </li>
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Accounting"
        title="Chart of accounts"
        description="The categories every transaction is sorted into, with balances to date. Accounts held in another currency show their own balance, with its value in your main currency below."
        actions={addButton}
      />

      <nav
        aria-label="Account types"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {ACCOUNT_TYPES.map((t) => {
          const n = accounts.filter((a) => a.type === t && !a.isArchived).length;
          const selected = t === type;
          return (
            <Link
              key={t}
              href={`?type=${t}`}
              scroll={false}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                selected
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {accountTypes[t].label}
              <span
                className={cn(
                  "tabular rounded-full px-1.5 text-xs",
                  selected ? "bg-primary/15" : "bg-muted",
                )}
              >
                {n}
              </span>
            </Link>
          );
        })}
      </nav>

      <p className="-mt-2 text-muted-foreground text-sm">{accountTypes[type].hint}</p>

      <div
        key={type}
        className="fade-in-0 slide-in-from-bottom-1 grid animate-in gap-4 duration-300"
      >
        {subtypesOf(type).map((subtype) => {
          const list = active.filter((a) => a.subtype === subtype.key);
          if (!list.length) return null;
          return (
            <section
              key={subtype.key}
              className="overflow-hidden rounded-2xl border bg-card shadow-xs"
            >
              <h2 className="border-b bg-muted/30 px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider sm:px-5">
                {getAccountSubtype(subtype.key)?.label}
              </h2>
              <ul className="divide-y">{list.map(row)}</ul>
            </section>
          );
        })}
        {active.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center">
            <p className="text-muted-foreground text-sm">
              No {accountTypes[type].label.toLowerCase()} accounts yet.
            </p>
          </div>
        ) : null}
        {archived.length ? (
          <details className="group rounded-2xl border bg-card shadow-xs">
            <summary className="flex items-center justify-between px-4 py-3 font-medium text-muted-foreground text-sm sm:px-5">
              Archived ({archived.length})<span className="text-xs group-open:hidden">Show</span>
              <span className="hidden text-xs group-open:inline">Hide</span>
            </summary>
            <ul className="divide-y border-t">{archived.map(row)}</ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
