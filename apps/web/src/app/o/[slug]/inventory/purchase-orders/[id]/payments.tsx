"use client";

import {
  formatDecimal,
  isDecimal,
  type PaymentPlanPart,
  paidPercent,
  parseDecimal,
  percentOfTotal,
  planAmounts,
  planProgress,
  sumDecimals,
} from "@bookalyze/core";
import { Banknote, ExternalLink, ListChecks, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Amount } from "@/components/accounting/amount";
import { RateField } from "@/components/accounting/rate-field";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  type PaymentCandidate,
  paymentCandidatesAction,
  recordPurchasePaymentAction,
  removePurchasePaymentAction,
  savePaymentPlanAction,
} from "../actions";

export type PaymentView = {
  id: string;
  receiptId: string | null;
  contactId: string;
  contactName: string;
  label: string | null;
  amount: string;
  currency: string;
  journalEntryId: string;
  entryNumber: string;
  date: string;
  removed: boolean;
  bank: { amount: string; currency: string } | null;
};

type Props = {
  slug: string;
  locale: string;
  baseCurrency: string;
  today: string;
  po: {
    id: string;
    number: string;
    status: string;
    currency: string;
    total: string;
    supplierId: string;
    supplierName: string;
  };
  plan: PaymentPlanPart[];
  payments: PaymentView[];
  deliveries: { id: string; label: string }[];
  moneyAccounts: { id: string; label: string; currency: string }[];
  vendors: { id: string; name: string }[];
  currencies: { code: string; name: string }[];
};

/** a − b, exactly. */
const minus = (a: string, b: string) => formatDecimal(parseDecimal(a) - parseDecimal(b));
const isNegative = (a: string) => parseDecimal(a) < 0n;
const isPositive = (a: string) => parseDecimal(a) > 0n;
const abs = (a: string) => (isNegative(a) ? a.slice(1) : a);

/**
 * What the order has cost so far: its payment plan, what's been paid to the supplier and to
 * others (freight, duty…), and what's still to pay. Payments are bank transactions linked here.
 */
