"use client";

import { formatMoney } from "@bookalyze/core";
import {
  ArrowRightLeft,
  Check,
  Copy,
  Ellipsis,
  ExternalLink,
  FileCheck2,
  FileX2,
  Lock,
  Pencil,
  Trash2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CategoryPicker, type NewCategory } from "@/components/accounting/category-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate, nextDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { saveTransactionAction } from "./actions";
import { InlineInput, inlineTrigger, isWide, StaticCell } from "./inline-cell";
import { type RowPatch, rowInput, toInput } from "./row-input";
import type { TxFormContext, TxRow } from "./types";

/** Columns of the list on wide screens, shared with its heading row. */
export const ROW_GRID =
  "lg:grid-cols-[1.25rem_8rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_9rem_7.75rem]";

export function TransactionRow({
  row,
  index,
  ctx,
  filterAccount,
  contactName,
  picked,
  onTogglePicked,
  onEdit,
  onRemove,
  onToggleReviewed,
  onReviewDuplicate,
  onReviewTransfer,
  onCategoryCreated,
}: {
  row: TxRow;
  index: number;
  ctx: TxFormContext;
  filterAccount: string | null;
  contactName?: string;
  picked: boolean;
  onTogglePicked: () => void;
  /** Opens the full transaction; `row` may carry a change that needs more than the list shows. */
  onEdit: (row: TxRow) => void;
  onRemove: () => void;
  onToggleReviewed: () => void;
  onReviewDuplicate: () => void;
  onReviewTransfer: () => void;
  onCategoryCreated: (category: NewCategory) => void;
}) {
  // What was just changed on the list, shown until the saved transaction replaces this row.
  const [draft, setDraft] = useState<RowPatch | null>(null);
  const [saving, startSaving] = useTransition();
  const name = (id?: string) => (id ? (ctx.accountNames[id] ?? "Unknown account") : "—");
  const open = () => onEdit(row);

  const locked = ctx.lockedThrough;
  const readOnly = Boolean(row.reconciledThrough) || Boolean(locked && row.date <= locked);
  // A transaction without its bank or card account has to get one before anything else changes.
  const editable = !readOnly && !row.needsAccount && !saving;
  const single = row.kind !== "transfer" && row.splits.length === 1;
  const crossCurrency = Boolean(row.receivedCurrency && row.receivedCurrency !== row.currency);

  function save(patch: RowPatch) {
    setDraft(patch);
    startSaving(async () => {
      const result = await saveTransactionAction(ctx.slug, rowInput(row, ctx.baseCurrency, patch));
      if (result.ok) {
        toast.success("Transaction updated");
        return;
      }
      setDraft(null);
      toast.error(
        result.message ?? Object.values(result.errors ?? {})[0] ?? "That change couldn't be saved.",
      );
    });
  }

  const date = draft?.date ?? row.date;
  const memo = draft?.memo ?? row.memo ?? "";
  const amount = draft?.amount ?? row.amount;
  const moneyAccountId =
    draft?.moneyAccountId ?? (row.needsAccount ? "" : (row.moneyAccountIds[0] ?? ""));
  const categoryId = draft?.categoryId ?? row.splits[0]?.accountId ?? "";

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
        : name(categoryId);
  // Between currencies, show each side in its own currency: what arrived when viewing the
  // receiving account, what left when viewing the sending one, both otherwise.
  const sent = formatMoney(amount, row.currency, ctx.locale);
  const got =
    row.receivedAmount && row.receivedCurrency
      ? formatMoney(row.receivedAmount, row.receivedCurrency, ctx.locale)
      : null;
  const money = got && direction === "in" ? got : sent;
  const arrived = got && direction === "move" ? got : null;
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  const amountText = (
    <span
      className={cn(
        "tabular whitespace-nowrap font-medium",
        direction === "in" && "text-success",
        direction === "move" && "text-muted-foreground",
      )}
    >
      {sign}
      {money}
    </span>
  );
  const dateText = <span className="tabular">{formatDate(date, ctx.locale)}</span>;
  const dateTone = "text-muted-foreground text-xs lg:text-foreground lg:text-sm";
  const mutedCell = "text-muted-foreground text-xs lg:text-sm";
  // Phones show the category when there's no description; wide screens invite one.
  const description = (
    <>
      {memo ? (
        <span className="font-medium">{memo}</span>
      ) : (
        <>
          <span className="font-medium lg:hidden">{category}</span>
          <span className="hidden text-muted-foreground lg:inline">
            {editable ? "Add a description" : "No description"}
          </span>
        </>
      )}
      {contactName ? <span className="text-muted-foreground"> · {contactName}</span> : null}
    </>
  );
  const ruleMark = row.rule ? (
    <Wand2
      className="me-1 inline size-3.5 shrink-0 align-[-2px] text-primary"
      aria-label={`Categorized by your rule “${row.rule}”`}
    >
      <title>Categorized by your rule “{row.rule}”</title>
    </Wand2>
  ) : null;
  const openLabel = readOnly ? "Open this transaction" : "Open to change";

  function chooseAccount(id: string) {
    if (id === moneyAccountId) return;
    const account = ctx.moneyAccounts.find((a) => a.id === id);
    if (!account) return;
    // Another currency needs an exchange rate, so finish the change in the full form.
    if (account.currency !== row.currency) {
      onEdit({
        ...row,
        moneyAccountIds: [id],
        needsAccount: undefined,
        currency: account.currency,
        fxRate: "",
      });
      return;
    }
    save({ moneyAccountId: id });
  }

  return (
    <li
      className={cn(
        "group/row fade-in-0 flex animate-in flex-wrap items-center gap-3 fill-mode-both px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5 lg:grid lg:gap-4 lg:py-2",
        ROW_GRID,
        (row.duplicate || row.needsAccount) && "bg-warning/[0.06] hover:bg-warning/10",
        picked && "bg-primary/5 hover:bg-primary/[0.07]",
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 20}ms` }}
      aria-busy={saving || undefined}
    >
      <Checkbox checked={picked} onChange={onTogglePicked} label={`Select ${row.number}`} />

      {/*
        One set of values for every width: a card on phones, columns from `lg` up. Wide screens
        change each value in place; narrower ones open the transaction from any of them.
      */}
      <div
        className={cn(
          "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 lg:col-span-5 lg:grid-cols-subgrid lg:gap-4",
          saving && "opacity-60",
        )}
        onClickCapture={(e) => {
          if (isWide()) return;
          e.preventDefault();
          e.stopPropagation();
          open();
        }}
      >
        <div className="col-start-1 row-start-2 min-w-0 lg:col-start-auto lg:row-start-auto lg:-mx-2">
          {editable ? (
            <InlineInput
              type="date"
              label="Date"
              value={date}
              min={locked ? nextDay(locked) : undefined}
              display={dateText}
              className={dateTone}
              onCommit={(next) => {
                if (next) save({ date: next });
              }}
            />
          ) : (
            <StaticCell onClick={open} label={openLabel} className={dateTone}>
              {dateText}
            </StaticCell>
          )}
        </div>
        <div className="col-start-1 row-start-1 min-w-0 lg:col-start-auto lg:row-start-auto lg:-mx-2">
          {editable ? (
            <InlineInput
              label="Description"
              value={memo}
              maxLength={500}
              placeholder="What was it for?"
              display={description}
              className="text-sm"
              onCommit={(next) => save({ memo: next })}
            />
          ) : (
            <StaticCell onClick={open} label={openLabel} className="text-sm">
              {description}
            </StaticCell>
          )}
        </div>
        <div
          className={cn(
            "min-w-0 lg:col-start-auto lg:row-start-auto lg:-mx-2 lg:block",
            row.needsAccount ? "col-start-1 row-start-4" : "hidden",
          )}
        >
          {row.kind === "transfer" ? (
            <StaticCell onClick={open} label={openLabel} className={mutedCell}>
              —
            </StaticCell>
          ) : readOnly || saving ? (
            <StaticCell onClick={open} label={openLabel} className={mutedCell}>
              {name(moneyAccountId)}
            </StaticCell>
          ) : (
            <Combobox
              aria-label="Bank, card or cash account"
              value={moneyAccountId}
              onChange={chooseAccount}
              placeholder="Choose account"
              searchPlaceholder="Search accounts"
              options={ctx.moneyAccounts.map((a) => ({
                value: a.id,
                label: a.currency !== ctx.baseCurrency ? `${a.label} (${a.currency})` : a.label,
                keywords: a.currency,
              }))}
              className={cn(
                inlineTrigger,
                "text-muted-foreground hover:text-foreground",
                row.needsAccount &&
                  "font-medium text-warning hover:text-warning lg:border-warning/50 lg:[&>svg]:opacity-100",
              )}
            />
          )}
        </div>
        <div
          className={cn(
            "col-start-1 row-start-3 flex min-w-0 items-center lg:col-start-auto lg:row-start-auto lg:-mx-2",
            ruleMark && "lg:ps-2",
          )}
        >
          {ruleMark}
          {editable && single ? (
            <CategoryPicker
              slug={ctx.slug}
              groups={ctx.categories}
              value={categoryId}
              direction={row.kind === "deposit" ? "in" : "out"}
              aria-label="Category"
              onChange={(id) => {
                if (id !== categoryId) save({ categoryId: id });
              }}
              onCreated={onCategoryCreated}
              wrapperClassName="min-w-0 flex-1"
              className={cn(inlineTrigger, "text-muted-foreground hover:text-foreground")}
            />
          ) : (
            <StaticCell onClick={open} label={openLabel} className={mutedCell}>
              {category}
            </StaticCell>
          )}
        </div>
        <div className="col-start-2 row-span-3 row-start-1 min-w-0 self-center lg:col-start-auto lg:row-span-1 lg:row-start-auto lg:-mx-2">
          {editable && (single || (row.kind === "transfer" && !crossCurrency)) ? (
            <InlineInput
              label="Amount"
              inputMode="decimal"
              align="end"
              value={toInput(amount)}
              display={amountText}
              className="text-sm"
              onCommit={(next) => {
                if (next) save({ amount: next.replace(/,/g, "") });
              }}
            />
          ) : (
            <StaticCell onClick={open} label={openLabel} align="end" className="text-sm">
              {amountText}
              {arrived ? (
                <span className="block font-normal text-muted-foreground text-xs">→ {arrived}</span>
              ) : null}
            </StaticCell>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={open}
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
          {row.attachments ? <FileCheck2 className="size-4" /> : <FileX2 className="size-4" />}
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
                Reconciled to the statement of {formatDate(row.reconciledThrough, ctx.locale)}
              </span>
            </>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onToggleReviewed}
          aria-pressed={row.reviewed}
          aria-label={
            row.reviewed ? `Mark ${row.number} as not reviewed` : `Mark ${row.number} as reviewed`
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
            className={cn("size-4 transition-transform", row.reviewed && "zoom-in-50 animate-in")}
            strokeWidth={2.5}
          />
        </button>
        <RowMenu row={row} ctx={ctx} readOnly={readOnly} onEdit={open} onRemove={onRemove} />
      </div>

      {row.transfer ? (
        <button
          type="button"
          onClick={onReviewTransfer}
          className="flex w-full min-w-0 basis-full items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-start text-sm transition-colors hover:bg-primary/15 lg:col-span-full lg:col-start-2"
        >
          <ArrowRightLeft className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">
              Possible transfer {row.transfer.outId === row.id ? "to" : "from"}{" "}
              {name(row.transfer.other.accountId)}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · {row.transfer.other.number}, {formatDate(row.transfer.other.date, ctx.locale)}
            </span>
          </span>
          <span className="shrink-0 font-medium text-primary">Review</span>
        </button>
      ) : null}
      {row.duplicate ? (
        <button
          type="button"
          onClick={onReviewDuplicate}
          className="flex w-full min-w-0 basis-full items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-start text-sm transition-colors hover:bg-warning/25 lg:col-span-full lg:col-start-2"
        >
          <Copy className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">Possible duplicate</span>
            <span className="text-muted-foreground">
              {" "}
              of {row.duplicate.of.number}
              {row.duplicate.of.memo ? ` · ${row.duplicate.of.memo}` : ""}
            </span>
          </span>
          <span className="shrink-0 font-medium text-primary">Review</span>
        </button>
      ) : null}
    </li>
  );
}

/** The "…" menu at the end of a row: everything that needs more than the row itself. */
function RowMenu({
  row,
  ctx,
  readOnly,
  onEdit,
  onRemove,
}: {
  row: TxRow;
  ctx: TxFormContext;
  readOnly: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const ruleCategory =
    ctx.canMakeRules && row.kind !== "transfer" && row.splits.length === 1
      ? row.splits[0]?.accountId
      : undefined;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={`More for ${row.number}`}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:bg-muted data-[state=open]:text-foreground"
      >
        <Ellipsis className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          {readOnly ? "View details" : "Edit details"}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/o/${ctx.slug}/accounting/journal/${row.id}`}>
            <ExternalLink />
            Journal entry {row.number}
          </Link>
        </DropdownMenuItem>
        {ruleCategory ? (
          <DropdownMenuItem asChild>
            <Link
              href={`/o/${ctx.slug}/banking/rules?${new URLSearchParams({
                text: (row.memo ?? "").slice(0, 60),
                category: ruleCategory,
              })}`}
            >
              <Wand2 />
              Make a rule
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={readOnly}
          onSelect={onRemove}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:text-destructive"
        >
          <Trash2 />
          Remove
        </DropdownMenuItem>
        {readOnly ? (
          <DropdownMenuLabel className="max-w-56 font-normal">
            {row.reconciledThrough
              ? "Reconciled, so it can't be changed until that reconciliation is undone."
              : "In a closed period, so it can't be changed."}
          </DropdownMenuLabel>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
