"use client";

import {
  type AccountType,
  formatDecimal,
  formatMoney,
  naturalAmount,
  parseDecimal,
} from "@bookalyze/core";
import type { ReconcileLine } from "@bookalyze/db";
import { Check, Pencil, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  cancelReconciliationAction,
  completeReconciliationAction,
  setClearedAction,
  updateStatementAction,
} from "../actions";

type Filter = "all" | "open" | "cleared";

/** Ticking transactions off a statement until the cleared balance matches it. */
export function ReconcileScreen({
  slug,
  type,
  isCard,
  currency,
  locale,
  reconciliation,
  opening,
  lines,
}: {
  slug: string;
  accountId: string;
  type: AccountType;
  isCard: boolean;
  currency: string;
  locale: string;
  reconciliation: { id: string; statementDate: string; statementBalance: string };
  /** Balance cleared by earlier reconciliations, as the statement shows it. */
  opening: string;
  lines: ReconcileLine[];
}) {
  const router = useRouter();
  const [cleared, setCleared] = useState(
    () => new Set(lines.filter((l) => l.cleared).map((l) => l.lineId)),
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pending, startTransition] = useTransition();
  const money = (v: string) => formatMoney(v, currency, locale);

  // Keep ticks in step with the server after a refresh (e.g. the statement date moved).
  useEffect(() => {
    setCleared(new Set(lines.filter((l) => l.cleared).map((l) => l.lineId)));
  }, [lines]);
  useEffect(() => {
    if (!confirmCancel) return;
    const t = setTimeout(() => setConfirmCancel(false), 4000);
    return () => clearTimeout(t);
  }, [confirmCancel]);

  const natural = useMemo(
    () => new Map(lines.map((l) => [l.lineId, parseDecimal(naturalAmount(type, l.amount))])),
    [lines, type],
  );
  const change = [...cleared].reduce((sum, id) => sum + (natural.get(id) ?? 0n), 0n);
  const clearedBalance = parseDecimal(opening) + change;
  const difference = parseDecimal(reconciliation.statementBalance) - clearedBalance;
  const balanced = difference === 0n;

  const query = search.trim().toLowerCase();
  const shown = lines.filter((l) => {
    if (filter === "open" && cleared.has(l.lineId)) return false;
    if (filter === "cleared" && !cleared.has(l.lineId)) return false;
    if (!query) return true;
    return [l.memo, l.description, l.contactName, l.amount.replace(/^-/, "")]
      .filter(Boolean)
      .some((t) => (t as string).toLowerCase().includes(query));
  });
  const allShownTicked = shown.length > 0 && shown.every((l) => cleared.has(l.lineId));

  function setTicks(ids: string[], tick: boolean) {
    if (!ids.length) return;
    const before = new Set(cleared);
    setCleared((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (tick) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    startTransition(async () => {
      const result = await setClearedAction(slug, reconciliation.id, ids, tick);
      if (!result.ok) {
        setCleared(before);
        toast.error(result.message ?? "Couldn't save that. Try again.");
      }
    });
  }

  function finish() {
    startTransition(async () => {
      const result = await completeReconciliationAction(slug, reconciliation.id);
      if (result.ok) {
        toast.success("Reconciled", {
          description: `Your books agree with the statement of ${formatDate(reconciliation.statementDate, locale, "long")}.`,
        });
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong");
    });
  }

  function cancel() {
    if (!confirmCancel) return setConfirmCancel(true);
    startTransition(async () => {
      const result = await cancelReconciliationAction(slug, reconciliation.id);
      if (result.ok) {
        toast.success("Reconciliation cancelled");
        router.refresh();
      } else toast.error(result.message ?? "Something went wrong");
    });
  }

  const [inLabel, outLabel] = isCard ? ["Charges", "Payments"] : ["Money in", "Money out"];

  return (
    <div className="grid gap-5 pb-36 sm:pb-28">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        {editing ? (
          <StatementForm
            slug={slug}
            reconciliation={reconciliation}
            currency={currency}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
          />
        ) : (
          <>
            <div>
              <p className="text-muted-foreground text-sm">
                Statement of {formatDate(reconciliation.statementDate, locale, "long")}
              </p>
              <p className="tabular font-semibold text-xl tracking-tight">
                {money(reconciliation.statementBalance)}
                <span className="ms-2 font-normal text-muted-foreground text-sm">
                  ending balance
                </span>
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              Edit statement
            </Button>
          </>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search transactions"
            placeholder="Search descriptions or amounts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9"
          />
        </div>
        <Combobox
          aria-label="Show"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: "all", label: `All transactions (${lines.length})` },
            { value: "open", label: `Not ticked (${lines.length - cleared.size})` },
            { value: "cleared", label: `Ticked (${cleared.size})` },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider sm:px-5 md:grid md:grid-cols-[2rem_6.5rem_minmax(0,1fr)_8.5rem_8.5rem] md:gap-4">
          <TickBox
            checked={allShownTicked}
            label={allShownTicked ? "Untick all shown" : "Tick all shown"}
            onChange={() =>
              setTicks(
                shown.map((l) => l.lineId),
                !allShownTicked,
              )
            }
          />
          <span className="hidden md:block">Date</span>
          <span className="flex-1 md:flex-none">Description</span>
          <span className="hidden text-end md:block">{inLabel}</span>
          <span className="hidden text-end md:block">{outLabel}</span>
        </div>
        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-muted-foreground text-sm">
            {lines.length === 0
              ? "No transactions up to this statement date that still need reconciling."
              : "Nothing matches."}
          </p>
        ) : (
          <ul className="divide-y">
            {shown.map((l) => {
              const n = natural.get(l.lineId) ?? 0n;
              const amount = money(formatDecimal(n < 0n ? -n : n));
              const ticked = cleared.has(l.lineId);
              const text = l.memo || l.description || l.contactName || "No description";
              return (
                <li
                  key={l.lineId}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 transition-colors sm:px-5 md:grid md:grid-cols-[2rem_6.5rem_minmax(0,1fr)_8.5rem_8.5rem] md:gap-4",
                    ticked && "bg-success/[0.04]",
                  )}
                >
                  <TickBox
                    checked={ticked}
                    label={`${ticked ? "Untick" : "Tick"} ${text}, ${amount}`}
                    onChange={() => setTicks([l.lineId], !ticked)}
                  />
                  <span className="tabular hidden text-sm md:block">
                    {formatDate(l.date, locale)}
                  </span>
                  <span className="min-w-0 flex-1 md:flex-none">
                    <span className="block truncate text-sm">{text}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      <span className="md:hidden">{formatDate(l.date, locale)} · </span>
                      {[
                        l.contactName && l.contactName !== text ? l.contactName : null,
                        `JE-${String(l.entryNumber).padStart(4, "0")}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "tabular shrink-0 text-end font-medium text-sm md:block",
                      n > 0n ? "text-success md:text-foreground" : "hidden",
                    )}
                  >
                    <span className="md:hidden">+</span>
                    {n > 0n ? amount : ""}
                  </span>
                  <span
                    className={cn(
                      "tabular shrink-0 text-end font-medium text-sm md:block",
                      n < 0n ? "" : "hidden",
                    )}
                  >
                    <span className="md:hidden">−</span>
                    {n < 0n ? amount : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 backdrop-blur-md lg:start-[264px]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-8 lg:px-10">
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">Statement</dt>
              <dd className="tabular font-medium">{money(reconciliation.statementBalance)}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">Cleared</dt>
              <dd className="tabular font-medium">{money(formatDecimal(clearedBalance))}</dd>
            </div>
            <div aria-live="polite">
              {balanced ? (
                <span
                  key="balanced"
                  className="zoom-in-90 inline-flex animate-in items-center gap-1 rounded-full bg-success/12 px-2.5 py-0.5 font-medium text-success text-xs"
                >
                  <Check className="size-3.5" strokeWidth={2.5} />
                  Difference {money("0")}
                </span>
              ) : (
                <span
                  key="off"
                  className="tabular fade-in-0 inline-flex animate-in items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 font-medium text-xs"
                >
                  Difference {money(formatDecimal(difference))}
                </span>
              )}
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={confirmCancel ? "destructive" : "ghost"}
              onClick={cancel}
              disabled={pending}
            >
              <Trash2 />
              {confirmCancel ? "Click again to discard" : "Cancel"}
            </Button>
            <Button type="button" onClick={finish} disabled={!balanced || pending}>
              {pending ? <Spinner /> : <Check />}
              Finish reconciling
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TickBox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors duration-150 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background hover:border-primary/60",
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={onChange}
        aria-label={label}
      />
      {checked ? <Check className="zoom-in-50 size-3.5 animate-in" strokeWidth={3} /> : null}
    </label>
  );
}

function StatementForm({
  slug,
  reconciliation,
  currency,
  onDone,
}: {
  slug: string;
  reconciliation: { id: string; statementDate: string; statementBalance: string };
  currency: string;
  onDone: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid w-full gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await updateStatementAction(slug, reconciliation.id, {
            statementDate: String(data.get("statementDate") ?? ""),
            statementBalance: String(data.get("statementBalance") ?? ""),
          });
          if (result.ok) onDone();
          else {
            setErrors(result.errors ?? {});
            if (result.message) toast.error(result.message);
          }
        });
      }}
    >
      <Field label="Statement closing date" htmlFor="edit-date" error={errors.statementDate}>
        <Input
          id="edit-date"
          name="statementDate"
          type="date"
          required
          defaultValue={reconciliation.statementDate}
        />
      </Field>
      <Field
        label={`Ending balance (${currency})`}
        htmlFor="edit-balance"
        error={errors.statementBalance}
      >
        <Input
          id="edit-balance"
          name="statementBalance"
          inputMode="decimal"
          required
          defaultValue={reconciliation.statementBalance.replace(/(\.\d\d)00$/, "$1")}
          className="tabular text-end"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}
