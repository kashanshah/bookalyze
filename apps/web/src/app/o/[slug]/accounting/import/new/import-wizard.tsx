"use client";

import {
  ACCOUNT_SUBTYPES,
  type AccountType,
  accountTypes,
  type ColumnMapping,
  type CsvTable,
  contactListRole,
  type DateOrder,
  detectDateOrder,
  formatMoney,
  getAccountSubtype,
  guessColumns,
  IMPORT_FIELDS,
  IMPORT_SOURCES,
  type ImportAccountDraft,
  type ImportContactDetails,
  type ImportOptions,
  type ImportPlan,
  importSource,
  mergeContacts,
  planImport,
  readContactList,
  readCsvTable,
} from "@bookalyze/core";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Upload,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  existingEntriesAction,
  finishImportAction,
  importChunkAction,
  startImportAction,
} from "../actions";

export type ExistingAccount = {
  id: string;
  name: string;
  code: string | null;
  subtype: string;
  isArchived: boolean;
};

type Props = {
  slug: string;
  baseCurrency: string;
  locale: string;
  lockedThrough: string | null;
  accounts: ExistingAccount[];
};

type Step = "source" | "columns" | "accounts" | "review" | "importing" | "done";

const STEPS: { key: Step; label: string }[] = [
  { key: "source", label: "File" },
  { key: "columns", label: "Columns" },
  { key: "accounts", label: "Accounts" },
  { key: "review", label: "Review" },
];

/** Accounts there's only one of: an import's own goes into ours rather than beside it. */
const SINGLE_SUBTYPES = new Set([
  "accounts_receivable",
  "accounts_payable",
  "retained_earnings",
  "uncategorized_income",
  "uncategorized_expense",
  "fx_gain",
  "fx_loss",
]);

