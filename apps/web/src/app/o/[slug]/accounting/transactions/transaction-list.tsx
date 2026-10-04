"use client";

import { formatMoney } from "@bookalyze/core";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Check,
  FileCheck2,
  FileX2,
  Lock,
  Search,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { setReviewedAction } from "./actions";
import { type DialogState, TransactionDialog } from "./transaction-dialog";
import type { TxFormContext, TxRow } from "./types";

type Filters = { account: string; contact: string; kind: string; status: string; q: string };

function useFilterNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<Filters>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };
  return { set, pending };
}

/** Filters, the transaction list and the add/edit dialog. */
export function TransactionList({
  rows,
  filters,
  ctx,
  hasAny,
}: {
  rows: TxRow[];
  filters: Filters;
  ctx: TxFormContext;
  hasAny: boolean;
}) {
  const [dialog, setDialogState] = useState<DialogState>(null);
  // A fresh dialog per opening, so one can open while the previous one is still animating out.
  const [dialogKey, setDialogKey] = useState(0);
  const setDialog = (next: DialogState) => {
    if (next) setDialogKey((k) => k + 1);
    setDialogState(next);
  };
  const { set, pending } = useFilterNavigation();
  const [search, setSearch] = useState(filters.q);
  const [, startTransition] = useTransition();
  const [optimisticRows, setOptimistic] = useOptimistic(
    rows,
    (current, change: { id: string; reviewed: boolean }) =>
      current.map((r) => (r.id === change.id ? { ...r, reviewed: change.reviewed } : r)),
  );

  // Debounced search.
  useEffect(() => {
    if (search === filters.q) return;
    const t = setTimeout(() => set({ q: search }), 350);
    return () => clearTimeout(t);
  });

  const filterAccount = filters.account || null;
  const contactNames = new Map(ctx.contacts.map((c) => [c.id, c.name]));
  const filterContact = filters.contact ? contactNames.get(filters.contact) : undefined;
  const name = (id?: string) => (id ? (ctx.accountNames[id] ?? "Unknown account") : "—");

  function toggleReviewed(row: TxRow) {
    startTransition(async () => {
      setOptimistic({ id: row.id, reviewed: !row.reviewed });
      const result = await setReviewedAction(ctx.slug, row.id, !row.reviewed);
      if (!result.ok) toast.error(result.message);
    });
  }

  const addButtons = (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() =>
          setDialog({ mode: "create", kind: "deposit", moneyAccountId: filterAccount ?? undefined })
        }
      >
        <ArrowDownLeft />
        Add income
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          setDialog({
            mode: "create",
            kind: "withdrawal",
            moneyAccountId: filterAccount ?? undefined,
          })
        }
      >
        <ArrowUpRight />
        Add expense
      </Button>
      <Button variant="ghost" onClick={() => setDialog({ mode: "create", kind: "transfer" })}>
        <ArrowRightLeft />
        Transfer
      </Button>
    </div>
  );

  return (
    <div className="grid gap-5">
      {addButtons}

      {filterContact ? (
        <div className="fade-in-0 flex animate-in items-center gap-2 text-sm">
          <span className="text-muted-foreground">Showing transactions with</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 ps-3 pe-1 font-medium text-primary">
            {filterContact}
            <button
              type="button"
              onClick={() => set({ contact: "" })}
              aria-label={`Stop filtering by ${filterContact}`}
              className="flex size-5 items-center justify-center rounded-full hover:bg-primary/15"
            >
              <X className="size-3.5" />
            </button>
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <Combobox
          aria-label="Account"
          value={filters.account}
          onChange={(v) => set({ account: v })}
          options={[
            { value: "", label: "All accounts" },
            ...ctx.moneyAccounts.map((a) => ({
              value: a.id,
              label: a.label,
              keywords: a.currency,
            })),
          ]}
          searchPlaceholder="Search accounts"
        />
        <Combobox
          aria-label="Type"
          value={filters.kind}
          onChange={(v) => set({ kind: v })}
          options={[
            { value: "", label: "Money in and out" },
            { value: "deposit", label: "Money in" },
            { value: "withdrawal", label: "Money out" },
            { value: "transfer", label: "Transfers" },
          ]}
        />
        <Combobox
          aria-label="Status"
          value={filters.status}
          onChange={(v) => set({ status: v })}
          options={[
            { value: "", label: "Reviewed or not" },
            { value: "unreviewed", label: "Needs review" },
            { value: "reviewed", label: "Reviewed" },
          ]}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search descriptions"
            placeholder="Search descriptions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9"
          />
          {pending ? (
            <Spinner className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          ) : null}
        </div>
      </div>

      {optimisticRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <p className="font-medium">
            {hasAny ? "No transactions match these filters." : "No transactions yet."}
          </p>
          <p className="mt-1 text-muted-foreground text-sm">
            {hasAny
              ? "Try another account, type or search."
              : "Add money that came in or went out, and it'll appear here. Bank imports will add them automatically later."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[6.5rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem_5.75rem] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
            <span>Date</span>
            <span>Description</span>
            <span>Account</span>
            <span>Category</span>
            <span className="text-end">Amount</span>
            <span className="text-end">Status</span>
          </div>
          <ul className="divide-y">
            {optimisticRows.map((row, i) => {
              // Direction relative to the filtered account (transfers are in or out depending on it).
              const direction =
                row.kind === "transfer"
                  ? filterAccount === row.toAccountId
                    ? "in"
                    : filterAccount === row.fromAccountId
                      ? "out"
                      : "move"
                  : row.kind === "deposit"
                    ? "in"
                    : "out";
              const category =
                row.kind === "transfer"
                  ? `${name(row.fromAccountId)} → ${name(row.toAccountId)}`
                  : row.splits.length > 1
                    ? `Split (${row.splits.length})`
                    : name(row.splits[0]?.accountId);
              const contactName = row.contactId ? contactNames.get(row.contactId) : undefined;
              // Between currencies, show each side in its own currency: what arrived when viewing the
              // receiving account, what left when viewing the sending one, both otherwise.
              const sent = formatMoney(row.amount, row.currency, ctx.locale);
              const got =
                row.receivedAmount && row.receivedCurrency
                  ? formatMoney(row.receivedAmount, row.receivedCurrency, ctx.locale)
                  : null;
              const money = got && direction === "in" ? got : sent;
              const arrived = got && direction === "move" ? got : null;
              return (
                <li
                  key={row.id}
                  className="fade-in-0 flex animate-in items-center gap-3 fill-mode-both px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5 md:grid md:grid-cols-[6.5rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem_5.75rem] md:gap-4"
                  style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => setDialog({ mode: "edit", row })}
                    className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-start md:col-span-5 md:grid-cols-subgrid md:items-center md:gap-4"
                  >
                    <span className="tabular col-start-1 row-start-2 text-muted-foreground text-xs md:row-start-auto md:text-foreground md:text-sm">
                      {formatDate(row.date, ctx.locale)}
                    </span>
                    <span className="col-start-1 row-start-1 min-w-0 truncate font-medium text-sm md:col-start-auto md:row-start-auto">
                      {row.memo || category}
                    </span>
                    <span className="hidden truncate text-muted-foreground text-sm md:block">
                      {row.kind === "transfer" ? "—" : name(row.moneyAccountIds[0])}
                    </span>
                    <span className="col-start-1 row-start-3 truncate text-muted-foreground text-xs md:col-start-auto md:row-start-auto md:text-sm">
                      {contactName ? `${category} · ${contactName}` : category}
                    </span>
                    <span
                      className={cn(
                        "tabular col-start-2 row-span-3 row-start-1 self-center whitespace-nowrap text-end font-medium text-sm md:col-start-auto md:row-span-1 md:row-start-auto",
                        direction === "in" && "text-success",
                        direction === "move" && "text-muted-foreground",
                      )}
                    >
                      {direction === "in" ? "+" : direction === "out" ? "−" : ""}
                      {money}
                      {arrived ? (
                        <span className="block font-normal text-muted-foreground text-xs">
                          → {arrived}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDialog({ mode: "edit", row })}
                      title={
                        row.attachments
                          ? `${row.attachments} ${row.attachments === 1 ? "receipt or file" : "receipts or files"} attached`
                          : "No receipt yet"
                      }
                      className={cn(
                        "relative flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted",
                        row.attachments ? "text-primary" : "text-muted-foreground/35",
                      )}
                    >
                      {row.attachments ? (
                        <FileCheck2 className="size-4" />
                      ) : (
                        <FileX2 className="size-4" />
                      )}
                      {row.attachments > 1 ? (
                        <span className="tabular absolute -end-0.5 -top-0.5 rounded-full bg-primary px-1 font-semibold text-[9px] text-primary-foreground leading-3.5">
                          {row.attachments}
                        </span>
                      ) : null}
                      <span className="sr-only">
                        {row.attachments
                          ? `${row.attachments} ${row.attachments === 1 ? "file" : "files"} attached`
                          : "No receipt"}
                      </span>
                    </button>
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center",
                        row.reconciledThrough ? "text-primary" : "invisible",
                      )}
                      title={
                        row.reconciledThrough
                          ? `Reconciled to the statement of ${formatDate(row.reconciledThrough, ctx.locale)}`
                          : undefined
                      }
                    >
                      {row.reconciledThrough ? (
                        <>
                          <Lock className="size-3.5" />
                          <span className="sr-only">
                            Reconciled to the statement of{" "}
                            {formatDate(row.reconciledThrough, ctx.locale)}
                          </span>
                        </>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleReviewed(row)}
                      aria-pressed={row.reviewed}
                      aria-label={
                        row.reviewed
                          ? `Mark ${row.number} as not reviewed`
                          : `Mark ${row.number} as reviewed`
                      }
                      title={row.reviewed ? "Reviewed" : "Mark as reviewed"}
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full border transition-all duration-200",
                        row.reviewed
                          ? "border-success bg-success text-white"
                          : "text-transparent hover:border-success/60 hover:text-success/60",
                      )}
                    >
                      <Check
                        className={cn(
                          "size-4 transition-transform",
                          row.reviewed && "zoom-in-50 animate-in",
                        )}
                        strokeWidth={2.5}
                      />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <TransactionDialog key={dialogKey} state={dialog} onClose={() => setDialog(null)} ctx={ctx} />
    </div>
  );
}
