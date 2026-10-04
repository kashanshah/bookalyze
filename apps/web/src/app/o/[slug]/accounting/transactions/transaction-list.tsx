"use client";

import { formatMoney } from "@bookalyze/core";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Check, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { setReviewedAction } from "./actions";
import { type DialogState, TransactionDialog } from "./transaction-dialog";
import type { TxFormContext, TxRow } from "./types";

type Filters = { account: string; kind: string; status: string; q: string };

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <NativeSelect
          aria-label="Account"
          value={filters.account}
          onChange={(e) => set({ account: e.target.value })}
        >
          <option value="">All accounts</option>
          {ctx.moneyAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Type"
          value={filters.kind}
          onChange={(e) => set({ kind: e.target.value })}
        >
          <option value="">Money in and out</option>
          <option value="deposit">Money in</option>
          <option value="withdrawal">Money out</option>
          <option value="transfer">Transfers</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Status"
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
        >
          <option value="">Reviewed or not</option>
          <option value="unreviewed">Needs review</option>
          <option value="reviewed">Reviewed</option>
        </NativeSelect>
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
          <div className="hidden grid-cols-[2.25rem_6.5rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
            <span>
              <span className="sr-only">Reviewed</span>
            </span>
            <span>Date</span>
            <span>Description</span>
            <span>Account</span>
            <span>Category</span>
            <span className="text-end">Amount</span>
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
              const money = formatMoney(row.amount, row.currency, ctx.locale);
              return (
                <li
                  key={row.id}
                  className="fade-in-0 flex animate-in items-center gap-3 fill-mode-both px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5 md:grid md:grid-cols-[2.25rem_6.5rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem] md:gap-4"
                  style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                >
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
                  <button
                    type="button"
                    onClick={() => setDialog({ mode: "edit", row })}
                    className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 text-start md:col-span-5 md:grid-cols-subgrid md:items-center md:gap-4"
                  >
                    <span className="tabular col-start-1 row-start-2 text-muted-foreground text-xs md:row-start-auto md:text-foreground md:text-sm">
                      {formatDate(row.date, ctx.locale)}
                    </span>
                    <span className="col-start-1 row-start-1 truncate font-medium text-sm md:col-start-auto md:row-start-auto">
                      {row.memo || category}
                    </span>
                    <span className="hidden truncate text-muted-foreground text-sm md:block">
                      {row.kind === "transfer" ? "—" : name(row.moneyAccountIds[0])}
                    </span>
                    <span className="col-start-1 row-start-3 truncate text-muted-foreground text-xs md:col-start-auto md:row-start-auto md:text-sm">
                      {category}
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
                    </span>
                  </button>
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