const CHUNK = 200;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Where each account from the file goes: "existing:<id>", "new:<subtype>", or "" (undecided). */
function defaultDecision(draft: ImportAccountDraft, accounts: ExistingAccount[]): string {
  const live = accounts.filter((a) => !a.isArchived);
  const byCode = draft.code ? live.find((a) => a.code === draft.code) : undefined;
  const byName = live.find((a) => a.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
  const single =
    draft.subtype && SINGLE_SUBTYPES.has(draft.subtype)
      ? live.find((a) => a.subtype === draft.subtype)
      : undefined;
  const match = byCode ?? byName ?? single;
  if (match) return `existing:${match.id}`;
  return draft.subtype ? `new:${draft.subtype}` : "";
}

export function ImportWizard({ slug, baseCurrency, locale, lockedThrough, accounts }: Props) {
  const [step, setStep] = useState<Step>("source");
  const [sourceKey, setSourceKey] = useState("wave");
  const [file, setFile] = useState<{ name: string; table: CsvTable } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>("mdy");
  const [dateAmbiguous, setDateAmbiguous] = useState(false);
  const [amountSign, setAmountSign] = useState<ImportOptions["amountSign"]>("debit_positive");
  const [groupBy, setGroupBy] = useState<ImportOptions["groupBy"]>("id");
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [overlap, setOverlap] = useState<number | null>(null);
  const [contactLists, setContactLists] = useState<
    { fileName: string; contacts: ImportContactDetails[] }[]
  >([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{
    entries: number;
    skipped: number;
    failed: { externalId: string; message: string }[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const run = useRef<{
    batchId: string;
    accountIds: Record<string, string>;
    contactIds: Record<string, string>;
    /** Index of the first entry not saved yet. */
    next: number;
    failed: { externalId: string; message: string }[];
  } | null>(null);
  const source = importSource(sourceKey);

  const columnsReady =
    mapping.date !== undefined &&
    mapping.account !== undefined &&
    (mapping.amount !== undefined || (mapping.debit !== undefined && mapping.credit !== undefined));

  const plan: ImportPlan | null = useMemo(() => {
    if (!file || !columnsReady) return null;
    return planImport(file.table, source, {
      mapping,
      dateOrder,
      amountSign,
      groupBy: mapping.entryRef !== undefined ? groupBy : "balance",
    });
  }, [file, source, mapping, dateOrder, amountSign, groupBy, columnsReady]);

  // Contacts named in transactions, with details from any customer and vendor lists added.
  const contacts = useMemo(
    () =>
      mergeContacts(
        plan?.contacts ?? [],
        contactLists.flatMap((l) => l.contacts),
      ),
    [plan, contactLists],
  );

  async function addContactLists(files: FileList | null) {
    const added: { fileName: string; contacts: ImportContactDetails[] }[] = [];
    for (const f of Array.from(files ?? [])) {
      const table = readCsvTable(await f.text());
      const listed = readContactList(table, contactListRole(f.name, table.headers));
      if (!listed.length) {
        toast.error(`${f.name} doesn't look like a customer or vendor list.`);
        continue;
      }
      added.push({ fileName: f.name, contacts: listed });
    }
    setContactLists((current) => [
      ...current.filter((c) => !added.some((a) => a.fileName === c.fileName)),
      ...added,
    ]);
  }

  function loadTable(name: string, table: CsvTable) {
    const guessed = guessColumns(table.headers, source);
    const dates = detectDateOrder(
      guessed.date === undefined
        ? []
        : table.rows.slice(0, 2000).map((r) => r[guessed.date as number] ?? ""),
    );
    setFile({ name, table });
    setMapping(guessed);
    setDateOrder(dates.order);
    setDateAmbiguous(dates.ambiguous);
    setGroupBy(source.uniqueIds ? "id" : "balance");
    setStep("columns");
  }

  function goToAccounts() {
    if (!plan) return;
    // Keep choices already made; decide the rest.
    setDecisions((current) =>
      Object.fromEntries(
        plan.accounts.map((a) => [a.key, current[a.key] ?? defaultDecision(a, accounts)]),
      ),
    );
    setStep("accounts");
  }

  async function goToReview() {
    setStep("review");
    setOverlap(null);
    if (plan?.firstDate && plan.lastDate) {
      setOverlap(await existingEntriesAction(slug, plan.firstDate, plan.lastDate));
    }
  }

  async function runImport() {
    if (!plan || !file) return;
    setStep("importing");
    setImportError(null);
    setProgress({ done: 0, total: plan.entries.length });
    const newAccounts = plan.accounts
      .filter((a) => decisions[a.key]?.startsWith("new:"))
      .map((a) => ({
        key: a.key,
        name: a.name,
        ...(a.code ? { code: a.code } : {}),
        subtype: (decisions[a.key] as string).slice(4),
      }));
    const started = await startImportAction(slug, {
      source: source.key,
      fileName: file.name,
      accounts: newAccounts,
      contacts,
    }).catch(() => null);
    if (!started?.ok) {
      toast.error(
        started?.message ?? "The import couldn't start. Check your connection and try again.",
      );
      setStep("review");
      return;
    }
    run.current = {
      batchId: started.batchId,
      accountIds: started.accountIds,
      contactIds: started.contactIds,
      next: 0,
      failed: [],
    };
    await postEntries();
  }

  /**
   * Posts the plan's entries from where the run got to. A batch that fails stops the import with
   * a "Try again" (entries already saved are skipped on the server), instead of finishing it with
   * only part of the history in the books.
   */
  async function postEntries() {
    const current = run.current;
    if (!plan || !current) return;
    setImportError(null);
    const accountId = (key: string) => {
      const decision = decisions[key] ?? "";
      return decision.startsWith("existing:") ? decision.slice(9) : current.accountIds[key];
    };
    for (let i = current.next; i < plan.entries.length; i += CHUNK) {
      const chunk = plan.entries.slice(i, i + CHUNK).map((e) => {
        const contactId = e.contactKey ? current.contactIds[e.contactKey] : undefined;
        return {
          externalId: e.externalId,
          date: e.date,
          ...(e.memo ? { memo: e.memo.slice(0, 1000) } : {}),
          ...(e.reference ? { reference: e.reference.slice(0, 120) } : {}),
          ...(contactId ? { contactId } : {}),
          lines: e.lines.map((l) => ({
            accountId: accountId(l.accountKey) as string,
            amount: l.amount,
            ...(l.description ? { description: l.description.slice(0, 500) } : {}),
          })),
        };
      });
      const response = await importChunkAction(slug, current.batchId, chunk).catch(() => null);
      if (!response?.ok) {
        setImportError(
          response?.message ??
            "The connection dropped or the server took too long while saving this part.",
        );
        return;
      }
      current.failed.push(...response.failed);
      current.next = i + CHUNK;
      setProgress({ done: Math.min(i + CHUNK, plan.entries.length), total: plan.entries.length });
    }
    const finished = await finishImportAction(slug, current.batchId).catch(() => null);
    if (!finished?.ok) {
      setImportError(
        finished?.message ?? "Everything was saved, but the import couldn't be closed.",
      );
      return;
    }
    setResult({ entries: finished.entries, skipped: finished.skipped, failed: current.failed });
    setStep("done");
    toast.success(
      `${finished.entries.toLocaleString(locale)} ${finished.entries === 1 ? "transaction" : "transactions"} imported`,
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="grid gap-6">
      {step !== "importing" && step !== "done" ? (
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border font-medium text-xs transition-colors",
                  i < stepIndex && "border-primary bg-primary text-primary-foreground",
                  i === stepIndex && "border-primary text-primary",
                  i > stepIndex && "text-muted-foreground",
                )}
              >
                {i < stepIndex ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn(i === stepIndex ? "font-medium" : "text-muted-foreground")}>
                {s.label}
              </span>
              {i < STEPS.length - 1 ? <span className="mx-1 h-px w-6 bg-border" /> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {step === "source" ? (
        <SourceStep sourceKey={sourceKey} onSource={setSourceKey} onFile={loadTable} />
      ) : null}

      {step === "columns" && file ? (
        <section className="fade-in-0 grid animate-in gap-6">
          <Card
            title="Match the columns"
            description={`We read ${file.table.rows.length.toLocaleString(locale)} rows from ${file.name} and matched what we could. Check each one.`}
          >
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((field) => (
                <ColumnField
                  key={field.key}
                  field={field}
                  table={file.table}
                  value={mapping[field.key]}
                  onChange={(index) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (index === undefined) delete next[field.key];
                      else next[field.key] = index;
                      return next;
                    })
                  }
                />
              ))}
            </div>
          </Card>
          <Card title="How the file is written">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Dates are written"
                htmlFor="date-order"
                hint={
                  dateAmbiguous
                    ? "We couldn't tell from the file. Check a date in the preview below."
                    : "Worked out from the file."
                }
              >
                <Combobox
                  id="date-order"
                  value={dateOrder}
                  onChange={(v) => setDateOrder(v as DateOrder)}
                  options={[
                    { value: "mdy", label: "Month first (01/31/2024)" },
                    { value: "dmy", label: "Day first (31/01/2024)" },
                    { value: "ymd", label: "Year first (2024-01-31)" },
                  ]}
                />
              </Field>
              {mapping.amount !== undefined ? (
                <Field
                  label="In the Amount column"
                  htmlFor="amount-sign"
                  hint="Most programs show debits as positive. If totals look reversed, switch this."
                >
                  <Combobox
                    id="amount-sign"
                    value={amountSign}
                    onChange={(v) => setAmountSign(v as ImportOptions["amountSign"])}
                    options={[
                      { value: "debit_positive", label: "Positive amounts are debits" },
                      { value: "credit_positive", label: "Positive amounts are credits" },
                    ]}
                  />
                </Field>
              ) : null}
              {mapping.entryRef !== undefined ? (
                <Field
                  label="Group rows into transactions"
                  htmlFor="group-by"
                  hint="Use running totals when IDs repeat for different transactions."
                >
                  <Combobox
                    id="group-by"
                    value={groupBy}
                    onChange={(v) => setGroupBy(v as ImportOptions["groupBy"])}
                    options={[
                      { value: "id", label: "By transaction ID" },
                      { value: "balance", label: "By running total (rows in order)" },
                    ]}
                  />
                </Field>
              ) : null}
            </div>
          </Card>
          {plan ? <PlanPreview plan={plan} locale={locale} currency={baseCurrency} /> : null}
          <Nav
            back={() => setStep("source")}
            next={goToAccounts}
            nextLabel="Next: accounts"
            disabled={!plan || plan.entries.length === 0}
            hint={
              !columnsReady
                ? "Choose the Date, Account and amount columns (Debit and Credit, or Amount)."
                : plan && plan.entries.length === 0
                  ? "No complete transactions found yet. Check the columns."
                  : undefined
            }
          />
        </section>
      ) : null}

      {step === "accounts" && plan ? (
        <AccountsStep
          plan={plan}
          accounts={accounts}
          decisions={decisions}
          onDecide={(key, value) => setDecisions((d) => ({ ...d, [key]: value }))}
          onBack={() => setStep("columns")}
          onNext={goToReview}
          currency={baseCurrency}
          locale={locale}
        />
      ) : null}

      {step === "review" && plan && file ? (
        <ReviewStep
          plan={plan}
          contactCount={contacts.length}
          contactLists={contactLists}
          onAddContactLists={addContactLists}
          onRemoveContactList={(fileName) =>
            setContactLists((current) => current.filter((c) => c.fileName !== fileName))
          }
          decisions={decisions}
          fileName={file.name}
          sourceLabel={source.label}
          locale={locale}
          currency={baseCurrency}
          lockedThrough={lockedThrough}
          overlap={overlap}
          onBack={() => setStep("accounts")}
          onImport={runImport}
        />
      ) : null}

      {step === "importing" ? (
        <Card
          title={importError ? "The import paused" : "Importing…"}
          description={
            importError
              ? "Nothing is lost: what's saved stays, and trying again carries on from here without adding anything twice."
              : "Keep this page open. Big histories take a minute."
          }
        >
          <div className="grid gap-2">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label="Import progress"
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
            {importError ? (
              <div className="fade-in-0 mt-2 grid animate-in gap-3">
                <Alert variant="destructive">{importError}</Alert>
                <div>
                  <Button onClick={postEntries}>Try again</Button>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {step === "done" && result && plan ? (
        <section className="fade-in-0 zoom-in-95 grid animate-in gap-5 rounded-2xl border bg-card p-6 text-center shadow-xs">
          <CheckCircle2 className="mx-auto size-12 text-success" />
          <div>
            <h2 className="font-semibold text-xl tracking-tight">
              {result.entries.toLocaleString(locale)}{" "}
              {result.entries === 1 ? "transaction" : "transactions"} imported
            </h2>
            <p className="mx-auto mt-1 max-w-lg text-muted-foreground text-sm">
              {result.skipped
                ? `${result.skipped.toLocaleString(locale)} were already in your books and were left alone. `
                : ""}
              Compare your trial balance with the one from {source.label} for the same date. They
              should match to the cent.
            </p>
          </div>
          {result.failed.length ? (
            <Alert variant="destructive" className="text-start">
              {result.failed.length} transactions couldn't be imported:{" "}
              {result.failed
                .slice(0, 5)
                .map((f) => `${f.externalId.replace(/^[^:]+:/, "")} (${f.message})`)
                .join("; ")}
              {result.failed.length > 5 ? "…" : ""}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link
                href={`/o/${slug}/accounting/reports/trial-balance${plan.lastDate ? `?date=${plan.lastDate}` : ""}`}
              >
                Check the trial balance
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/o/${slug}/accounting/import`}>Back to imports</Link>
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-5 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <div>
        <h2 className="font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Nav({
  back,
  next,
  nextLabel,
  disabled,
  hint,
}: {
  back: () => void;
  next: () => void;
  nextLabel: string;
  disabled?: boolean;
  hint?: string | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button type="button" variant="ghost" onClick={back}>
        <ArrowLeft className="rtl:rotate-180" />
        Back
      </Button>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {hint ? <span className="text-muted-foreground text-sm">{hint}</span> : null}
        <Button type="button" onClick={next} disabled={disabled}>
          {nextLabel}
          <ArrowRight className="rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}

function SourceStep({
  sourceKey,
  onSource,
  onFile,
}: {
  sourceKey: string;
  onSource: (key: string) => void;
  onFile: (name: string, table: CsvTable) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = importSource(sourceKey);

  async function read(files: FileList | null) {
    const picked = files?.[0];
    if (!picked) return;
    setError(null);
    if (/\.(xlsx?|numbers|ods)$/i.test(picked.name)) {
      setError("That's a spreadsheet file. Open it and save it as CSV, then add the CSV here.");
      return;
    }
    if (picked.size > MAX_FILE_BYTES) {
      setError("That file is over 50 MB. Export a few years at a time instead.");
      return;
    }
    setReading(true);
    try {
      const table = readCsvTable(await picked.text());
      if (table.headers.filter(Boolean).length < 3 || table.rows.length === 0) {
        setError("We couldn't find rows in that file. Is it a CSV export of transactions?");
        return;
      }
      onFile(picked.name, table);
    } finally {
      setReading(false);
    }
  }

  return (
    <section className="fade-in-0 grid animate-in gap-6">
      <Card title="Where are you moving from?">
        <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {IMPORT_SOURCES.map((s) => (
            <label
              key={s.key}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3 shadow-xs transition-all duration-150 hover:border-primary/40 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
                s.key === sourceKey && "border-primary bg-primary/[0.03] ring-1 ring-primary",
              )}
            >
              <input
                type="radio"
                name="source"
                value={s.key}
                checked={s.key === sourceKey}
                onChange={() => onSource(s.key)}
                className="sr-only"
              />
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted font-semibold text-muted-foreground text-sm",
                  s.key === sourceKey && "bg-primary/10 text-primary",
                )}
              >
                {s.key === "other" ? <FileSpreadsheet className="size-4" /> : s.label.slice(0, 1)}
              </span>
              <span className="font-medium text-sm">{s.label}</span>
            </label>
          ))}
        </div>
        <div className="grid gap-2 rounded-xl bg-muted/50 p-4">
          <p className="font-medium text-sm">How to export from {source.label}</p>
          <ol className="grid list-decimal gap-1 ps-5 text-muted-foreground text-sm">
            {source.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      </Card>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          read(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-card px-6 py-12 text-center transition-colors hover:border-primary/40 hover:bg-primary/[0.02]",
          dragging && "border-primary bg-primary/[0.04]",
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {reading ? <Spinner /> : <Upload className="size-6" />}
        </span>
        <span className="font-medium">Add your {source.label} CSV file</span>
        <span className="max-w-sm text-muted-foreground text-sm">
          Drop it here or click to choose. It's read in your browser first, so you can check
          everything before anything is saved.
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".csv,.txt,text/csv"
        className="hidden"
        aria-label="CSV file to import"
        onChange={(e) => {
          read(e.target.files);
          e.target.value = "";
        }}
      />
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </section>
  );
}

function ColumnField({
  field,
  table,
  value,
  onChange,
}: {
  field: (typeof IMPORT_FIELDS)[number];
  table: CsvTable;
  value: number | undefined;
  onChange: (index: number | undefined) => void;
}) {
  const options: ComboboxOption[] = useMemo(
    () => [
      { value: "", label: "Not in this file" },
      ...table.headers.map((h, i) => {
        const sample = table.rows.find((r) => r[i])?.[i];
        return {
          value: String(i),
          label: h || `Column ${i + 1}`,
          ...(sample ? { description: `e.g. ${sample.slice(0, 40)}` } : {}),
        };
      }),
    ],
    [table],
  );
  const id = `col-${field.key}`;
  const required = "required" in field && field.required;
  return (
    <Field
      label={required ? field.label : `${field.label} (optional)`}
      htmlFor={id}
      hint={"hint" in field ? field.hint : undefined}
    >
      <Combobox
        id={id}
        value={value === undefined ? "" : String(value)}
        onChange={(v) => onChange(v === "" ? undefined : Number(v))}
        options={options}
        searchPlaceholder="Search columns"
        invalid={required && value === undefined}
      />
    </Field>
  );
}

function PlanPreview({
  plan,
  locale,
  currency,
}: {
  plan: ImportPlan;
  locale: string;
  currency: string;
}) {
  const sample = plan.entries.slice(0, 3);
  return (
    <Card
      title="Preview"
      description={
        plan.entries.length
          ? `${plan.entries.length.toLocaleString(locale)} ${plan.entries.length === 1 ? "transaction" : "transactions"} from ${formatDate(plan.firstDate as string, locale)} to ${formatDate(plan.lastDate as string, locale)}${plan.problems.length ? `, and ${plan.problems.length.toLocaleString(locale)} to look at` : ""}.`
          : "No complete transactions yet."
      }
    >
      <div className="grid gap-3 lg:grid-cols-3">
        {sample.map((e) => (
          <div
            key={e.externalId}
            className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border p-3 text-sm"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium">{e.memo || "No description"}</span>
              <span className="tabular shrink-0 text-muted-foreground text-xs">
                {formatDate(e.date, locale)}
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-1">
              {e.lines.map((l, i) => {
                const account = plan.accounts.find((a) => a.key === l.accountKey);
                const debit = !l.amount.startsWith("-");
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity of their own
                  <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className={cn("truncate", !debit && "ps-4")}>{account?.name}</span>
                    <span className="tabular shrink-0">
                      {debit ? "Dr " : "Cr "}
                      {formatMoney(l.amount.replace("-", ""), currency, locale)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

const SAMPLE_LINES = 5;

function AccountsStep({
  plan,
  accounts,
  decisions,
  onDecide,
  onBack,
  onNext,
  currency,
  locale,
}: {
  plan: ImportPlan;
  accounts: ExistingAccount[];
  decisions: Record<string, string>;
  onDecide: (key: string, value: string) => void;
  onBack: () => void;
  onNext: () => void;
  currency: string;
  locale: string;
}) {
  const [onlyUndecided, setOnlyUndecided] = useState(false);
  // Accounts that still need a choice show their transactions straight away.
  const [expanded, setExpanded] = useState(
    () => new Set(plan.accounts.filter((a) => !decisions[a.key]).map((a) => a.key)),
  );
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // A few of each account's transactions from the file: what it is, and what's on the other side.
  const samples = useMemo(() => {
    const names = new Map(plan.accounts.map((a) => [a.key, a.name]));
    const byAccount = new Map<
      string,
      { date: string; text: string; amount: string; others: string[]; id: string }[]
    >();
    for (const entry of plan.entries) {
      for (const line of entry.lines) {
        const list = byAccount.get(line.accountKey) ?? [];
        if (list.length >= SAMPLE_LINES) continue;
        list.push({
          id: `${entry.externalId}:${list.length}`,
          date: entry.date,
          text: line.description || entry.memo || "No description",
          amount: line.amount,
          others: [
            ...new Set(
              entry.lines
                .filter((l) => l.accountKey !== line.accountKey)
                .map((l) => names.get(l.accountKey) ?? ""),
            ),
          ].filter(Boolean),
        });
        byAccount.set(line.accountKey, list);
      }
    }
    return byAccount;
  }, [plan]);
  const options: ComboboxOption[] = useMemo(
    () => [
      ...accounts
        .filter((a) => !a.isArchived)
        .map((a) => ({
          value: `existing:${a.id}`,
          label: a.code ? `${a.code} · ${a.name}` : a.name,
          group: "Your accounts",
          keywords: getAccountSubtype(a.subtype)?.label,
        })),
      ...ACCOUNT_SUBTYPES.map((s) => ({
        value: `new:${s.key}`,
        label: `New account: ${s.label}`,
        group: `New ${accountTypes[s.type as AccountType].label.toLowerCase()} account`,
      })),
    ],
    [accounts],
  );
  const undecided = plan.accounts.filter((a) => !decisions[a.key]).length;
  const matched = plan.accounts.filter((a) => decisions[a.key]?.startsWith("existing:")).length;
  const created = plan.accounts.filter((a) => decisions[a.key]?.startsWith("new:")).length;
  // Once every account has a place, the filter would show nothing: show them all again.
  const filtering = onlyUndecided && undecided > 0;
  const shown = filtering ? plan.accounts.filter((a) => !decisions[a.key]) : plan.accounts;

  return (
    <section className="fade-in-0 grid animate-in gap-6">
      <Card
        title="Where each account goes"
        description={`${plan.accounts.length} accounts in the file: ${matched} match accounts you have, ${created} will be added${undecided ? `, and ${undecided} need you to choose` : ""}.`}
      >
        {undecided ? (
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={onlyUndecided}
              onChange={() => setOnlyUndecided((v) => !v)}
              label="Only show accounts that need a choice"
            />
            <button
              type="button"
              onClick={() => setOnlyUndecided((v) => !v)}
              className="text-start"
              tabIndex={-1}
            >
              Only show accounts that need a choice
            </button>
          </div>
        ) : null}
        <ul className="divide-y rounded-xl border">
          {shown.map((a) => (
            <li
              key={a.key}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center sm:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">
                  {a.code ? (
                    <span className="me-1.5 font-mono text-muted-foreground text-xs">{a.code}</span>
                  ) : null}
                  {a.name}
                </p>
                <p className="truncate text-muted-foreground text-xs">
                  {a.sourceType ? `${a.sourceType} · ` : ""}
                  {a.lineCount.toLocaleString()} {a.lineCount === 1 ? "line" : "lines"}
                </p>
              </div>
              <Combobox
                aria-label={`Where ${a.name} goes`}
                value={decisions[a.key] ?? ""}
                onChange={(v) => onDecide(a.key, v)}
                options={options}
                placeholder="Choose where this goes…"
                searchPlaceholder="Search your accounts or account types"
                invalid={!decisions[a.key]}
              />
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => toggle(a.key)}
                  aria-expanded={expanded.has(a.key)}
                  className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
                >
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      expanded.has(a.key) && "rotate-180",
                    )}
                  />
                  {expanded.has(a.key) ? "Hide transactions" : "Show transactions"}
                </button>
                {expanded.has(a.key) ? (
                  <ul className="fade-in-0 mt-2 animate-in divide-y rounded-lg border bg-muted/20 text-xs">
                    {(samples.get(a.key) ?? []).map((t) => (
                      <li
                        key={t.id}
                        className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-3 py-1.5"
                      >
                        <span className="tabular text-muted-foreground">
                          {formatDate(t.date, locale)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{t.text}</span>
                          {t.others.length ? (
                            <span className="block truncate text-muted-foreground">
                              {t.amount.startsWith("-") ? "To" : "From"} {t.others.join(", ")}
                            </span>
                          ) : null}
                        </span>
                        <span className="tabular whitespace-nowrap text-end">
                          <span className="text-muted-foreground">
                            {t.amount.startsWith("-") ? "Cr" : "Dr"}{" "}
                          </span>
                          {formatMoney(t.amount.replace("-", ""), currency, locale)}
                        </span>
                      </li>
                    ))}
                    {a.lineCount > SAMPLE_LINES ? (
                      <li className="px-3 py-1.5 text-muted-foreground">
                        and {(a.lineCount - SAMPLE_LINES).toLocaleString(locale)} more
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Nav
        back={onBack}
        next={onNext}
        nextLabel="Next: review"
        disabled={undecided > 0}
        hint={
          undecided
            ? `Choose where ${undecided} more ${undecided === 1 ? "account goes" : "accounts go"}.`
            : undefined
        }
      />
    </section>
  );
}

function ReviewStep({
  plan,
  contactCount,
  contactLists,
  onAddContactLists,
  onRemoveContactList,
  decisions,
  fileName,
  sourceLabel,
  locale,
  currency,
  lockedThrough,
  overlap,
  onBack,
  onImport,
}: {
  plan: ImportPlan;
  contactCount: number;
  contactLists: { fileName: string; contacts: ImportContactDetails[] }[];
  onAddContactLists: (files: FileList | null) => void;
  onRemoveContactList: (fileName: string) => void;
  decisions: Record<string, string>;
  fileName: string;
  sourceLabel: string;
  locale: string;
  currency: string;
  lockedThrough: string | null;
  overlap: number | null;
  onBack: () => void;
  onImport: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const listInput = useRef<HTMLInputElement>(null);
  const closed = lockedThrough ? plan.entries.filter((e) => e.date <= lockedThrough).length : 0;
  const newAccounts = plan.accounts.filter((a) => decisions[a.key]?.startsWith("new:")).length;
  const stats: [string, string][] = [
    ["Transactions", plan.entries.length.toLocaleString(locale)],
    [
      "Dates",
      plan.firstDate && plan.lastDate
        ? `${formatDate(plan.firstDate, locale)} – ${formatDate(plan.lastDate, locale)}`
        : "—",
    ],
    ["New accounts", newAccounts.toLocaleString(locale)],
    ["Customers and vendors", contactCount.toLocaleString(locale)],
  ];
  return (
    <section className="fade-in-0 grid animate-in gap-6">
      <Card
        title="Ready to import"
        description={`From ${sourceLabel} (${fileName}), in ${currency}. Already-imported transactions are skipped, so running the same file again is safe. You can undo the whole import from the Import page.`}
      >
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(([label, value]) => (
            <div
              key={label}
              className={cn(
                "rounded-xl bg-muted/50 p-3",
                label === "Dates" && "col-span-2 lg:col-span-1",
              )}
            >
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="tabular mt-0.5 font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card
        title="Customer and vendor lists (optional)"
        description="Add the customer and vendor files from your old software to bring their emails, phones and addresses too. Bank account numbers in them are left out."
      >
        {contactLists.length ? (
          <ul className="grid gap-2">
            {contactLists.map((l) => (
              <li
                key={l.fileName}
                className="fade-in-0 flex animate-in items-center gap-3 rounded-xl border px-3 py-2 text-sm"
              >
                <Users className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{l.fileName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {l.contacts.length.toLocaleString(locale)}{" "}
                    {l.contacts[0]?.role === "customer"
                      ? "customers"
                      : l.contacts[0]?.role === "vendor"
                        ? "vendors"
                        : "contacts"}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${l.fileName}`}
                  onClick={() => onRemoveContactList(l.fileName)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          <Button type="button" variant="outline" onClick={() => listInput.current?.click()}>
            <Upload />
            Add customer or vendor lists
          </Button>
          <input
            ref={listInput}
            type="file"
            multiple
            accept=".csv,.txt,text/csv"
            className="hidden"
            aria-label="Customer or vendor lists"
            onChange={(e) => {
              onAddContactLists(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </Card>

      {closed ? (
        <Alert variant="destructive">
          {closed.toLocaleString(locale)} transactions are dated on or before{" "}
          {formatDate(lockedThrough as string, locale, "long")}, when your books are closed. Reopen
          that period in Settings, then import.
        </Alert>
      ) : null}
      {overlap ? (
        <Alert>
          <AlertTriangle className="me-1.5 inline size-4 align-[-3px]" />
          Your books already have {overlap.toLocaleString(locale)} entries in these dates. If
          they're the same transactions entered by hand, they'll be counted twice.
        </Alert>
      ) : null}
      {plan.problems.length ? (
        <Card
          title={`${plan.problems.length.toLocaleString(locale)} ${plan.problems.length === 1 ? "transaction" : "transactions"} will be left out`}
          description="Fix these in the file and import it again later; what's imported now is skipped then."
        >
          <ul className="grid max-h-72 gap-1.5 overflow-y-auto text-sm">
            {plan.problems.slice(0, 200).map((p) => (
              <li key={p.lineNumbers.join(",")} className="flex gap-3">
                <Badge variant="warning" className="shrink-0">
                  {p.lineNumbers.length === 1
                    ? `Line ${p.lineNumbers[0]}`
                    : `Lines ${p.lineNumbers[0]}–${p.lineNumbers.at(-1)}`}
                </Badge>
                <span className="text-muted-foreground">{p.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft className="rtl:rotate-180" />
          Back
        </Button>
        <Button
          type="button"
          disabled={closed > 0 || starting || plan.entries.length === 0}
          onClick={() => {
            setStarting(true);
            onImport();
          }}
        >
          {starting ? <Spinner /> : null}
          Import {plan.entries.length.toLocaleString(locale)}{" "}
          {plan.entries.length === 1 ? "transaction" : "transactions"}
        </Button>
      </div>
    </section>
  );
}