export function PurchasePayments(props: Props) {
  const { po, plan, payments, locale } = props;
  const [planOpen, setPlanOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const counted = payments.filter((p) => !p.removed);
  const toSupplier = counted.filter((p) => p.contactId === po.supplierId);
  const paid = sumDecimals(toSupplier.map((p) => p.amount));
  const owed = minus(po.total, paid);
  const progress = planProgress(planAmounts(plan, po.total, po.currency), paid);
  const share = paidPercent(paid, po.total);
  const closed = po.status === "cancelled";

  return (
    <section
      aria-labelledby="payments-heading"
      className="overflow-hidden rounded-2xl border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <h2 id="payments-heading" className="font-medium text-sm">
            Payments
          </h2>
          <p className="text-muted-foreground text-xs">
            What you've paid {po.supplierName}, and others for shipping or duty.
          </p>
        </div>
        {closed ? null : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setPlanOpen(true)}>
              <ListChecks />
              {plan.length ? "Payment plan" : "Add a payment plan"}
            </Button>
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <Banknote />
              Record a payment
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 px-5 py-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Order total">
            <Amount value={po.total} currency={po.currency} locale={locale} />
          </Stat>
          <Stat label={`Paid (${share}%)`}>
            <Amount value={paid} currency={po.currency} locale={locale} />
          </Stat>
          <Stat label={isNegative(owed) ? "Paid over the order" : "Still to pay"}>
            <Amount
              value={abs(owed)}
              currency={po.currency}
              locale={locale}
              className={isPositive(owed) ? "font-semibold" : "text-success"}
            />
          </Stat>
        </div>
        <div
          role="progressbar"
          aria-label="Paid so far"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Number(share))}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.min(100, Number(share))}%` }}
          />
        </div>

        {plan.length ? (
          <ol aria-label="Payment plan" className="grid gap-1.5">
            {plan.map((part, i) => {
              const state = progress.parts[i];
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: parts have no id; order is the identity.
                  key={i}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{part.label || `Part ${i + 1}`}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {part.kind === "percent" ? `${trimZeros(part.value)}%` : "fixed amount"}
                    </span>
                  </span>
                  <Amount value={state?.amount ?? "0"} currency={po.currency} locale={locale} />
                  {state?.status === "paid" ? (
                    <Badge variant="success">Paid</Badge>
                  ) : state?.status === "part" ? (
                    <Badge variant="warning">
                      <Amount value={state.paid} currency={po.currency} locale={locale} /> paid
                    </Badge>
                  ) : (
                    <Badge variant="outline">To pay</Badge>
                  )}
                </li>
              );
            })}
          </ol>
        ) : null}

        {payments.length ? (
          <ul aria-label="Payments made" className="divide-y rounded-xl border">
            {payments.map((p) => (
              <PaymentRow key={p.id} {...props} payment={p} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            No payments yet. Record each one as you pay: an upfront deposit, the balance, the
            shipping agent…
          </p>
        )}
      </div>

      <PlanDialog {...props} open={planOpen} onClose={() => setPlanOpen(false)} />
      <PaymentDialog {...props} paid={paid} open={payOpen} onClose={() => setPayOpen(false)} />
    </section>
  );
}

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-muted-foreground text-xs">{label}</p>
      <p className="truncate tabular-nums">{children}</p>
    </div>
  );
}

function PaymentRow({ slug, locale, po, payment: p }: Props & { payment: PaymentView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);
  const remove = () =>
    start(async () => {
      const result = await removePurchasePaymentAction(slug, po.id, p.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Payment taken off the order", {
        description: "The bank transaction stays in your books.",
      });
      router.refresh();
    });
  const other = p.contactId !== po.supplierId;
  return (
    <li
      aria-label={`Payment ${p.label ?? ""} ${p.entryNumber}`.replace(/\s+/g, " ")}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm",
        p.removed && "opacity-60",
      )}
    >
      <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
        {formatDate(p.date, locale)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{p.label ?? (other ? "Other costs" : "Payment")}</span>
        {other ? <span className="text-muted-foreground"> · to {p.contactName}</span> : null}
        {p.removed ? (
          <span className="block text-destructive text-xs">
            Its transaction was removed from the books, so it no longer counts.
          </span>
        ) : p.bank && p.bank.currency !== p.currency ? (
          <span className="block text-muted-foreground text-xs">
            <Amount value={p.bank.amount} currency={p.bank.currency} locale={locale} /> left the
            account
          </span>
        ) : null}
      </span>
      <Amount value={p.amount} currency={p.currency} locale={locale} className="tabular-nums" />
      <Link
        href={`/o/${slug}/accounting/journal/${p.journalEntryId}`}
        className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
      >
        {p.entryNumber}
        <ExternalLink className="size-3" />
      </Link>
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          confirm ? "Confirm: take this payment off the order" : "Take this payment off the order"
        }
        className={cn("size-8", confirm && "text-destructive")}
        disabled={pending}
        onClick={() => (confirm ? remove() : setConfirm(true))}
      >
        {pending ? <Spinner /> : confirm ? <Trash2 /> : <X />}
      </Button>
    </li>
  );
}

// -------------------------------------------------------------------------------------------
// Payment plan

type PlanRow = { key: number; label: string; kind: "percent" | "amount"; value: string };

function Toggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className="m-0 grid min-w-0 auto-cols-fr grid-flow-col gap-1 rounded-lg border-0 bg-muted/60 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md px-2.5 py-1.5 font-medium text-xs transition-all duration-150",
            value === o.key
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

function PlanDialog({
  slug,
  locale,
  po,
  plan,
  open,
  onClose,
}: Props & { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const formId = useId();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [nextKey, setNextKey] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const initial = plan.length
      ? plan.map((p, i) => ({ key: i, ...p, value: trimZeros(p.value) }))
      : [{ key: 0, label: "Upfront", kind: "percent" as const, value: "" }];
    setRows(initial);
    setNextKey(initial.length);
    setErrors({});
    setMessage(null);
  }, [open, plan]);

  const update = (key: number, patch: Partial<PlanRow>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const amountOf = (r: PlanRow) =>
    isDecimal(r.value) && Number(r.value) > 0
      ? r.kind === "percent"
        ? percentOfTotal(po.total, r.value, po.currency)
        : r.value
      : null;
  const rest = minus(po.total, sumDecimals(rows.map((r) => amountOf(r) ?? "0")));

  const save = (list: PlanRow[]) =>
    start(async () => {
      const result = await savePaymentPlanAction(
        slug,
        po.id,
        list.map(({ label, kind, value }) => ({ label, kind, value })),
      );
      if (!result.ok) {
        setErrors(result.lineErrors ?? {});
        setMessage(result.message);
        return;
      }
      toast.success(list.length ? "Payment plan saved" : "Payment plan removed");
      onClose();
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Payment plan for {po.number}</DialogTitle>
          <DialogDescription>
            How the supplier is to be paid: as many parts as you agreed, each a percentage of the
            order or a fixed amount. Payments fill the parts in order.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(rows.filter((r) => r.label || r.value));
          }}
        >
          <ul className="grid gap-3">
            {rows.map((r, i) => {
              const amount = amountOf(r);
              return (
                <li
                  key={r.key}
                  className="fade-in-0 grid animate-in grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_auto]"
                >
                  <Input
                    aria-label={`Part ${i + 1}: what it's for`}
                    value={r.label}
                    onChange={(e) => update(r.key, { label: e.target.value })}
                    placeholder="e.g. Upfront, On completion"
                    className="col-span-2 sm:col-span-1"
                  />
                  <Toggle
                    label={`Part ${i + 1}: percentage or amount`}
                    value={r.kind}
                    onChange={(kind) => update(r.key, { kind })}
                    options={[
                      { key: "percent", label: "% of order" },
                      { key: "amount", label: po.currency },
                    ]}
                  />
                  <div className="grid gap-1">
                    <Input
                      aria-label={`Part ${i + 1}: ${r.kind === "percent" ? "percentage" : "amount"}`}
                      inputMode="decimal"
                      value={r.value}
                      onChange={(e) => update(r.key, { value: e.target.value.trim() })}
                      placeholder={r.kind === "percent" ? "35" : "1000"}
                      aria-invalid={Boolean(errors[`${i}.value`])}
                      className="tabular-nums"
                    />
                    {r.kind === "percent" && amount ? (
                      <span className="text-muted-foreground text-xs">
                        = <Amount value={amount} currency={po.currency} locale={locale} />
                      </span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove part ${i + 1}`}
                    onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                  >
                    <Trash2 />
                  </Button>
                  {errors[`${i}.value`] || errors[`${i}.label`] ? (
                    <p className="col-span-full text-destructive text-xs">
                      {errors[`${i}.value`] ?? errors[`${i}.label`]}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setRows((all) => [
                  ...all,
                  {
                    key: nextKey,
                    label: "",
                    kind: "amount",
                    value: isPositive(rest) ? trimZeros(rest) : "",
                  },
                ]);
                setNextKey((k) => k + 1);
              }}
            >
              <Plus />
              Add a part
            </Button>
            <p className="text-muted-foreground text-xs">
              {isPositive(rest) ? (
                <>
                  <Amount value={rest} currency={po.currency} locale={locale} /> of the order isn't
                  in the plan yet.
                </>
              ) : isNegative(rest) ? (
                <span className="text-destructive">The parts add up to more than the order.</span>
              ) : (
                "The parts cover the whole order."
              )}
            </p>
          </div>
          {message ? <p className="text-destructive text-sm">{message}</p> : null}
        </form>
        <DialogFooter>
          {plan.length ? (
            <Button
              type="button"
              variant="ghost"
              className="sm:me-auto"
              disabled={pending}
              onClick={() => save([])}
            >
              Remove the plan
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner /> : null}
            Save plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------------------------------
// Recording a payment

function PaymentDialog({
  slug,
  locale,
  baseCurrency,
  today,
  po,
  plan,
  paid,
  deliveries,
  moneyAccounts,
  vendors,
  currencies,
  open,
  onClose,
}: Props & { paid: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const formId = useId();
  const [pending, start] = useTransition();
  const [contactId, setContactId] = useState(po.supplierId);
  const [receiptId, setReceiptId] = useState("");
  const [how, setHow] = useState<"amount" | "percent">("amount");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [moneyAccountId, setMoneyAccountId] = useState(moneyAccounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [bankAmount, setBankAmount] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<PaymentCandidate[] | null>(null);
  const [picked, setPicked] = useState<PaymentCandidate | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  // The next part of the plan that isn't paid yet suggests the amount and label.
  useEffect(() => {
    if (!open) return;
    const progress = planProgress(planAmounts(plan, po.total, po.currency), paid);
    const nextIndex = progress.parts.findIndex((p) => p.status !== "paid");
    const next = nextIndex >= 0 ? plan[nextIndex] : undefined;
    const left = nextIndex >= 0 ? progress.parts[nextIndex] : undefined;
    setContactId(po.supplierId);
    setReceiptId("");
    setLabel(next?.label ?? "");
    if (next && left) {
      const due = minus(left.amount, left.paid);
      if (next.kind === "percent" && left.status === "due") {
        setHow("percent");
        setValue(trimZeros(next.value));
      } else {
        setHow("amount");
        setValue(trimZeros(due));
      }
    } else {
      setHow("amount");
      setValue("");
    }
    setMode("new");
    setDate(today);
    setBankAmount("");
    setFxRate("");
    setSearch("");
    setCandidates(null);
    setPicked(null);
    setErrors({});
    setMessage(null);
  }, [open, plan, po.total, po.currency, po.supplierId, paid, today]);

  const toSupplier = contactId === po.supplierId;
  const owedIn = toSupplier ? po.currency : currency;
  const amount =
    toSupplier && how === "percent"
      ? isDecimal(value) && Number(value) > 0
        ? percentOfTotal(po.total, value, po.currency)
        : ""
      : value;
  const account = moneyAccounts.find((a) => a.id === moneyAccountId);
  const accountCurrency = account?.currency ?? baseCurrency;
  const sameCurrency = accountCurrency === owedIn;

  // Transactions already in the books, searched as you type.
  useEffect(() => {
    if (!open || mode !== "existing") return;
    let cancelled = false;
    const t = setTimeout(() => {
      paymentCandidatesAction(slug, search).then((rows) => {
        if (!cancelled) setCandidates(rows);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, mode, search, slug]);

  const submit = () =>
    start(async () => {
      setErrors({});
      setMessage(null);
      const result = await recordPurchasePaymentAction(slug, po.id, {
        mode,
        contactId: toSupplier ? "" : contactId,
        receiptId: toSupplier ? "" : receiptId,
        label,
        amount,
        currency: owedIn,
        journalEntryId: picked?.id ?? "",
        date,
        moneyAccountId,
        bankAmount: sameCurrency ? amount : bankAmount,
        fxRate: accountCurrency === baseCurrency ? undefined : fxRate,
      });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        setMessage(result.message ?? null);
        return;
      }
      toast.success(result.message, {
        description:
          mode === "new" ? "It's in Transactions too, as money out to Inventory." : undefined,
      });
      onClose();
      router.refresh();
    });

  const vendorOptions = [
    { value: po.supplierId, label: po.supplierName, description: "The supplier" },
    ...vendors.filter((v) => v.id !== po.supplierId).map((v) => ({ value: v.id, label: v.name })),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Record a payment on {po.number}</DialogTitle>
          <DialogDescription>
            A payment to the supplier, or to someone else for this order's shipping, duty or other
            costs.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid to" htmlFor={`${formId}-to`} error={errors.contactId}>
              <Combobox
                id={`${formId}-to`}
                value={contactId}
                onChange={(id) => {
                  setContactId(id || po.supplierId);
                  if (id !== po.supplierId) setHow("amount");
                }}
                searchPlaceholder="Search vendors"
                options={vendorOptions}
              />
            </Field>
            <Field
              label="What it's for (optional)"
              htmlFor={`${formId}-label`}
              error={errors.label}
            >
              <Input
                id={`${formId}-label`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={toSupplier ? "e.g. Upfront, On completion" : "e.g. Sea freight"}
              />
            </Field>
            {toSupplier ? null : (
              <>
                <Field
                  label="For which delivery (optional)"
                  htmlFor={`${formId}-delivery`}
                  error={errors.receiptId}
                  hint="Leave it empty if the goods haven't arrived yet."
                >
                  <Combobox
                    id={`${formId}-delivery`}
                    value={receiptId}
                    onChange={setReceiptId}
                    placeholder="Not yet"
                    options={deliveries.map((d) => ({ value: d.id, label: d.label }))}
                  />
                </Field>
                <Field label="Currency" htmlFor={`${formId}-currency`} error={errors.currency}>
                  <Combobox
                    id={`${formId}-currency`}
                    value={currency}
                    onChange={setCurrency}
                    searchPlaceholder="Search currencies"
                    options={currencies.map((c) => ({
                      value: c.code,
                      label: `${c.code} · ${c.name}`,
                      keywords: c.name,
                    }))}
                  />
                </Field>
              </>
            )}
          </div>

          <Field
            label={toSupplier ? `How much (${po.currency})` : `How much (${currency})`}
            htmlFor={`${formId}-amount`}
            error={errors.amount}
            hint={
              toSupplier && how === "percent" && amount ? (
                <>
                  {trimZeros(value)}% of the order is{" "}
                  <Amount value={amount} currency={po.currency} locale={locale} />.
                </>
              ) : toSupplier ? (
                "A percentage of the order, or the amount itself."
              ) : undefined
            }
          >
            <div className="flex gap-2">
              {toSupplier ? (
                <div className="w-40 shrink-0">
                  <Toggle
                    label="Percentage or amount"
                    value={how}
                    onChange={setHow}
                    options={[
                      { key: "percent", label: "% of order" },
                      { key: "amount", label: "Amount" },
                    ]}
                  />
                </div>
              ) : null}
              <Input
                id={`${formId}-amount`}
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value.trim())}
                placeholder={how === "percent" && toSupplier ? "35" : "0.00"}
                aria-invalid={Boolean(errors.amount)}
                className="tabular-nums"
              />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-muted/60 p-1">
            {(
              [
                ["new", "A new payment"],
                ["existing", "Already in my books"],
              ] as const
            ).map(([key, text]) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                onClick={() => setMode(key)}
                className={cn(
                  "rounded-lg px-2 py-2 font-medium text-sm transition-all duration-150",
                  mode === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {text}
              </button>
            ))}
          </div>

          {mode === "new" ? (
            <div className="fade-in-0 grid animate-in gap-4 sm:grid-cols-2">
              <Field label="Paid from" htmlFor={`${formId}-account`} error={errors.moneyAccountId}>
                <Combobox
                  id={`${formId}-account`}
                  value={moneyAccountId}
                  onChange={setMoneyAccountId}
                  placeholder="Choose an account…"
                  options={moneyAccounts.map((a) => ({
                    value: a.id,
                    label: a.label,
                    description: a.currency,
                  }))}
                />
              </Field>
              <Field label="Paid on" htmlFor={`${formId}-date`} error={errors.date}>
                <Input
                  id={`${formId}-date`}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              {sameCurrency ? null : (
                <Field
                  label={`What left the account (${accountCurrency})`}
                  htmlFor={`${formId}-bank`}
                  error={errors.bankAmount}
                  hint={`The account is in ${accountCurrency}; the payment was ${owedIn}.`}
                >
                  <Input
                    id={`${formId}-bank`}
                    inputMode="decimal"
                    value={bankAmount}
                    onChange={(e) => setBankAmount(e.target.value.trim())}
                    className="tabular-nums"
                  />
                </Field>
              )}
              {accountCurrency === baseCurrency ? null : (
                <RateField
                  slug={slug}
                  id={`${formId}-rate`}
                  currency={accountCurrency}
                  baseCurrency={baseCurrency}
                  date={date}
                  value={fxRate}
                  onChange={setFxRate}
                  error={errors.fxRate}
                  locale={locale}
                />
              )}
              <p className="text-muted-foreground text-xs sm:col-span-2">
                Saving adds it to Transactions as money out, categorised to Inventory.
              </p>
            </div>
          ) : (
            <div className="fade-in-0 grid animate-in gap-2">
              <Input
                aria-label="Search your transactions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by description, vendor or amount"
              />
              {errors.journalEntryId ? (
                <p className="text-destructive text-xs">{errors.journalEntryId}</p>
              ) : null}
              <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border p-1">
                {candidates === null ? (
                  <li className="flex justify-center p-4">
                    <Spinner />
                  </li>
                ) : candidates.length === 0 ? (
                  <li className="p-4 text-center text-muted-foreground text-sm">
                    No money out matches.
                  </li>
                ) : (
                  candidates.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-pressed={picked?.id === c.id}
                        onClick={() => {
                          setPicked(c);
                          if (!value && c.currency === owedIn) {
                            setHow("amount");
                            setValue(trimZeros(c.amount));
                          }
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm transition-colors hover:bg-muted",
                          picked?.id === c.id && "bg-primary/10 ring-1 ring-primary/40",
                        )}
                      >
                        <span className="w-20 shrink-0 text-muted-foreground text-xs tabular-nums">
                          {formatDate(c.date, locale)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {c.memo ?? "No description"}
                        </span>
                        <Amount value={c.amount} currency={c.currency} locale={locale} />
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
          {message ? <p className="text-destructive text-sm">{message}</p> : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner /> : null}
            {mode === "new" ? "Record payment" : "Link payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
