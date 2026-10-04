import { formatDecimal, parseDecimal } from "@bookalyze/core";
import { formatEntryNumber, schema } from "@bookalyze/db";
import { eq, inArray } from "drizzle-orm";
import { ArrowLeft, Plus, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDate, nowIn } from "@/lib/dates";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { ReverseDialog } from "./reverse-dialog";

export const metadata: Metadata = { title: "Journal entry" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOURCE_LABELS: Record<string, string> = {
  manual: "Entered by hand",
  reversal: "Reversal",
  bank_import: "Bank import",
  wave_import: "Imported from Wave",
};

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getAccountingContext(slug);
  const locale = ctx.profile.locale;
  const base = ctx.profile.baseCurrency;

  const data = await inOrg(ctx, async (tx) => {
    const [entry] = await tx
      .select({ entry: schema.journalEntries, author: schema.user.name })
      .from(schema.journalEntries)
      .leftJoin(schema.user, eq(schema.user.id, schema.journalEntries.createdBy))
      .where(eq(schema.journalEntries.id, id));
    if (!entry) return null;
    const lines = await tx
      .select({ line: schema.journalLines, account: schema.accounts })
      .from(schema.journalLines)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.journalLines.accountId))
      .where(eq(schema.journalLines.journalEntryId, id))
      .orderBy(schema.journalLines.lineNo);
    const relatedIds = [entry.entry.reversedByEntryId, entry.entry.reversesEntryId].filter(
      (v): v is string => Boolean(v),
    );
    const related = relatedIds.length
      ? await tx
          .select({
            id: schema.journalEntries.id,
            number: schema.journalEntries.entryNumber,
            date: schema.journalEntries.date,
          })
          .from(schema.journalEntries)
          .where(inArray(schema.journalEntries.id, relatedIds))
      : [];
    return { ...entry, lines, related };
  });
  if (!data) notFound();

  const { entry, author, lines, related } = data;
  const number = formatEntryNumber(entry.entryNumber);
  const foreign = entry.currency !== base;
  const reversedBy = related.find((r) => r.id === entry.reversedByEntryId);
  const reverses = related.find((r) => r.id === entry.reversesEntryId);
  const sum = (pick: (amount: bigint) => boolean, field: "amount" | "baseAmount") =>
    formatDecimal(
      lines.reduce((t, { line }) => {
        const v = parseDecimal(line[field]);
        return pick(v) ? t + (v < 0n ? -v : v) : t;
      }, 0n),
    );
  const journalHref = `/o/${slug}/accounting/journal`;
  const cols = foreign
    ? "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_8rem_8rem_8rem]"
    : "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_8rem_8rem]";

  return (
    <div className="grid gap-6">
      <Link
        href={journalHref}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        All journal entries
      </Link>

      <PageHeader
        eyebrow={<span className="font-mono">{number}</span>}
        title={entry.memo || "Journal entry"}
        actions={
          <div className="flex gap-2">
            {!entry.reversedByEntryId && !entry.reversesEntryId ? (
              <ReverseDialog
                slug={slug}
                entryId={entry.id}
                entryNumber={number}
                today={nowIn(ctx.profile.timezone).date}
              />
            ) : null}
            <Button asChild>
              <Link href={`${journalHref}/new`}>
                <Plus />
                New entry
              </Link>
            </Button>
          </div>
        }
      />

      {reversedBy ? (
        <Alert>
          This entry was reversed by{" "}
          <Link
            href={`${journalHref}/${reversedBy.id}`}
            className="font-medium text-primary hover:underline"
          >
            {formatEntryNumber(reversedBy.number)}
          </Link>{" "}
          on {formatDate(reversedBy.date, locale)}, so together they have no effect on your books.
        </Alert>
      ) : null}
      {reverses ? (
        <Alert>
          <Undo2 className="me-1.5 inline size-4 align-[-3px]" />
          This entry reverses{" "}
          <Link
            href={`${journalHref}/${reverses.id}`}
            className="font-medium text-primary hover:underline"
          >
            {formatEntryNumber(reverses.number)}
          </Link>
          .
        </Alert>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6 md:grid-cols-4">
        <div>
          <dt className="text-muted-foreground text-xs">Date</dt>
          <dd className="mt-1 font-medium text-sm">{formatDate(entry.date, locale, "long")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Reference</dt>
          <dd className="mt-1 font-medium text-sm">{entry.reference || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Currency</dt>
          <dd className="mt-1 font-medium text-sm">
            {entry.currency}
            {foreign ? (
              <span className="tabular ms-1.5 font-normal text-muted-foreground">
                1 {entry.currency} = {entry.fxRate.replace(/\.?0+$/, "")} {base}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Source</dt>
          <dd className="mt-1 font-medium text-sm">
            {SOURCE_LABELS[entry.source] ?? entry.source}
            <span className="block font-normal text-muted-foreground text-xs">
              {author ? `${author}, ` : ""}
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: ctx.profile.timezone,
              }).format(entry.createdAt)}
            </span>
          </dd>
        </div>
      </dl>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div
          className={`hidden gap-4 border-b bg-muted/30 px-6 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid ${cols}`}
        >
          <span>Account</span>
          <span>Description</span>
          <span className="text-end">Debit</span>
          <span className="text-end">Credit</span>
          {foreign ? <span className="text-end">In {base}</span> : null}
        </div>
        <ul className="divide-y">
          {lines.map(({ line, account }) => {
            const amount = parseDecimal(line.amount);
            const abs = formatDecimal(amount < 0n ? -amount : amount);
            return (
              <li
                key={line.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-5 py-3.5 sm:px-6 md:items-center ${cols}`}
              >
                <span className="font-medium text-sm">
                  {account.code ? (
                    <span className="me-2 font-mono text-muted-foreground text-xs">
                      {account.code}
                    </span>
                  ) : null}
                  {account.name}
                </span>
                <span className="col-start-1 text-muted-foreground text-sm md:col-start-auto">
                  {line.description}
                </span>
                <span className="col-start-2 row-span-2 row-start-1 self-center text-end text-sm md:col-start-auto md:row-span-1 md:row-start-auto">
                  {amount > 0n ? (
                    <Amount value={abs} currency={entry.currency} locale={locale} />
                  ) : (
                    <span className="hidden md:inline" />
                  )}
                  {amount < 0n ? (
                    <span className="md:hidden">
                      <Amount value={abs} currency={entry.currency} locale={locale} />
                      <span className="ms-1 text-muted-foreground text-xs">Cr</span>
                    </span>
                  ) : null}
                </span>
                <span className="hidden text-end text-sm md:block">
                  {amount < 0n ? (
                    <Amount value={abs} currency={entry.currency} locale={locale} />
                  ) : null}
                </span>
                {foreign ? (
                  <span className="hidden text-end text-muted-foreground text-sm md:block">
                    <Amount value={line.baseAmount} currency={base} locale={locale} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div
          className={`grid grid-cols-2 gap-4 border-t bg-muted/30 px-5 py-3 font-semibold text-sm sm:px-6 ${cols}`}
        >
          <span className="md:col-span-2">Total</span>
          <span className="text-end">
            <span className="me-1 font-normal text-muted-foreground text-xs md:hidden">Debits</span>
            <Amount
              value={sum((v) => v > 0n, "amount")}
              currency={entry.currency}
              locale={locale}
            />
          </span>
          <span className="col-start-2 text-end md:col-start-auto">
            <span className="me-1 font-normal text-muted-foreground text-xs md:hidden">
              Credits
            </span>
            <Amount
              value={sum((v) => v < 0n, "amount")}
              currency={entry.currency}
              locale={locale}
            />
          </span>
          {foreign ? (
            <span className="hidden text-end md:block">
              <Amount value={sum((v) => v > 0n, "baseAmount")} currency={base} locale={locale} />
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
