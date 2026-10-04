"use client";

import {
  accountTypes,
  convertUnits,
  formatDecimal,
  formatMoney,
  journalTotals,
  minorUnits,
  parseDecimal,
} from "@bookalyze/core";
import { Check, Info, Plus, Scale, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, nextDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AccountOption } from "@/server/accounting";
import { type FieldErrors, postJournalEntryAction } from "../../actions";

type Line = { key: number; accountId: string; description: string; debit: string; credit: string };

type Props = {
  slug: string;
  today: string;
  baseCurrency: string;
  locale: string;
  currencies: { code: string; name: string }[];
  accountGroups: { type: keyof typeof accountTypes; options: AccountOption[] }[];
  /** Books are closed through this date; entries must be dated after it. */
  lockedThrough: string | null;
};

let nextKey = 0;
const emptyLine = (): Line => ({
  key: nextKey++,
  accountId: "",
  description: "",
  debit: "",
  credit: "",
});

/** Displays a 4-place decimal as money in `currency`, or a dash for zero. */
function money(value: string, currency: string, locale: string) {
  return formatMoney(value, currency, locale);
}

export function JournalForm({
  slug,
  today,
  baseCurrency,
  locale,
  currencies,
  accountGroups,
  lockedThrough,
}: Props) {
  const router = useRouter();
  const formId = useId();
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [fxRate, setFxRate] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [emptyLine(), emptyLine()]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const foreign = currency !== baseCurrency;
  const inClosedPeriod = Boolean(lockedThrough && date && date <= lockedThrough);
  const totals = useMemo(() => journalTotals(lines), [lines]);
  const difference = parseDecimal(totals.difference);
  const hasAmounts = parseDecimal(totals.debit) > 0n || parseDecimal(totals.credit) > 0n;
  const baseTotal = useMemo(() => {
    if (!foreign || !fxRate) return null;
    try {
      return formatDecimal(
        convertUnits(parseDecimal(totals.debit), fxRate, minorUnits(baseCurrency)),
      );
    } catch {
      return null;
    }
  }, [foreign, fxRate, totals.debit, baseCurrency]);

  function update(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    const index = lines.findIndex((l) => l.key === key);
    if (lineErrors[index]) {
      setLineErrors(({ [index]: _, ...rest }) => rest);
    }
  }

  function remove(key: number) {
    setLines((current) => (current.length > 2 ? current.filter((l) => l.key !== key) : current));
    setLineErrors({});
  }

  /** Puts the difference on the last line in the opposite column, so the entry balances. */
  function balanceLastLine() {
    const units = difference < 0n ? -difference : difference;
    const amount = formatDecimal(units).replace(/\.?0+$/, "");
    setLines((current) => {
      const last = current[current.length - 1];
      const target = last && !last.debit && !last.credit ? last : emptyLine();
      const filled = {
        ...target,
        debit: difference < 0n ? amount : "",
        credit: difference > 0n ? amount : "",
      };
      return target === last ? [...current.slice(0, -1), filled] : [...current, filled];
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    startTransition(async () => {
      const result = await postJournalEntryAction(slug, {
        date,
        reference,
        memo,
        currency,
        fxRate: foreign ? fxRate : undefined,
        lines: lines.map(({ accountId, description, debit, credit }) => ({
          accountId,
          description,
          debit,
          credit,
        })),
      });
      if (result.ok) {
        toast.success(`${result.data.number} posted`);
        router.push(`/o/${slug}/accounting/journal/${result.data.id}`);
        return;
      }
      setErrors(result.errors ?? {});
      setLineErrors(result.lineErrors ?? {});
      setFormError(
        result.message ??
          (result.lineErrors && Object.keys(result.lineErrors).length
            ? "Some lines need attention."
            : result.errors && Object.keys(result.errors).length
              ? "Please fix the highlighted fields."
              : null),
      );
    });
  }

  return (
    <form id={formId} onSubmit={submit} className="grid gap-6 pb-28">
      <fieldset disabled={pending} className="grid gap-6">
        <section className="grid gap-5 rounded-2xl border bg-card p-5 shadow-xs sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          <Field
            label="Date"
            htmlFor="date"
            error={
              errors.date ??
              (inClosedPeriod && lockedThrough
                ? `Books are closed through ${formatDate(lockedThrough, locale)}. Choose a later date.`
                : undefined)
            }
            hint={
              lockedThrough
                ? `Books are closed through ${formatDate(lockedThrough, locale)}.`
                : undefined
            }
          >
            <Input
              id="date"
              type="date"
              required
              value={date}
              min={lockedThrough ? nextDay(lockedThrough) : undefined}
              onChange={(e) => {
                setDate(e.target.value);
                if (errors.date) setErrors(({ date: _, ...rest }) => rest);
              }}
              aria-invalid={Boolean(errors.date) || inClosedPeriod}
            />
          </Field>
          <Field
            label="Reference (optional)"
            htmlFor="reference"
            error={errors.reference}
            hint="A cheque, invoice or receipt number."
          >
            <Input
              id="reference"
              value={reference}
              maxLength={60}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <Field
            label="Currency"
            htmlFor="currency"
            error={errors.currency}
            hint={foreign ? undefined : "The currency the amounts below are in."}
          >
            <NativeSelect
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {foreign ? (
            <Field
              label="Exchange rate"
              htmlFor="fxRate"
              error={errors.fxRate}
              hint={`How many ${baseCurrency} one ${currency} was worth on this date.`}
              className="fade-in-0 slide-in-from-top-1 animate-in duration-200"
            >
              <div className="relative">
                <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  1 {currency} =
                </span>
                <Input
                  id="fxRate"
                  inputMode="decimal"
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  placeholder="1.3650"
                  className="tabular ps-20 pe-14 text-end"
                  aria-invalid={Boolean(errors.fxRate)}
                />
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {baseCurrency}
                </span>
              </div>
            </Field>
          ) : (
            <div className="hidden lg:block" />
          )}
          <Field
            label="Description"
            htmlFor="memo"
            error={errors.memo}
            className="sm:col-span-2 lg:col-span-4"
          >
            <Input
              id="memo"
              value={memo}
              maxLength={500}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="e.g. Opening balances, owner contribution, year-end adjustment"
            />
          </Field>
        </section>

        <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5 sm:px-6">
            <h2 className="font-semibold">Lines</h2>
            <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <Info className="size-3.5" />
              Debits increase assets and expenses. Credits increase income, liabilities and equity.
            </p>
          </div>

          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_8.5rem_8.5rem_2.25rem] gap-3 border-b bg-muted/30 px-6 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
            <span>Account</span>
            <span>Line description</span>
            <span className="text-end">Debit</span>
            <span className="text-end">Credit</span>
            <span />
          </div>

          <ol className="divide-y">
            {lines.map((line, index) => {
              const error = lineErrors[index];
              return (
                <li
                  key={line.key}
                  className={cn(
                    "fade-in-0 slide-in-from-top-1 grid animate-in gap-3 px-5 py-4 duration-200 sm:px-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_8.5rem_8.5rem_2.25rem] md:items-start md:py-3",
                    error && "bg-destructive/[0.03]",
                  )}
                >
                  <div className="grid gap-1">
                    <label htmlFor={`account-${line.key}`} className="sr-only">
                      Account for line {index + 1}
                    </label>
                    <NativeSelect
                      id={`account-${line.key}`}
                      value={line.accountId}
                      onChange={(e) => update(line.key, { accountId: e.target.value })}
                      aria-invalid={Boolean(error)}
                      className={cn(!line.accountId && "text-muted-foreground")}
                    >
                      <option value="">Choose an account…</option>
                      {accountGroups.map((group) => (
                        <optgroup key={group.type} label={accountTypes[group.type].label}>
                          {group.options.map((o) => (
                            <option
                              key={o.id}
                              value={o.id}
                              disabled={Boolean(o.currency && o.currency !== currency)}
                            >
                              {o.label}
                              {o.currency && o.currency !== currency ? ` (${o.currency} only)` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </NativeSelect>
                    {error ? (
                      <p className="fade-in-0 animate-in text-destructive text-xs">{error}</p>
                    ) : null}
                  </div>
                  <div>
                    <label htmlFor={`description-${line.key}`} className="sr-only">
                      Description for line {index + 1}
                    </label>
                    <Input
                      id={`description-${line.key}`}
                      value={line.description}
                      maxLength={200}
                      placeholder="Optional"
                      onChange={(e) => update(line.key, { description: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:contents">
                    <div className="grid gap-1">
                      <label
                        htmlFor={`debit-${line.key}`}
                        className="text-muted-foreground text-xs md:sr-only"
                      >
                        Debit
                      </label>
                      <Input
                        id={`debit-${line.key}`}
                        inputMode="decimal"
                        value={line.debit}
                        placeholder="0.00"
                        className="tabular text-end"
                        onChange={(e) =>
                          update(line.key, {
                            debit: e.target.value,
                            credit: e.target.value ? "" : line.credit,
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <label
                        htmlFor={`credit-${line.key}`}
                        className="text-muted-foreground text-xs md:sr-only"
                      >
                        Credit
                      </label>
                      <Input
                        id={`credit-${line.key}`}
                        inputMode="decimal"
                        value={line.credit}
                        placeholder="0.00"
                        className="tabular text-end"
                        onChange={(e) =>
                          update(line.key, {
                            credit: e.target.value,
                            debit: e.target.value ? "" : line.debit,
                          })
                        }
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={lines.length <= 2}
                    onClick={() => remove(line.key)}
                    aria-label={`Remove line ${index + 1}`}
                    className="justify-self-end text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3 sm:px-6">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((current) => [...current, emptyLine()])}
            >
              <Plus />
              Add line
            </Button>
            {hasAmounts && difference !== 0n ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={balanceLastLine}
                className="fade-in-0 animate-in"
              >
                <Scale />
                Balance with last line
              </Button>
            ) : null}
          </div>
        </section>

        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
      </fieldset>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 backdrop-blur-md lg:start-[264px]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-8 lg:px-10">
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">Debits</dt>
              <dd className="tabular font-medium">{money(totals.debit, currency, locale)}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">Credits</dt>
              <dd className="tabular font-medium">{money(totals.credit, currency, locale)}</dd>
            </div>
            {baseTotal ? (
              <div className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">In {baseCurrency}</dt>
                <dd className="tabular font-medium">{money(baseTotal, baseCurrency, locale)}</dd>
              </div>
            ) : null}
            <div aria-live="polite">
              {totals.balanced ? (
                <span
                  key="balanced"
                  className="zoom-in-90 inline-flex animate-in items-center gap-1 rounded-full bg-success/12 px-2.5 py-0.5 font-medium text-success text-xs"
                >
                  <Check className="size-3.5" strokeWidth={2.5} />
                  Balanced
                </span>
              ) : hasAmounts ? (
                <span
                  key="out"
                  className="fade-in-0 inline-flex animate-in items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 font-medium text-xs"
                >
                  Out by{" "}
                  {money(
                    formatDecimal(difference < 0n ? -difference : difference),
                    currency,
                    locale,
                  )}
                </span>
              ) : null}
            </div>
          </dl>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={pending || !totals.balanced || inClosedPeriod}
            >
              {pending ? <Spinner /> : null}
              Post entry
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
