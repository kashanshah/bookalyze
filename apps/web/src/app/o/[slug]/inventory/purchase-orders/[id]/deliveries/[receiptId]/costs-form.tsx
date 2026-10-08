"use client";

import {
  ALLOCATION_HINTS,
  ALLOCATION_LABELS,
  type AllocationMethod,
  costDelivery,
  isDecimal,
  LANDED_COST_KIND_LABELS,
  type LandedCostKind,
} from "@bookalyze/core";
import { Info, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Amount } from "@/components/accounting/amount";
import { RateField } from "@/components/accounting/rate-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { saveDeliveryCostsAction } from "../../../actions";

type Line = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  unitCost: string;
  unitWeight: string | null;
};

type Cost = {
  key: number;
  kind: LandedCostKind;
  description: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  allocation: AllocationMethod;
};

/** "70.0000" → "70", "1.3650000000" → "1.365". */
function plain(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

const KINDS = Object.entries(LANDED_COST_KIND_LABELS).map(([value, label]) => ({ value, label }));
const SPLITS = (Object.keys(ALLOCATION_LABELS) as AllocationMethod[]).map((value) => ({
  value,
  label: ALLOCATION_LABELS[value],
  description: ALLOCATION_HINTS[value],
}));
/** The usual split for each kind of cost. */
const DEFAULT_SPLIT: Record<LandedCostKind, AllocationMethod> = {
  freight: "weight",
  duty: "value",
  brokerage: "value",
  prep: "units",
  other: "units",
};

export function DeliveryCostsForm({
  slug,
  receiptId,
  purchaseOrderId,
  receivedOn,
  poCurrency,
  baseCurrency,
  locale,
  currencies,
  costed,
  exchangeRate,
  lines,
  costs: initialCosts,
}: {
  slug: string;
  receiptId: string;
  purchaseOrderId: string;
  receivedOn: string;
  poCurrency: string;
  baseCurrency: string;
  locale: string;
  currencies: { code: string; name: string }[];
  costed: boolean;
  exchangeRate: string | null;
  lines: Line[];
  costs: Omit<Cost, "key">[];
}) {
  const router = useRouter();
  const formId = useId();
  const [pending, start] = useTransition();
  const [rate, setRate] = useState(exchangeRate ? plain(exchangeRate) : "");
  const [costs, setCosts] = useState<Cost[]>(
    initialCosts.map((cost, key) => ({
      ...cost,
      key,
      amount: plain(cost.amount),
      exchangeRate: cost.exchangeRate ? plain(cost.exchangeRate) : "",
    })),
  );
  const [nextKey, setNextKey] = useState(initialCosts.length);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const foreign = poCurrency !== baseCurrency;
  const noWeight = lines.filter((line) => !line.unitWeight);

  const update = (key: number, patch: Partial<Cost>) =>
    setCosts((all) => all.map((cost) => (cost.key === key ? { ...cost, ...patch } : cost)));
  const addCost = () => {
    const kind: LandedCostKind = costs.some((c) => c.kind === "freight") ? "duty" : "freight";
    const split = DEFAULT_SPLIT[kind];
    setCosts((all) => [
      ...all,
      {
        key: nextKey,
        kind,
        description: "",
        amount: "",
        currency: baseCurrency,
        exchangeRate: "",
        allocation: split === "weight" && noWeight.length ? "units" : split,
      },
    ]);
    setNextKey((k) => k + 1);
  };

  // The live preview counts only the costs that are filled in properly.
  const usable = costs.filter(
    (cost) =>
      isDecimal(cost.amount) &&
      Number(cost.amount) > 0 &&
      (cost.currency === baseCurrency || isDecimal(cost.exchangeRate)),
  );
  const preview = costDelivery({
    baseCurrency,
    poCurrency,
    rate: foreign && isDecimal(rate) && Number(rate) > 0 ? rate : null,
    lines,
    extras: usable.map((cost) => ({
      amount: cost.amount,
      currency: cost.currency,
      rate: cost.currency === baseCurrency ? null : cost.exchangeRate,
      allocation: cost.allocation,
    })),
  });
  const n = new Intl.NumberFormat(locale);

  const submit = () =>
    start(async () => {
      const result = await saveDeliveryCostsAction(slug, receiptId, {
        exchangeRate: foreign ? rate : "",
        costs: costs.map(({ key: _key, ...cost }) => ({
          ...cost,
          exchangeRate: cost.currency === baseCurrency ? "" : cost.exchangeRate,
        })),
      });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        setLineErrors(result.lineErrors ?? {});
        toast.error(result.message);
        return;
      }
      setErrors({});
      setLineErrors({});
      toast.success("Landed cost saved", {
        description: "The stock lots from this delivery now carry it.",
      });
      router.push(`/o/${slug}/inventory/purchase-orders/${purchaseOrderId}`);
    });

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {!costed ? (
        <Alert>
          <p className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            This delivery isn't costed yet. Check the figures below and save to create its stock
            lots.
          </p>
        </Alert>
      ) : null}

      {foreign ? (
        <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:grid-cols-2">
          <div>
            <h2 className="font-medium text-sm">The order is in {poCurrency}</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Stock is costed in {baseCurrency}, your main currency, at the rate on the day it
              arrived (or the rate you paid at, if you prefer).
            </p>
          </div>
          <RateField
            slug={slug}
            id={`${formId}-rate`}
            currency={poCurrency}
            baseCurrency={baseCurrency}
            date={receivedOn}
            value={rate}
            onChange={setRate}
            error={errors.exchangeRate}
            locale={locale}
          />
        </section>
      ) : null}

      <section
        aria-labelledby={`${formId}-extras`}
        className="overflow-hidden rounded-2xl border bg-card shadow-xs"
      >
        <div className="border-b px-5 py-3">
          <h2 id={`${formId}-extras`} className="font-medium text-sm">
            Extra costs
          </h2>
          <p className="mt-0.5 text-muted-foreground text-xs">
            Freight, duty, customs brokerage, prep: anything you paid to get this delivery to you.
            Each is split across the products that arrived.
          </p>
        </div>
        {costs.length === 0 ? (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            No extra costs yet. The products are costed at their order price.
          </p>
        ) : (
          <ul className="divide-y">
            {costs.map((cost, index) => {
              const err = (field: string) => lineErrors[`${index}.${field}`];
              const other = cost.currency !== baseCurrency;
              return (
                <li
                  key={cost.key}
                  className="fade-in-0 grid animate-in gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-[11rem_minmax(0,1fr)_8rem_8rem_10rem_2.25rem]"
                >
                  <Combobox
                    aria-label={`What cost ${index + 1} was for`}
                    value={cost.kind}
                    onChange={(kind) => {
                      const next = kind as LandedCostKind;
                      const split = DEFAULT_SPLIT[next];
                      update(cost.key, {
                        kind: next,
                        allocation: split === "weight" && noWeight.length ? "units" : split,
                      });
                    }}
                    options={KINDS}
                  />
                  <Input
                    aria-label={`Description ${index + 1}`}
                    value={cost.description}
                    onChange={(e) => update(cost.key, { description: e.target.value })}
                    placeholder="e.g. Sea freight, forwarder name"
                  />
                  <div className="grid gap-1">
                    <Input
                      aria-label={`Amount ${index + 1}`}
                      inputMode="decimal"
                      value={cost.amount}
                      onChange={(e) => update(cost.key, { amount: e.target.value.trim() })}
                      placeholder="0.00"
                      aria-invalid={Boolean(err("amount"))}
                      className="text-end tabular-nums"
                    />
                    {err("amount") ? (
                      <p className="text-destructive text-xs">{err("amount")}</p>
                    ) : null}
                  </div>
                  <Combobox
                    aria-label={`Currency ${index + 1}`}
                    value={cost.currency}
                    onChange={(currency) => update(cost.key, { currency })}
                    searchPlaceholder="Search currencies"
                    options={currencies.map((c) => ({
                      value: c.code,
                      label: c.code,
                      description: c.name,
                      keywords: c.name,
                    }))}
                  />
                  <div className="grid gap-1">
                    <Combobox
                      aria-label={`How to split cost ${index + 1}`}
                      value={cost.allocation}
                      onChange={(allocation) =>
                        update(cost.key, { allocation: allocation as AllocationMethod })
                      }
                      options={SPLITS.map((split) =>
                        split.value === "weight" && noWeight.length
                          ? {
                              ...split,
                              description: `Add a weight to ${noWeight[0]?.name} under Products first.`,
                              disabled: true,
                            }
                          : split,
                      )}
                    />
                  </div>
                  <div className="flex items-start justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove cost ${index + 1}`}
                      onClick={() => setCosts((all) => all.filter((c) => c.key !== cost.key))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {other ? (
                    <RateField
                      slug={slug}
                      id={`${formId}-rate-${cost.key}`}
                      currency={cost.currency}
                      baseCurrency={baseCurrency}
                      date={receivedOn}
                      value={cost.exchangeRate}
                      onChange={(exchangeRate) => update(cost.key, { exchangeRate })}
                      error={err("exchangeRate")}
                      locale={locale}
                      className="sm:col-span-2 lg:col-span-3"
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t bg-muted/20 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={addCost}>
            <Plus />
            Add a cost
          </Button>
        </div>
      </section>

      <section
        aria-labelledby={`${formId}-lots`}
        className="overflow-hidden rounded-2xl border bg-card shadow-xs"
      >
        <div className="border-b px-5 py-3">
          <h2 id={`${formId}-lots`} className="font-medium text-sm">
            Stock lots from this delivery
          </h2>
          <p className="mt-0.5 text-muted-foreground text-xs">In {baseCurrency}.</p>
        </div>
        {!preview.ok ? (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">{preview.problem}</p>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_5rem_8rem_8rem_8rem] gap-3 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
              <span>Product</span>
              <span className="text-end">Units</span>
              <span className="text-end">Order price</span>
              <span className="text-end">Extra costs</span>
              <span className="text-end">Cost of one</span>
            </div>
            <ul className="divide-y">
              {preview.lines.map((lot, i) => {
                const line = lines[i];
                return (
                  <li
                    key={lot.id}
                    aria-label={`Lot: ${line?.name}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5 md:grid-cols-[minmax(0,1fr)_5rem_8rem_8rem_8rem] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{line?.name}</p>
                      {line?.sku ? (
                        <p className="text-muted-foreground text-xs">Your SKU {line.sku}</p>
                      ) : null}
                    </div>
                    <p className="text-end tabular-nums">
                      <span className="text-muted-foreground md:hidden">Units </span>
                      {n.format(lot.quantity)}
                    </p>
                    <p className="text-muted-foreground md:text-end">
                      <span className="md:hidden">Order price </span>
                      <Amount value={lot.productCost} currency={baseCurrency} locale={locale} />
                    </p>
                    <p className="text-end text-muted-foreground">
                      <span className="md:hidden">+ extra </span>
                      <Amount value={lot.landedCost} currency={baseCurrency} locale={locale} />
                    </p>
                    <p className="col-span-2 text-end md:col-span-1">
                      <span className="text-muted-foreground text-xs md:hidden">Cost of one </span>
                      <span className="font-semibold tabular-nums">
                        {new Intl.NumberFormat(locale, {
                          style: "currency",
                          currency: baseCurrency,
                          maximumFractionDigits: 4,
                        }).format(lot.unitCost as unknown as number)}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t bg-muted/20 px-5 py-3 text-sm">
              <span>
                <span className="me-2 text-muted-foreground">Extra costs</span>
                <Amount value={preview.landedCost} currency={baseCurrency} locale={locale} />
              </span>
              <span>
                <span className="me-2 text-muted-foreground">Landed total</span>
                <Amount
                  value={preview.totalCost}
                  currency={baseCurrency}
                  locale={locale}
                  className="font-semibold"
                />
              </span>
            </div>
          </>
        )}
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" asChild>
          <Link href={`/o/${slug}/inventory/purchase-orders/${purchaseOrderId}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Save />}
          Save landed cost
        </Button>
      </div>
    </form>
  );
}
