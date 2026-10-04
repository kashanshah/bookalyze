"use client";

import {
  accountTypes,
  divideDecimals,
  formatDecimal,
  formatMoney,
  parseDecimal,
  type TransactionKind,
} from "@bookalyze/core";
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  ExternalLink,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { RateField } from "@/components/accounting/rate-field";
import { ReceiptsPanel } from "@/components/accounting/receipts-panel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import type { AttachmentSummary } from "@/lib/attachments";
import { formatDate, nextDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { entryAttachmentsAction } from "../receipts/actions";
import { deleteTransactionAction, saveTransactionAction, type TransactionErrors } from "./actions";
import { ContactPicker } from "./contact-picker";
import type { TxFormContext, TxRow } from "./types";

const KINDS: { key: TransactionKind; label: string; icon: typeof ArrowDownLeft }[] = [
  { key: "deposit", label: "Money in", icon: ArrowDownLeft },
  { key: "withdrawal", label: "Money out", icon: ArrowUpRight },
  { key: "transfer", label: "Transfer", icon: ArrowRightLeft },
];

const PLACEHOLDERS: Record<TransactionKind, string> = {
  deposit: "e.g. Amazon payout, client payment",
  withdrawal: "e.g. Office rent, Shopify subscription",
  transfer: "e.g. Pay off credit card",
};

type Split = { key: number; accountId: string; amount: string; description: string };
let nextKey = 0;
const newSplit = (accountId = "", amount = ""): Split => ({
  key: nextKey++,
  accountId,
  amount,
  description: "",
});

/** Trims "125.5000" to "125.50"-style input values. */
function toInput(amount: string): string {
  return amount.replace(/(\.\d\d\d*?)0+$/, "$1").replace(/\.00$/, "");
}

export type DialogState =
  | { mode: "create"; kind: TransactionKind; moneyAccountId?: string }
  | { mode: "edit"; row: TxRow }
  | null;

export function TransactionDialog({
  state,
  onClose,
  ctx,
}: {
  state: DialogState;
  onClose: () => void;
  ctx: TxFormContext;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {state ? (
          <TransactionForm
            key={state.mode === "edit" ? state.row.id : `new-${state.kind}`}
            state={state}
            ctx={ctx}
            onDone={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({
  state,
  ctx,
  onDone,
}: {
  state: NonNullable<DialogState>;
  ctx: TxFormContext;
  onDone: () => void;
}) {
  const row = state.mode === "edit" ? state.row : null;
  const firstMoney = ctx.moneyAccounts[0]?.id ?? "";
  const [kind, setKind] = useState<TransactionKind>(
    row?.kind ?? (state.mode === "create" ? state.kind : "deposit"),
  );
  const [date, setDate] = useState(row?.date ?? ctx.today);
  const [memo, setMemo] = useState(row?.memo ?? "");
  const [contactId, setContactId] = useState(row?.contactId ?? "");
  const [contacts, setContacts] = useState(ctx.contacts);
  const [moneyAccountId, setMoneyAccountId] = useState(
    row?.moneyAccountIds[0] ??
      (state.mode === "create" ? state.moneyAccountId : undefined) ??
      firstMoney,
  );
  const [fromAccountId, setFromAccountId] = useState(row?.fromAccountId ?? firstMoney);
  const [toAccountId, setToAccountId] = useState(
    row?.toAccountId ?? ctx.moneyAccounts.find((a) => a.id !== firstMoney)?.id ?? "",
  );
  const [amount, setAmount] = useState(row && row.kind === "transfer" ? toInput(row.amount) : "");
  const [received, setReceived] = useState(row?.receivedAmount ? toInput(row.receivedAmount) : "");
  const [splits, setSplits] = useState<Split[]>(() =>
    row && row.kind !== "transfer" && row.splits.length
      ? row.splits.map((s) => ({
          ...newSplit(s.accountId, toInput(s.amount)),
          description: s.description ?? "",
        }))
      : [newSplit()],
  );
  const [fxRate, setFxRate] = useState(
    row && row.currency !== ctx.baseCurrency ? row.fxRate.replace(/\.?0+$/, "") : "",
  );
  const [errors, setErrors] = useState<TransactionErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  // Receipts: loaded for an existing transaction; collected and attached on save for a new one.
  const [files, setFiles] = useState<AttachmentSummary[] | null>(row ? null : []);
  useEffect(() => {
    if (!row) return;
    let cancelled = false;
    entryAttachmentsAction(ctx.slug, row.id).then((loaded) => {
      if (!cancelled) setFiles(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [row, ctx.slug]);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const locked = ctx.lockedThrough;
  const rowInClosedPeriod = Boolean(row && locked && row.date <= locked);
  const dateInClosedPeriod = Boolean(locked && date && date <= locked);
  const moneyCurrency = (id: string) =>
    ctx.moneyAccounts.find((a) => a.id === id)?.currency ?? ctx.baseCurrency;
  const currency =
    kind === "transfer" ? moneyCurrency(fromAccountId) : moneyCurrency(moneyAccountId);
  const foreign = currency !== ctx.baseCurrency;
  const toCurrency = moneyCurrency(toAccountId);
  const crossCurrency = kind === "transfer" && Boolean(toAccountId) && currency !== toCurrency;
  // A rate is needed unless one side of a cross-currency transfer is already the main currency.
  const needsRate = crossCurrency
    ? currency !== ctx.baseCurrency && toCurrency !== ctx.baseCurrency
    : foreign;
  const impliedRate = useMemo(() => {
    if (!crossCurrency) return null;
    try {
      const sent = amount.replace(/,/g, "");
      const got = received.replace(/,/g, "");
      if (!sent || !got || parseDecimal(sent) <= 0n) return null;
      return divideDecimals(got, sent, 4).replace(/0+$/, "").replace(/\.$/, "");
    } catch {
      return null;
    }
  }, [crossCurrency, amount, received]);
  const split = splits.length > 1;

  const total = useMemo(() => {
    let units = 0n;
    for (const s of splits) {
      try {
        if (s.amount.trim()) units += parseDecimal(s.amount);
      } catch {
        // Invalid amounts are flagged on save.
      }
    }
    return units;
  }, [splits]);

  function updateSplit(key: number, patch: Partial<Split>) {
    setSplits((current) => current.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function clearError(key: string) {
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  }

  function save() {
    setFormError(null);
    startTransition(async () => {
      const result = await saveTransactionAction(ctx.slug, {
        id: row?.id,
        kind,
        date,
        memo,
        fxRate: needsRate ? fxRate : undefined,
        received: crossCurrency ? received : undefined,
        attachmentIds: row ? undefined : (files ?? []).map((f) => f.id),
        contactId: kind === "transfer" ? "" : contactId,
        moneyAccountId,
        splits: splits.map(({ accountId, amount, description }) => ({
          accountId,
          amount,
          description,
        })),
        fromAccountId,
        toAccountId,
        amount,
      });
      if (result.ok) {
        toast.success(row ? "Transaction updated" : "Transaction added");
        onDone();
        return;
      }
      setErrors(result.errors ?? {});
      setFormError(result.message ?? null);
    });
  }

  function remove() {
    if (!row) return;
    if (!confirmDelete) return setConfirmDelete(true);
    startTransition(async () => {
      const result = await deleteTransactionAction(ctx.slug, row.id);
      if (result.ok) {
        toast.success("Transaction removed", {
          description: "It stays in the journal as a reversed entry, for your records.",
        });
        onDone();
      } else toast.error(result.message);
    });
  }

  const moneyOptions = (exclude?: string) =>
    ctx.moneyAccounts.map((a) => (
      <option key={a.id} value={a.id} disabled={a.id === exclude}>
        {a.label}
        {a.currency !== ctx.baseCurrency ? ` (${a.currency})` : ""}
      </option>
    ));

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{row ? "Edit transaction" : "Add a transaction"}</DialogTitle>
        <DialogDescription>
          {row
            ? `Saving replaces ${row.number} with a corrected entry. The original stays in the journal.`
            : "Record money that came in, went out, or moved between your accounts."}
        </DialogDescription>
      </DialogHeader>

      {rowInClosedPeriod && locked ? (
        <Alert>
          <Lock className="me-1.5 inline size-4 align-[-3px]" />
          This transaction is in a closed period (books are closed through{" "}
          {formatDate(locked, ctx.locale, "long")}), so it can't be changed.
        </Alert>
      ) : null}

      <fieldset disabled={pending || rowInClosedPeriod} className="grid gap-5">
        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted/60 p-1">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kind === k.key}
              onClick={() => {
                setKind(k.key);
                setErrors({});
              }}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 font-medium text-sm transition-all duration-150",
                kind === k.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <k.icon className="size-4" />
              {k.label}
            </button>
          ))}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Date"
            htmlFor="tx-date"
            error={
              errors.date ??
              (dateInClosedPeriod && locked && !rowInClosedPeriod
                ? `Books are closed through ${formatDate(locked, ctx.locale)}. Choose a later date.`
                : undefined)
            }
          >
            <Input
              id="tx-date"
              type="date"
              required
              value={date}
              min={locked ? nextDay(locked) : undefined}
              onChange={(e) => {
                setDate(e.target.value);
                clearError("date");
              }}
            />
          </Field>
          {kind === "transfer" ? null : (
            <Field
              label={kind === "deposit" ? "Deposited into" : "Paid from"}
              htmlFor="tx-money"
              error={errors.moneyAccountId}
            >
              <NativeSelect
                id="tx-money"
                value={moneyAccountId}
                onChange={(e) => {
                  setMoneyAccountId(e.target.value);
                  clearError("moneyAccountId");
                }}
              >
                {moneyOptions()}
              </NativeSelect>
            </Field>
          )}
          {kind === "transfer" ? (
            <>
              <Field label="From" htmlFor="tx-from" error={errors.fromAccountId}>
                <NativeSelect
                  id="tx-from"
                  value={fromAccountId}
                  onChange={(e) => {
                    setFromAccountId(e.target.value);
                    clearError("fromAccountId");
                  }}
                >
                  {moneyOptions(toAccountId)}
                </NativeSelect>
              </Field>
              <Field label="To" htmlFor="tx-to" error={errors.toAccountId}>
                <NativeSelect
                  id="tx-to"
                  value={toAccountId}
                  onChange={(e) => {
                    setToAccountId(e.target.value);
                    clearError("toAccountId");
                  }}
                >
                  <option value="">Choose an account…</option>
                  {moneyOptions(fromAccountId)}
                </NativeSelect>
              </Field>
              <Field
                label={crossCurrency ? `Amount sent (${currency})` : `Amount (${currency})`}
                htmlFor="tx-amount"
                error={errors.amount}
              >
                <Input
                  id="tx-amount"
                  inputMode="decimal"
                  value={amount}
                  placeholder="0.00"
                  className="tabular text-end"
                  onChange={(e) => {
                    setAmount(e.target.value);
                    clearError("amount");
                  }}
                />
              </Field>
              {crossCurrency ? (
                <Field
                  label={`Amount received (${toCurrency})`}
                  htmlFor="tx-received"
                  error={errors.received}
                  hint={
                    impliedRate
                      ? `Your bank's rate: 1 ${currency} = ${impliedRate} ${toCurrency}.`
                      : "Exactly what arrived, after the bank's conversion and fees."
                  }
                  className="fade-in-0 slide-in-from-top-1 animate-in duration-200"
                >
                  <Input
                    id="tx-received"
                    inputMode="decimal"
                    value={received}
                    placeholder="0.00"
                    className="tabular text-end"
                    onChange={(e) => {
                      setReceived(e.target.value);
                      clearError("received");
                    }}
                  />
                </Field>
              ) : null}
            </>
          ) : null}
          <Field
            label="Description"
            htmlFor="tx-memo"
            error={errors.memo}
            className="sm:col-span-2"
          >
            <Input
              id="tx-memo"
              value={memo}
              maxLength={500}
              placeholder={PLACEHOLDERS[kind]}
              onChange={(e) => setMemo(e.target.value)}
            />
          </Field>
          {kind === "transfer" ? null : (
            <div className="sm:col-span-2">
              <ContactPicker
                slug={ctx.slug}
                kind={kind}
                value={contactId}
                onChange={(id) => {
                  setContactId(id);
                  clearError("contactId");
                }}
                contacts={contacts}
                onCreated={(c) =>
                  setContacts((list) => [...list, c].sort((a, b) => a.name.localeCompare(b.name)))
                }
                error={errors.contactId}
              />
            </div>
          )}
        </div>

        {kind === "transfer" ? null : (
          <div className="grid gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-sm">
                {split ? "Categories" : "Category and amount"}
              </span>
              {split ? (
                <span className="text-muted-foreground text-xs">
                  Use a minus sign for amounts that go the other way, like fees taken from a payout.
                </span>
              ) : null}
            </div>
            <ul className="grid gap-3">
              {splits.map((s, index) => {
                const error = errors[`splits.${index}`];
                return (
                  <li
                    key={s.key}
                    className="fade-in-0 slide-in-from-top-1 grid animate-in gap-1 duration-200"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_auto] gap-2">
                      <label htmlFor={`split-account-${s.key}`} className="sr-only">
                        Category {index + 1}
                      </label>
                      <NativeSelect
                        id={`split-account-${s.key}`}
                        value={s.accountId}
                        aria-invalid={Boolean(error)}
                        className={cn(!s.accountId && "text-muted-foreground")}
                        onChange={(e) => {
                          updateSplit(s.key, { accountId: e.target.value });
                          clearError(`splits.${index}`);
                        }}
                      >
                        <option value="">Choose a category…</option>
                        {ctx.categories.map((group) => (
                          <optgroup key={group.type} label={accountTypes[group.type].label}>
                            {group.options.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </NativeSelect>
                      <label htmlFor={`split-amount-${s.key}`} className="sr-only">
                        Amount {index + 1}
                      </label>
                      <Input
                        id={`split-amount-${s.key}`}
                        inputMode="decimal"
                        value={s.amount}
                        placeholder="0.00"
                        className="tabular text-end"
                        onChange={(e) => {
                          updateSplit(s.key, { amount: e.target.value });
                          clearError(`splits.${index}`);
                        }}
                      />
                      {split ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove category ${index + 1}`}
                          onClick={() =>
                            setSplits((current) => current.filter((x) => x.key !== s.key))
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X />
                        </Button>
                      ) : (
                        <span className="w-0" />
                      )}
                    </div>
                    {error ? (
                      <p className="fade-in-0 animate-in text-destructive text-xs">{error}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSplits((c) => [...c, newSplit()])}
              >
                <Plus />
                {split ? "Add category" : "Split into categories"}
              </Button>
              {split ? (
                <span className="text-sm">
                  <span className="text-muted-foreground">Total </span>
                  <span className="tabular font-semibold">
                    {formatMoney(formatDecimal(total), currency, ctx.locale)}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        )}

        {needsRate ? (
          <RateField
            slug={ctx.slug}
            id="tx-rate"
            currency={currency}
            baseCurrency={ctx.baseCurrency}
            date={date}
            value={fxRate}
            onChange={(v) => {
              setFxRate(v);
              clearError("fxRate");
            }}
            error={errors.fxRate}
            locale={ctx.locale}
            className="fade-in-0 slide-in-from-top-1 max-w-xs animate-in duration-200"
          />
        ) : null}

        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
      </fieldset>

      <div className="grid gap-2">
        <span className="font-medium text-sm">Receipts and files</span>
        {files === null ? (
          <div className="flex h-20 items-center justify-center rounded-xl border border-dashed">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : (
          <ReceiptsPanel
            slug={ctx.slug}
            entryId={row?.id}
            files={files}
            onChange={setFiles}
            compact
          />
        )}
      </div>

      <DialogFooter className="sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {row && !rowInClosedPeriod ? (
            <Button
              type="button"
              variant={confirmDelete ? "destructive" : "ghost"}
              onClick={remove}
              disabled={pending}
            >
              <Trash2 />
              {confirmDelete ? "Click again to remove" : "Remove"}
            </Button>
          ) : null}
          {row ? (
            <Button asChild type="button" variant="ghost">
              <Link href={`/o/${ctx.slug}/accounting/journal/${row.id}`}>
                <ExternalLink />
                {row.number}
              </Link>
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            {rowInClosedPeriod ? "Close" : "Cancel"}
          </Button>
          {rowInClosedPeriod ? null : (
            <Button type="submit" disabled={pending || (dateInClosedPeriod && !row)}>
              {pending ? <Spinner /> : null}
              {row ? "Save changes" : "Add transaction"}
            </Button>
          )}
        </div>
      </DialogFooter>
    </form>
  );
}
