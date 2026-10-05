"use client";

import {
  type CsvTable,
  type DateOrder,
  formatMoney,
  guessStatementColumns,
  mappingFromSettings,
  readCsvTable,
  readStatement,
  type StatementField,
  type StatementMapping,
  type StatementSettings,
  statementAccounts,
  statementDateOrder,
  statementSettings,
} from "@bookalyze/core";
import { FileUp, Settings2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { uploadStatementAction } from "../actions";
import { summaryMessage } from "./summary";

export type StatementAccount = {
  id: string;
  label: string;
  currency: string;
  isCard: boolean;
  /** How this account's statements were read last time, if any were uploaded. */
  settings?: StatementSettings;
};

const CHUNK = 500;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
type AmountStyle = "in" | "out" | "split";
type Step = "file" | "columns" | "uploading";

const NONE = "";

/**
 * Upload a bank or card statement (CSV) into a money account. Columns are matched the first time
 * and remembered for the account; after that, choosing the file is enough.
 */
export function StatementUploadDialog({
  slug,
  accounts,
  defaultAccountId,
  open,
  onOpenChange,
  locale,
}: {
  slug: string;
  accounts: StatementAccount[];
  defaultAccountId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("file");
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [file, setFile] = useState<{ name: string; table: CsvTable } | null>(null);
  const [mapping, setMapping] = useState<StatementMapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>("mdy");
  const [style, setStyle] = useState<AmountStyle>("in");
  const [fingerprint, setFingerprint] = useState("");
  const [remembered, setRemembered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const account = accounts.find((a) => a.id === accountId);

  const fileAccounts = useMemo(
    () =>
      file && mapping.account !== undefined ? statementAccounts(file.table, mapping.account) : [],
    [file, mapping.account],
  );
  const filtering = fileAccounts.length > 1;
  const options = useMemo(
    () => ({
      dateOrder,
      positiveIs: style === "out" ? ("out" as const) : ("in" as const),
      ...(filtering && fingerprint ? { accountFingerprint: fingerprint } : {}),
    }),
    [dateOrder, style, filtering, fingerprint],
  );
  const usable =
    mapping.date !== undefined &&
    mapping.description !== undefined &&
    (style === "split"
      ? mapping.moneyIn !== undefined && mapping.moneyOut !== undefined
      : mapping.amount !== undefined) &&
    (!filtering || Boolean(fingerprint));
  const read = useMemo(() => {
    if (!file || !account || !usable) return null;
    const effective: StatementMapping = { ...mapping };
    if (style === "split") delete effective.amount;
    else {
      delete effective.moneyIn;
      delete effective.moneyOut;
    }
    return readStatement(file.table, effective, options, {
      accountId: account.id,
      currency: account.currency,
    });
  }, [file, account, usable, mapping, style, options]);

  function reset() {
    setStep("file");
    setFile(null);
    setError(null);
    setRemembered(false);
  }

  function prepare(table: CsvTable, chosen: StatementAccount | undefined) {
    const saved = chosen?.settings ? mappingFromSettings(table.headers, chosen.settings) : null;
    const next = saved ?? guessStatementColumns(table.headers, chosen?.currency);
    setMapping(next);
    setDateOrder(chosen?.settings?.dateOrder ?? statementDateOrder(table, next).order);
    setStyle(
      next.moneyIn !== undefined && next.moneyOut !== undefined && next.amount === undefined
        ? "split"
        : (chosen?.settings?.positiveIs ?? (chosen?.isCard ? "out" : "in")),
    );
    setFingerprint(chosen?.settings?.account?.fingerprint ?? "");
    setRemembered(Boolean(saved));
  }

  async function pick(files: FileList | null) {
    const picked = files?.[0];
    if (!picked) return;
    setError(null);
    if (picked.size > MAX_FILE_BYTES) return setError("That file is over 20 MB. Split it by date.");
    try {
      const table = readCsvTable(await picked.text());
      if (!table.rows.length) return setError("That file has no rows under its headings.");
      setFile({ name: picked.name, table });
      prepare(table, account);
    } catch {
      setError("That file couldn't be read as CSV. Download it again as CSV from your bank.");
    }
  }

  async function upload() {
    if (!read?.lines.length || !account || !file) return;
    setStep("uploading");
    setProgress({ done: 0, total: read.lines.length });
    const settings = statementSettings(
      file.table.headers,
      style === "split"
        ? { ...mapping, amount: undefined }
        : { ...mapping, moneyIn: undefined, moneyOut: undefined },
      options,
      fileAccounts.find((a) => a.fingerprint === fingerprint)?.hint,
    );
    const total = {
      posted: 0,
      duplicates: 0,
      flagged: 0,
      categorized: 0,
      skipped: [] as { externalId: string; date: string; reason: string }[],
    };
    for (let i = 0; i < read.lines.length; i += CHUNK) {
      const lines = read.lines.slice(i, i + CHUNK).map((l) => ({
        externalId: l.externalId,
        date: l.date,
        amount: l.amount,
        description: l.description,
        reference: l.reference,
      }));
      const result = await uploadStatementAction(slug, {
        accountId: account.id,
        settings,
        lines,
      }).catch(() => null);
      if (!result?.ok) {
        setStep("columns");
        setError(
          `${result?.message ?? "The connection dropped while saving."} ${
            i ? "What was saved stays; uploading the file again carries on without duplicates." : ""
          }`,
        );
        return;
      }
      total.posted += result.summary.posted;
      total.duplicates += result.summary.duplicates;
      total.flagged += result.summary.flagged;
      total.categorized += result.summary.categorized;
      total.skipped.push(...result.summary.skipped);
      setProgress({ done: Math.min(i + CHUNK, read.lines.length), total: read.lines.length });
    }
    const { title, description } = summaryMessage({ ...total, error: null });
    toast.success(title === "Up to date" ? "Already in your books" : title, {
      description:
        title === "Up to date"
          ? "Every transaction in this file was brought in before."
          : description,
    });
    onOpenChange(false);
    reset();
    router.refresh();
  }

  const columnOptions = [
    { value: NONE, label: "Not in this file" },
    ...(file?.table.headers ?? []).map((h, i) => ({
      value: String(i),
      label: h || `Column ${i + 1}`,
    })),
  ];
  const column = (field: StatementField, label: string, hint?: string) => (
    <Field label={label} htmlFor={`statement-${field}`} hint={hint}>
      <Combobox
        id={`statement-${field}`}
        value={mapping[field] === undefined ? NONE : String(mapping[field])}
        onChange={(v) =>
          setMapping((m) => {
            const next = { ...m };
            if (v === NONE) delete next[field];
            else next[field] = Number(v);
            return next;
          })
        }
        options={columnOptions}
      />
    </Field>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (step === "uploading") return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Upload a bank statement</DialogTitle>
          <DialogDescription>
            Download your transactions as a CSV file from your online banking, then add it here.
            Uploading the same file twice, or one that overlaps, never adds anything twice.
          </DialogDescription>
        </DialogHeader>

        {step === "uploading" ? (
          <div className="grid gap-2 py-4">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label="Upload progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{
                  width: `${progress.total ? Math.max(4, (progress.done / progress.total) * 100) : 4}%`,
                }}
              />
            </div>
            <p className="tabular text-muted-foreground text-sm">
              {progress.done.toLocaleString(locale)} of {progress.total.toLocaleString(locale)}{" "}
              transactions
            </p>
          </div>
        ) : (
          <div className="grid max-h-[65vh] min-w-0 grid-cols-[minmax(0,1fr)] gap-5 overflow-y-auto pe-1">
            <Field
              label="Which account is this statement for?"
              htmlFor="statement-account"
              hint="A bank, card or cash account from your chart of accounts."
            >
              <Combobox
                id="statement-account"
                value={accountId}
                onChange={(v) => {
                  setAccountId(v);
                  if (file)
                    prepare(
                      file.table,
                      accounts.find((a) => a.id === v),
                    );
                }}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.label,
                  keywords: a.currency,
                }))}
                placeholder="Choose an account…"
                searchPlaceholder="Search your accounts"
              />
            </Field>

            <div>
              <button
                type="button"
                onClick={() => input.current?.click()}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 text-start transition-colors hover:border-primary/40 hover:bg-primary/[0.02]",
                  file && "border-solid bg-muted/30",
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  {file ? <FileUp className="size-5" /> : <Upload className="size-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-sm">
                    {file ? file.name : "Choose the CSV file"}
                  </span>
                  <span className="block text-muted-foreground text-xs">
                    {file
                      ? `${file.table.rows.length.toLocaleString(locale)} rows · click to pick another`
                      : "It's read in your browser first, so you can check it before anything is saved."}
                  </span>
                </span>
              </button>
              <input
                ref={input}
                type="file"
                accept=".csv,.txt,text/csv"
                className="hidden"
                aria-label="Statement file"
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {file && account && remembered && step === "file" ? (
              <div className="fade-in-0 flex animate-in flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 text-muted-foreground">
                  Read the way you matched this account's statements last time.
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep("columns")}>
                  <Settings2 />
                  Change columns
                </Button>
              </div>
            ) : null}

            {file && account && (!remembered || step === "columns") ? (
              <div className="fade-in-0 grid min-w-0 animate-in grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                {column("date", "Date")}
                <Field label="Dates are written" htmlFor="statement-date-order">
                  <Combobox
                    id="statement-date-order"
                    value={dateOrder}
                    onChange={(v) => setDateOrder(v as DateOrder)}
                    options={[
                      { value: "mdy", label: "Month first (01/31/2026)" },
                      { value: "dmy", label: "Day first (31/01/2026)" },
                      { value: "ymd", label: "Year first (2026-01-31)" },
                    ]}
                  />
                </Field>
                {column("description", "Description")}
                {column(
                  "description2",
                  "More description (optional)",
                  "Read together with the first.",
                )}
                <Field
                  label="How amounts are written"
                  htmlFor="statement-style"
                  className="sm:col-span-2"
                >
                  <Combobox
                    id="statement-style"
                    value={style}
                    onChange={(v) => setStyle(v as AmountStyle)}
                    options={[
                      {
                        value: "in",
                        label: "One column: positive is money in, negative is money out",
                      },
                      {
                        value: "out",
                        label: "One column: positive is money spent (most card statements)",
                      },
                      { value: "split", label: "Two columns: one for money out, one for money in" },
                    ]}
                  />
                </Field>
                {style === "split" ? (
                  <>
                    {column("moneyOut", "Money out")}
                    {column("moneyIn", "Money in")}
                  </>
                ) : (
                  column("amount", "Amount")
                )}
                {column("reference", "Reference (optional)")}
                {column(
                  "account",
                  "Account number column (optional)",
                  "For files with several accounts in them. Only the last 4 digits are kept.",
                )}
                {filtering ? (
                  <Field
                    label="Which of the file's accounts is this?"
                    htmlFor="statement-file-account"
                    className="sm:col-span-2"
                    error={fingerprint ? undefined : "Choose one to bring in only its rows."}
                  >
                    <Combobox
                      id="statement-file-account"
                      value={fingerprint}
                      onChange={setFingerprint}
                      options={fileAccounts.map((a) => ({
                        value: a.fingerprint,
                        label: `${a.hint} · ${a.rows.toLocaleString(locale)} rows`,
                      }))}
                      placeholder="Choose the account…"
                      invalid={!fingerprint}
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}

            {read ? (
              <div className="fade-in-0 grid min-w-0 animate-in grid-cols-[minmax(0,1fr)] gap-3">
                <p className="text-sm">
                  <span className="font-medium">
                    {read.lines.length.toLocaleString(locale)}{" "}
                    {read.lines.length === 1 ? "transaction" : "transactions"}
                  </span>
                  {read.firstDate && read.lastDate ? (
                    <span className="text-muted-foreground">
                      {" "}
                      from {formatDate(read.firstDate, locale)} to{" "}
                      {formatDate(read.lastDate, locale)}
                    </span>
                  ) : null}
                  {read.otherAccounts ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {read.otherAccounts.toLocaleString(locale)} rows for other accounts left out
                    </span>
                  ) : null}
                </p>
                {read.lines.length ? (
                  <ul className="divide-y rounded-xl border text-sm">
                    {read.lines.slice(0, 5).map((l) => (
                      <li key={l.externalId} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="tabular w-24 shrink-0 text-muted-foreground text-xs">
                          {formatDate(l.date, locale)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{l.description}</span>
                        <span
                          className={cn(
                            "tabular shrink-0 font-medium",
                            !l.amount.startsWith("-") && "text-success",
                          )}
                        >
                          {l.amount.startsWith("-") ? "−" : "+"}
                          {formatMoney(l.amount.replace("-", ""), l.currency, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {read.problems.length ? (
                  <Alert>
                    {read.problems.length} {read.problems.length === 1 ? "row" : "rows"} can't be
                    read and will be left out (line{" "}
                    {read.problems
                      .slice(0, 5)
                      .map((p) => p.lineNumber)
                      .join(", ")}
                    {read.problems.length > 5 ? "…" : ""}). {read.problems[0]?.message}
                  </Alert>
                ) : null}
              </div>
            ) : file && account ? (
              <p className="text-muted-foreground text-sm">
                Match the date, description and amount columns to see the transactions.
              </p>
            ) : null}

            {error ? <Alert variant="destructive">{error}</Alert> : null}
          </div>
        )}

        {step !== "uploading" ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={upload} disabled={!read?.lines.length}>
              <Upload />
              {read?.lines.length
                ? `Bring in ${read.lines.length.toLocaleString(locale)} ${read.lines.length === 1 ? "transaction" : "transactions"}`
                : "Bring in transactions"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
