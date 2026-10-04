import { formatDecimal, parseDecimal } from "@bookalyze/core";
import { formatEntryNumber, schema } from "@bookalyze/db";
import { count, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeft, ArrowRight, BookText, Plus, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { getAccountingContext, inOrg } from "@/server/accounting";

export const metadata: Metadata = { title: "Journal entries" };

const PAGE_SIZE = 50;

export default async function JournalPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const ctx = await getAccountingContext(slug);
  const locale = ctx.profile.locale;
  const base = `/o/${slug}/accounting`;

  const { entries, total, lines, hasAccounts } = await inOrg(ctx, async (tx) => {
    const [totalRow] = await tx.select({ n: count() }).from(schema.journalEntries);
    const entries = await tx
      .select()
      .from(schema.journalEntries)
      .orderBy(desc(schema.journalEntries.date), desc(schema.journalEntries.entryNumber))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const lines = entries.length
      ? await tx
          .select({
            entryId: schema.journalLines.journalEntryId,
            amount: schema.journalLines.amount,
            currency: schema.journalLines.currency,
            accountName: schema.accounts.name,
          })
          .from(schema.journalLines)
          .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
          .where(
            inArray(
              schema.journalLines.journalEntryId,
              entries.map((e) => e.id),
            ),
          )
          .orderBy(schema.journalLines.lineNo)
      : [];
    const [anyAccount] = await tx.select({ id: schema.accounts.id }).from(schema.accounts).limit(1);
    return { entries, total: totalRow?.n ?? 0, lines, hasAccounts: Boolean(anyAccount) };
  });

  const linesByEntry = new Map<string, typeof lines>();
  for (const line of lines) {
    linesByEntry.set(line.entryId, [...(linesByEntry.get(line.entryId) ?? []), line]);
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const newButton = hasAccounts ? (
    <Button asChild>
      <Link href={`${base}/journal/new`}>
        <Plus />
        New journal entry
      </Link>
    </Button>
  ) : null;

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Accounting"
        title="Journal entries"
        description="Every entry in your books. Each one moves money between accounts, and debits always equal credits."
        actions={newButton}
      />

      {entries.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-14 text-center shadow-xs">
          <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.06]" />
          <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
            <span className="zoom-in-75 flex size-14 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
              <BookText className="size-7" />
            </span>
            <div>
              <h2 className="font-semibold text-lg tracking-tight">No entries yet</h2>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                {hasAccounts
                  ? "Record opening balances, owner contributions or any adjustment. Bank imports and the Wave migration will add entries here automatically later."
                  : "Set up your chart of accounts first, so entries have categories to go into."}
              </p>
            </div>
            {hasAccounts ? (
              newButton
            ) : (
              <Button asChild>
                <Link href={`${base}/accounts`}>Set up chart of accounts</Link>
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[7rem_5.5rem_minmax(0,1fr)_minmax(0,14rem)_9rem] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
            <span>Date</span>
            <span>Entry</span>
            <span>Description</span>
            <span>Accounts</span>
            <span className="text-end">Amount</span>
          </div>
          <ul className="divide-y">
            {entries.map((e, i) => {
              const entryLines = linesByEntry.get(e.id) ?? [];
              const names = [...new Set(entryLines.map((l) => l.accountName))];
              // The entry's size in its own currency: debits, or credits for entries (like a
              // cross-currency transfer) whose debits are in another currency.
              let debits = 0n;
              let credits = 0n;
              for (const l of entryLines) {
                if (l.currency !== e.currency) continue;
                const units = parseDecimal(l.amount);
                if (units > 0n) debits += units;
                else credits -= units;
              }
              const totalStr = formatDecimal(debits > credits ? debits : credits);
              return (
                <li
                  key={e.id}
                  className="fade-in-0 animate-in fill-mode-both"
                  style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                >
                  <Link
                    href={`${base}/journal/${e.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-5 md:grid-cols-[7rem_5.5rem_minmax(0,1fr)_minmax(0,14rem)_9rem] md:items-center"
                  >
                    <span className="tabular text-muted-foreground text-sm md:text-foreground">
                      {formatDate(e.date, locale)}
                      <span className="ms-2 font-mono text-xs md:hidden">
                        {formatEntryNumber(e.entryNumber)}
                      </span>
                    </span>
                    <span className="hidden font-mono text-muted-foreground text-xs md:block">
                      {formatEntryNumber(e.entryNumber)}
                    </span>
                    <span className="col-start-1 flex min-w-0 items-center gap-2 md:col-start-auto">
                      <span className="truncate font-medium text-sm">
                        {e.memo || e.reference || "Journal entry"}
                      </span>
                      {e.reversedByEntryId ? <Badge variant="secondary">Reversed</Badge> : null}
                      {e.reversesEntryId ? (
                        <Badge variant="outline">
                          <Undo2 />
                          Reversal
                        </Badge>
                      ) : null}
                    </span>
                    <span className="col-start-1 truncate text-muted-foreground text-xs md:col-start-auto md:text-sm">
                      {names.slice(0, 2).join(", ")}
                      {names.length > 2 ? ` +${names.length - 2} more` : ""}
                    </span>
                    <span className="col-start-2 row-span-2 row-start-1 self-center text-end md:col-start-auto md:row-span-1 md:row-start-auto">
                      <Amount
                        value={totalStr}
                        currency={e.currency}
                        locale={locale}
                        className="font-medium text-sm"
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {total} entries
          </span>
          <div className="flex gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              aria-disabled={page <= 1}
              className={page <= 1 ? "pointer-events-none opacity-50" : ""}
            >
              <Link href={`?page=${page - 1}`}>
                <ArrowLeft className="rtl:rotate-180" />
                Newer
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              aria-disabled={page >= pages}
              className={page >= pages ? "pointer-events-none opacity-50" : ""}
            >
              <Link href={`?page=${page + 1}`}>
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
