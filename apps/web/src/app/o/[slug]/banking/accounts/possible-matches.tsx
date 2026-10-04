"use client";

import { formatMoney } from "@bookalyze/core";
import { ArrowRight, GitMerge, Split } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { keepBothAction, mergeAllMatchesAction, mergeMatchAction } from "../actions";

export type Suggestion = {
  id: string;
  date: string;
  dateLabel: string;
  currency: string;
  amount: string;
  description: string;
  accountName: string;
  entryId: string;
  entryNumber: string;
  entryDateLabel: string;
  entryMemo: string | null;
  entryOrigin: string;
};

/**
 * Bank lines that look like transactions already in the books. Nothing is merged on its own:
 * each one waits for "Merge" (the same transaction: link them, add nothing) or "Keep both"
 * (different: add the bank's as a new transaction).
 */
export function PossibleMatches({
  slug,
  suggestions,
  locale,
}: {
  slug: string;
  suggestions: Suggestion[];
  locale: string;
}) {
  const [pending, start] = useTransition();
  const mergeAll = () =>
    start(async () => {
      const result = await mergeAllMatchesAction(slug);
      if (!result.ok) return void toast.error(result.message);
      toast.success(`Merged ${result.merged} transaction${result.merged === 1 ? "" : "s"}`);
    });

  return (
    <section className="fade-in-0 slide-in-from-bottom-2 animate-in overflow-hidden rounded-2xl border border-warning/40 bg-card shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-warning/10 px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-semibold">
            {suggestions.length === 1
              ? "1 possible match"
              : `${suggestions.length} possible matches`}
          </h2>
          <p className="mt-0.5 max-w-2xl text-muted-foreground text-sm">
            These came from your bank and look like transactions already in your books, so they
            weren't added. Merge them if they're the same; keep both if they're different.
          </p>
        </div>
        {suggestions.length > 1 ? (
          <Button type="button" variant="outline" onClick={mergeAll} disabled={pending}>
            {pending ? <Spinner /> : <GitMerge />}
            Merge all
          </Button>
        ) : null}
      </div>
      <ul className="divide-y">
        {suggestions.map((s) => (
          <MatchRow key={s.id} slug={slug} suggestion={s} locale={locale} />
        ))}
      </ul>
    </section>
  );
}

function MatchRow({
  slug,
  suggestion: s,
  locale,
}: {
  slug: string;
  suggestion: Suggestion;
  locale: string;
}) {
  const [pending, start] = useTransition();
  const amount = formatMoney(s.amount.replace("-", ""), s.currency, locale);
  const signed = s.amount.startsWith("-") ? `−${amount}` : `+${amount}`;

  const merge = () =>
    start(async () => {
      const result = await mergeMatchAction(slug, s.id);
      if (!result.ok) return void toast.error(result.message);
      toast.success("Merged", {
        description: `${s.entryNumber} now stands for the bank's transaction too.`,
      });
    });
  const keep = () =>
    start(async () => {
      const result = await keepBothAction(slug, s.id);
      if (!result.ok) return void toast.error(result.message);
      if (result.posted)
        toast.success("Kept both", {
          description: "The bank's transaction was added as a new one.",
        });
      else toast.message("Kept apart", { description: result.reason });
    });

  return (
    <li className="grid gap-4 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
      <div className="min-w-0 rounded-xl border bg-muted/20 p-3">
        <p className="text-muted-foreground text-xs">
          From the bank · {s.accountName} · {s.dateLabel}
        </p>
        <p className="mt-1 truncate font-medium text-sm">{s.description}</p>
        <p className="tabular mt-0.5 font-semibold text-sm">{signed}</p>
      </div>
      <ArrowRight className="hidden size-4 self-center text-muted-foreground lg:block rtl:rotate-180" />
      <Link
        href={`/o/${slug}/accounting/journal/${s.entryId}`}
        className="min-w-0 rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
      >
        <p className="text-muted-foreground text-xs">
          Already in your books · {s.entryNumber} · {s.entryDateLabel} · {s.entryOrigin}
        </p>
        <p className="mt-1 truncate font-medium text-sm">{s.entryMemo || "No description"}</p>
        <p className="tabular mt-0.5 font-semibold text-sm">{signed}</p>
      </Link>
      <div className="flex gap-2 lg:w-32 lg:flex-col lg:self-center">
        <Button type="button" onClick={merge} disabled={pending} className="flex-1 lg:flex-none">
          {pending ? <Spinner /> : <GitMerge />}
          Merge
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={keep}
          disabled={pending}
          className="flex-1 lg:flex-none"
        >
          <Split />
          Keep both
        </Button>
      </div>
    </li>
  );
}
