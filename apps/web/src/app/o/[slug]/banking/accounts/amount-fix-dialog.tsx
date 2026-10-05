"use client";

import { formatMoney } from "@bookalyze/core";
import { CircleCheck, CircleHelp, CircleX, Wand2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AmountFixPreview } from "@/server/amount-fix";
import { applyAmountFixAction, previewAmountFixAction } from "../actions";

const BATCH = 100;
type Line = AmountFixPreview["lines"][number];
type Correction = {
  lineId: string;
  amount: string;
  statement: { feedId: string; externalId: string; date: string; description: string } | null;
};

/**
 * "Correct from Wise": shows how each misrecorded line matches the Wise statement (in bulk; only
 * the unclear ones need a decision), then re-records them in the account's currency.
 */
export function AmountFixDialog({
  slug,
  accountId,
  accountName,
  currency,
  baseCurrency,
  count,
  locale,
}: {
  slug: string;
  accountId: string;
  accountName: string;
  currency: string;
  baseCurrency: string;
  count: number;
  locale: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AmountFixPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState<{ lineId: string; reason: string }[]>([]);
  const [loading, startLoading] = useTransition();
  const [applying, startApplying] = useTransition();

  const load = () =>
    startLoading(async () => {
      setError(null);
      setPreview(null);
      setChoices({});
      setTyped({});
      setSkipped([]);
      const result = await previewAmountFixAction(slug, accountId);
      if (!result.ok) return void setError(result.message);
      setPreview(result.preview);
    });

  const money = (amount: string, code: string) => formatMoney(amount, code, locale);
  const lines = preview?.lines ?? [];
  const matched = lines.filter((l) => l.fix.status === "matched");
  const unclear = lines.filter((l) => l.fix.status === "ambiguous");
  const missing = lines.filter((l) => l.fix.status === "unmatched");

  /** What applying would send: matched lines, chosen look-alikes and amounts typed in. */
  const corrections = lines.flatMap((l): Correction[] => {
    const fix = l.fix;
    const statement = (s: { externalId: string; date: string; text: string }) => ({
      feedId: preview?.feedId ?? "",
      externalId: s.externalId,
      date: s.date,
      description: s.text.slice(0, 500),
    });
    if (fix.status === "matched") {
      return [{ lineId: l.lineId, amount: fix.match.amount, statement: statement(fix.match) }];
    }
    if (fix.status === "ambiguous") {
      const chosen = fix.candidates.find((c) => c.externalId === choices[l.lineId]);
      return chosen
        ? [{ lineId: l.lineId, amount: chosen.amount, statement: statement(chosen) }]
        : [];
    }
    const amount = typed[l.lineId]?.trim();
    if (!amount) return [];
    const negative = l.recorded.startsWith("-");
    return [
      {
        lineId: l.lineId,
        amount: negative ? `-${amount.replace(/^-/, "")}` : amount.replace(/^-/, ""),
        statement: null,
      },
    ];
  });

  const apply = () =>
    startApplying(async () => {
      let corrected = 0;
      const notDone: { lineId: string; reason: string }[] = [];
      setProgress({ done: 0, total: corrections.length });
      for (let i = 0; i < corrections.length; i += BATCH) {
        const result = await applyAmountFixAction(slug, accountId, corrections.slice(i, i + BATCH));
        if (!result.ok) {
          toast.error(result.message);
          break;
        }
        corrected += result.corrected;
        notDone.push(...result.skipped);
        setProgress({ done: Math.min(i + BATCH, corrections.length), total: corrections.length });
      }
      setProgress(null);
      setSkipped(notDone);
      toast.success(`${corrected} ${corrected === 1 ? "transaction" : "transactions"} corrected`, {
        description: `${accountName} now shows real ${currency} amounts. Your ${baseCurrency} reports are unchanged.`,
      });
      if (!notDone.length) setOpen(false);
      else
        setPreview((p) =>
          p
            ? { ...p, lines: p.lines.filter((l) => notDone.some((s) => s.lineId === l.lineId)) }
            : p,
        );
    });

  const row = (l: Line, right: React.ReactNode) => (
    <li
      key={l.lineId}
      className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{l.text || "No description"}</span>
        <span className="text-muted-foreground text-xs">
          JE-{String(l.entryNumber).padStart(4, "0")} · {formatDate(l.date, locale)} · recorded as{" "}
          {money(l.recorded, baseCurrency)}
        </span>
      </span>
      {right}
    </li>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Wand2 />
          Correct from Wise
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Correct {accountName}</DialogTitle>
          <DialogDescription>
            {count} {count === 1 ? "transaction was" : "transactions were"} recorded in{" "}
            {baseCurrency} instead of {currency}. Bookalyze reads your Wise statement and finds each
            one's real {currency} amount. The {baseCurrency} value stays as it was, so your reports
            don't change.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground text-sm">
            <Spinner />
            Reading your Wise statement…
          </div>
        ) : error ? (
          <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm">{error}</p>
        ) : preview ? (
          <div className="grid max-h-[60dvh] gap-4 overflow-y-auto pe-1">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                {
                  icon: CircleCheck,
                  n: matched.length,
                  label: "matched to Wise",
                  tone: "text-success",
                },
                {
                  icon: CircleHelp,
                  n: unclear.length,
                  label: "need a choice",
                  tone: "text-warning",
                },
                {
                  icon: CircleX,
                  n: missing.length,
                  label: "not in Wise",
                  tone: "text-muted-foreground",
                },
              ].map((t) => (
                <div key={t.label} className="rounded-xl border px-2 py-3">
                  <t.icon className={cn("mx-auto size-5", t.tone)} />
                  <p className="tabular mt-1 font-semibold text-xl">{t.n}</p>
                  <p className="text-muted-foreground text-xs">{t.label}</p>
                </div>
              ))}
            </div>

            {matched.length ? (
              <details className="rounded-xl border">
                <summary className="cursor-pointer px-3 py-2.5 font-medium text-sm">
                  Matched ({matched.length}): check a few if you like
                </summary>
                <ul className="divide-y border-t">
                  {matched
                    .slice(0, 200)
                    .map((l) =>
                      row(
                        l,
                        <span className="tabular font-medium text-sm">
                          {l.fix.status === "matched" ? money(l.fix.match.amount, currency) : null}
                        </span>,
                      ),
                    )}
                </ul>
              </details>
            ) : null}

            {unclear.length ? (
              <section className="grid gap-2">
                <h3 className="font-medium text-sm">Which Wise transaction is it?</h3>
                <ul className="divide-y rounded-xl border">
                  {unclear.map((l) =>
                    row(
                      l,
                      <select
                        aria-label={`Wise transaction for JE-${l.entryNumber}`}
                        value={choices[l.lineId] ?? ""}
                        onChange={(e) => setChoices((c) => ({ ...c, [l.lineId]: e.target.value }))}
                        className="h-9 max-w-full rounded-lg border bg-background px-2 text-sm"
                      >
                        <option value="">Leave as is</option>
                        {l.fix.status === "ambiguous"
                          ? l.fix.candidates.map((c) => (
                              <option key={c.externalId} value={c.externalId}>
                                {formatDate(c.date, locale)} · {money(c.amount, currency)} ·{" "}
                                {c.text.slice(0, 40)}
                              </option>
                            ))
                          : null}
                      </select>,
                    ),
                  )}
                </ul>
              </section>
            ) : null}

            {missing.length ? (
              <section className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium text-sm">Not found in Wise</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setTyped(
                        Object.fromEntries(
                          missing
                            .filter((l) => l.fix.estimate)
                            .map((l) => [
                              l.lineId,
                              (l.fix.estimate ?? "")
                                .replace(/^-/, "")
                                .replace(/0+$/, "")
                                .replace(/\.$/, ""),
                            ]),
                        ),
                      )
                    }
                  >
                    Fill in estimates
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  Type the real {currency} amount, or leave empty to keep it as is. Estimates use
                  the Bank of Canada rate of that day, so they may be off by a little.
                </p>
                <ul className="divide-y rounded-xl border">
                  {missing.map((l) =>
                    row(
                      l,
                      <Input
                        aria-label={`${currency} amount for JE-${l.entryNumber}`}
                        inputMode="decimal"
                        value={typed[l.lineId] ?? ""}
                        onChange={(e) => setTyped((t) => ({ ...t, [l.lineId]: e.target.value }))}
                        placeholder={
                          l.fix.estimate
                            ? `≈ ${money(l.fix.estimate.replace(/^-/, ""), currency)}`
                            : currency
                        }
                        className="tabular h-9 w-full sm:w-36"
                      />,
                    ),
                  )}
                </ul>
              </section>
            ) : null}

            {skipped.length ? (
              <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm">
                {skipped.length} couldn't be changed: {skipped[0]?.reason}
              </p>
            ) : null}
            {!lines.length ? (
              <p className="py-6 text-center text-muted-foreground text-sm">
                Nothing left to correct.
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={apply}
            disabled={applying || loading || !corrections.length}
          >
            {applying ? <Spinner /> : <Wand2 />}
            {progress
              ? `Correcting ${progress.done} of ${progress.total}…`
              : `Correct ${corrections.length} ${corrections.length === 1 ? "transaction" : "transactions"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
