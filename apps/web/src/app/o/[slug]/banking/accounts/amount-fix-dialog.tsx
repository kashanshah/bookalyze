"use client";

import { formatMoney, type PdfStatementRead } from "@bookalyze/core";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  FileText,
  Upload,
  Wand2,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
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
import { readPdfStatementFile } from "@/lib/pdf-statement";
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

type ReadFile = { name: string; read: PdfStatementRead | null; error: string | null };

/**
 * "Correct from Wise" / "Correct from statements": shows how each misrecorded line matches the
 * account's statement (in bulk; only the unclear ones need a decision), then re-records them in
 * the account's currency. The statement is Wise's, or PDF statements the person adds (read in
 * the browser, checked against their running balances).
 */
export function AmountFixDialog({
  slug,
  accountId,
  accountName,
  currency,
  baseCurrency,
  count,
  locale,
  source = "wise",
}: {
  slug: string;
  accountId: string;
  accountName: string;
  currency: string;
  baseCurrency: string;
  count: number;
  locale: string;
  source?: "wise" | "statement";
}) {
  const [files, setFiles] = useState<ReadFile[]>([]);
  const [reading, startReading] = useTransition();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AmountFixPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState<{ lineId: string; reason: string }[]>([]);
  const [loading, startLoading] = useTransition();
  const [applying, startApplying] = useTransition();

  const load = (statement?: { externalId: string; date: string; amount: string; text: string }[]) =>
    startLoading(async () => {
      setError(null);
      setPreview(null);
      setChoices({});
      setTyped({});
      setSkipped([]);
      const result = await previewAmountFixAction(slug, accountId, statement);
      if (!result.ok) return void setError(result.message);
      setPreview(result.preview);
    });

  const addFiles = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    startReading(async () => {
      const read: ReadFile[] = [];
      for (const file of picked) {
        try {
          const result = await readPdfStatementFile(file);
          read.push({ name: file.name, read: result, error: result.problem });
        } catch {
          read.push({ name: file.name, read: null, error: "This file couldn't be read as a PDF." });
        }
      }
      setFiles((f) => [...f.filter((x) => !read.some((r) => r.name === x.name)), ...read]);
    });
  };
  const statementRows = files.flatMap((f, fileIndex) =>
    f.read && !f.error
      ? f.read.rows.map((r, i) => ({
          externalId: `pdf:${fileIndex}:${i}`,
          date: r.date,
          amount: r.amount,
          text: r.description,
        }))
      : [],
  );

  const money = (amount: string, code: string) => formatMoney(amount, code, locale);
  const lines = preview?.lines ?? [];
  const matched = lines.filter((l) => l.fix.status === "matched");
  const unclear = lines.filter((l) => l.fix.status === "ambiguous");
  const missing = lines.filter((l) => l.fix.status === "unmatched");

  /** What applying would send: matched lines, chosen look-alikes and amounts typed in. */
  const corrections = lines.flatMap((l): Correction[] => {
    const fix = l.fix;
    const feedId = preview?.feedId;
    const statement = (s: { externalId: string; date: string; text: string }) =>
      feedId
        ? { feedId, externalId: s.externalId, date: s.date, description: s.text.slice(0, 500) }
        : null;
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
        if (o && source === "wise") load();
        if (o && source === "statement") {
          setPreview(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Wand2 />
          {source === "wise" ? "Correct from Wise" : "Correct from statements"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Correct {accountName}</DialogTitle>
          <DialogDescription>
            {count} {count === 1 ? "transaction was" : "transactions were"} recorded in{" "}
            {baseCurrency} instead of {currency}.{" "}
            {source === "wise"
              ? "Bookalyze reads your Wise statement"
              : `Add the account's ${currency} statements (the bank's PDFs) and Bookalyze reads them`}{" "}
            to find each one's real {currency} amount. The {baseCurrency} value stays as it was, so
            your reports don't change.
          </DialogDescription>
        </DialogHeader>

        {source === "statement" && !preview && !loading ? (
          <div className="grid gap-3">
            <label
              htmlFor="statement-pdfs"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm transition-colors hover:bg-muted/40"
            >
              {reading ? <Spinner /> : <Upload className="size-5 text-primary" />}
              <span className="font-medium">{reading ? "Reading…" : "Add statements (PDF)"}</span>
              <span className="text-muted-foreground text-xs">
                As many months as you like. They're read on this device and not uploaded.
              </span>
              <input
                id="statement-pdfs"
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="sr-only"
                aria-label="Statement PDFs"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {files.length ? (
              <ul className="divide-y rounded-xl border text-sm">
                {files.map((f) => (
                  <li key={f.name} className="flex items-start gap-3 px-3 py-2.5">
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{f.name}</span>
                      <span className="block text-muted-foreground text-xs">
                        {f.error ??
                          (f.read
                            ? `${f.read.period ? `${formatDate(f.read.period.from, locale)} – ${formatDate(f.read.period.to, locale)} · ` : ""}${f.read.rows.length} ${f.read.rows.length === 1 ? "transaction" : "transactions"}`
                            : "")}
                      </span>
                    </span>
                    {f.error ? (
                      <CircleX className="size-4 shrink-0 text-destructive" />
                    ) : f.read?.balancesAgree ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-success text-xs">
                        <CircleCheck className="size-3.5" />
                        Balances check out
                      </span>
                    ) : (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 text-warning text-xs"
                        title="The rows read don't add up to every balance printed on the statement. Check the matches before applying."
                      >
                        <CircleAlert className="size-3.5" />
                        Check the matches
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {error ? <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm">{error}</p> : null}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground text-sm">
            <Spinner />
            {source === "wise" ? "Reading your Wise statement…" : "Matching your statements…"}
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
                  label: source === "wise" ? "matched to Wise" : "matched",
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
                  label: source === "wise" ? "not in Wise" : "not in the statements",
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
                <h3 className="font-medium text-sm">
                  Which {source === "wise" ? "Wise" : "statement"} transaction is it?
                </h3>
                <ul className="divide-y rounded-xl border">
                  {unclear.map((l) =>
                    row(
                      l,
                      <Combobox
                        aria-label={`Statement transaction for JE-${l.entryNumber}`}
                        value={choices[l.lineId] ?? ""}
                        onChange={(v) => setChoices((c) => ({ ...c, [l.lineId]: v }))}
                        options={[
                          { value: "", label: "Leave as is" },
                          ...(l.fix.status === "ambiguous"
                            ? l.fix.candidates.map((c) => ({
                                value: c.externalId,
                                label: `${formatDate(c.date, locale)} · ${money(c.amount, currency)}`,
                                description: c.text,
                              }))
                            : []),
                        ]}
                        searchPlaceholder="Type a date, amount or description"
                        className="h-9"
                        wrapperClassName="w-full max-w-xs"
                      />,
                    ),
                  )}
                </ul>
              </section>
            ) : null}

            {missing.length ? (
              <section className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium text-sm">
                    Not found in {source === "wise" ? "Wise" : "the statements"}
                  </h3>
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
          {source === "statement" && !preview ? (
            <Button
              type="button"
              onClick={() => load(statementRows)}
              disabled={loading || reading || !statementRows.length}
            >
              {loading ? <Spinner /> : <Wand2 />}
              Match {statementRows.length}{" "}
              {statementRows.length === 1 ? "transaction" : "transactions"}
            </Button>
          ) : (
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
