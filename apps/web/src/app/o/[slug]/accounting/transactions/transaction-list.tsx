"use client";

import { accountTypes, formatMoney } from "@bookalyze/core";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Copy,
  Landmark,
  Lightbulb,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { useCategoryList } from "@/components/accounting/category-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { deleteTransactionAction, setReviewedAction } from "./actions";
import { DuplicateReviewDialog, SelectionBar } from "./duplicate-dialogs";
import { type DialogState, TransactionDialog } from "./transaction-dialog";
import { ROW_GRID, TransactionRow } from "./transaction-row";
import { TransferReviewDialog } from "./transfer-dialogs";
import type { TxFormContext, TxRow } from "./types";

type Filters = {
  account: string;
  category: string;
  contact: string;
  kind: string;
  status: string;
  q: string;
  per: string;
};

export const PER_PAGE = [25, 50, 100] as const;

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
  hasAny,
  duplicateCount,
  needsAccountCount,
  transferCount,
  ruleSuggestionCount,
  footer,
  ctx: pageCtx,
}: {
  rows: TxRow[];
  filters: Filters;
  ctx: TxFormContext;
  hasAny: boolean;
  /** Possible duplicates waiting for a decision, across all pages. */
  duplicateCount: number;
  /** Transactions that never said which bank, card or cash account they went through. */
  needsAccountCount: number;
  /** Suggested transfers waiting for a decision, across all pages. */
  transferCount: number;
  /** Rules worth making, from how transactions were categorized by hand. */
  ruleSuggestionCount: number;
  /** Page count and paging buttons, shown beside the per-page choice. */
  footer?: React.ReactNode;
}) {
  // Categories added from any picker on this screen show in all of them straight away.
  const { groups, added, add: addCategory } = useCategoryList(pageCtx.categories);
  const ctx = useMemo<TxFormContext>(
    () => ({
      ...pageCtx,
      categories: groups,
      accountNames: {
        ...pageCtx.accountNames,
        ...Object.fromEntries(added.map((c) => [c.id, c.name])),
      },
    }),
    [pageCtx, groups, added],
  );
  const [removing, setRemoving] = useState<TxRow | null>(null);
  const [reviewing, setReviewing] = useState<TxRow | null>(null);
  const [transferring, setTransferring] = useState<TxRow | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const togglePicked = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
  const allPicked = optimisticRows.length > 0 && optimisticRows.every((r) => picked.has(r.id));
  const selectAll = (
    <Checkbox
      checked={allPicked}
      onChange={() => setPicked(allPicked ? new Set() : new Set(optimisticRows.map((r) => r.id)))}
      label={allPicked ? "Clear selection" : "Select all on this page"}
    />
  );

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
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
          aria-label="Category"
          value={filters.category}
          onChange={(v) => set({ category: v })}
          options={[
            { value: "", label: "All categories" },
            ...ctx.categories.flatMap((g) =>
              g.options.map((o) => ({
                value: o.id,
                label: o.label,
                group: accountTypes[g.type].label,
              })),
            ),
          ]}
          searchPlaceholder="Search categories"
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
            { value: "duplicates", label: "Possible duplicates" },
            { value: "no_account", label: "Account not chosen" },
            { value: "transfers", label: "Possible transfers" },
          ]}
        />
        <div className="relative sm:col-span-2 lg:col-span-1">
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

      {duplicateCount > 0 && filters.status !== "duplicates" ? (
        <div className="fade-in-0 flex animate-in flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 sm:px-5">
          <Copy className="size-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {duplicateCount === 1
                ? "1 possible duplicate"
                : `${duplicateCount} possible duplicates`}
            </span>
            <span className="text-muted-foreground">
              {" "}
              from your bank. They're highlighted below: open one to merge it or keep both.
            </span>
          </p>
          <Button size="sm" variant="outline" onClick={() => set({ status: "duplicates" })}>
            Show only these
          </Button>
        </div>
      ) : null}

      {ruleSuggestionCount > 0 ? (
        <div className="fade-in-0 flex animate-in flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-xs sm:px-5">
          <Lightbulb className="size-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {ruleSuggestionCount === 1
                ? "1 rule suggested"
                : `${ruleSuggestionCount} rules suggested`}
            </span>
            <span className="text-muted-foreground">
              {" "}
              for payees you keep categorizing the same way.
            </span>
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href={`/o/${ctx.slug}/banking/rules`}>See suggestions</Link>
          </Button>
        </div>
      ) : null}

      {transferCount > 0 && filters.status !== "transfers" ? (
        <div className="fade-in-0 flex animate-in flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 sm:px-5">
          <ArrowRightLeft className="size-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {transferCount === 1 ? "1 possible transfer" : `${transferCount} possible transfers`}
            </span>
            <span className="text-muted-foreground">
              {" "}
              between your accounts. Match them so the money isn't counted as spent and earned.
            </span>
          </p>
          <Button size="sm" variant="outline" onClick={() => set({ status: "transfers" })}>
            Show only these
          </Button>
        </div>
      ) : null}

      {needsAccountCount > 0 && filters.status !== "no_account" ? (
        <div className="fade-in-0 flex animate-in flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 sm:px-5">
          <Landmark className="size-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {needsAccountCount === 1
                ? "1 transaction doesn't say which account paid"
                : `${needsAccountCount} transactions don't say which account paid`}
            </span>
            <span className="text-muted-foreground">
              {" "}
              (usually from an import). Open one and choose the bank or card account.
            </span>
          </p>
          <Button size="sm" variant="outline" onClick={() => set({ status: "no_account" })}>
            Show only these
          </Button>
        </div>
      ) : null}

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
          <div
            className={cn(
              "hidden gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider lg:grid",
              ROW_GRID,
            )}
          >
            {selectAll}
            <span>Date</span>
            <span>Description</span>
            <span>Account</span>
            <span>Category</span>
            <span className="text-end">Amount</span>
            <span className="text-end">Status</span>
          </div>
          <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-2.5 text-muted-foreground text-xs sm:px-5 lg:hidden">
            {selectAll}
            Select all on this page
          </div>
          <ul className="divide-y">
            {optimisticRows.map((row, i) => (
              <TransactionRow
                key={row.id}
                row={row}
                index={i}
                ctx={ctx}
                filterAccount={filterAccount}
                contactName={row.contactId ? contactNames.get(row.contactId) : undefined}
                picked={picked.has(row.id)}
                onTogglePicked={() => togglePicked(row.id)}
                onEdit={(r) => setDialog({ mode: "edit", row: r })}
                onRemove={() => setRemoving(row)}
                onToggleReviewed={() => toggleReviewed(row)}
                onReviewDuplicate={() => setReviewing(row)}
                onReviewTransfer={() => setTransferring(row)}
                onCategoryCreated={addCategory}
              />
            ))}
          </ul>
        </div>
      )}

      {optimisticRows.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Show</span>
            <Combobox
              aria-label="Transactions per page"
              value={filters.per || "50"}
              onChange={(v) => set({ per: v === "50" ? "" : v })}
              options={PER_PAGE.map((n) => ({ value: String(n), label: String(n) }))}
              className="h-8 w-20"
            />
            <span>per page</span>
          </div>
          {footer}
        </div>
      ) : null}

      <DuplicateReviewDialog row={reviewing} ctx={ctx} onClose={() => setReviewing(null)} />
      <TransferReviewDialog row={transferring} ctx={ctx} onClose={() => setTransferring(null)} />
      <SelectionBar
        selected={optimisticRows.filter((r) => picked.has(r.id))}
        ctx={ctx}
        onClear={() => setPicked(new Set())}
      />

      <TransactionDialog
        key={dialogKey}
        state={dialog}
        onClose={() => setDialog(null)}
        ctx={ctx}
        onCategoryCreated={addCategory}
      />
      <RemoveDialog row={removing} ctx={ctx} onClose={() => setRemoving(null)} />
    </div>
  );
}

/** "Remove this transaction?" from a row's menu. It's reversed, so the journal keeps a record. */
function RemoveDialog({
  row,
  ctx,
  onClose,
}: {
  row: TxRow | null;
  ctx: TxFormContext;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const name = (id?: string) => (id ? (ctx.accountNames[id] ?? "Unknown account") : "");

  function remove() {
    if (!row) return;
    startTransition(async () => {
      const result = await deleteTransactionAction(ctx.slug, row.id);
      if (result.ok) {
        toast.success("Transaction removed", {
          description: "It stays in the journal as a reversed entry, for your records.",
        });
        onClose();
      } else toast.error(result.message);
    });
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle>Remove this transaction?</DialogTitle>
              <DialogDescription>
                <span className="font-medium text-foreground">
                  {row.memo || name(row.splits[0]?.accountId) || row.number}
                </span>
                , {formatDate(row.date, ctx.locale, "long")},{" "}
                {formatMoney(row.amount, row.currency, ctx.locale)}. It comes off your reports and
                stays in the journal as a reversed entry, for your records.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
                {pending ? <Spinner /> : <Trash2 />}
                Remove transaction
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
