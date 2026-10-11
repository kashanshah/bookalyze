"use client";

import {
  decimalPlaces,
  divRound,
  formatDecimal,
  isDecimal,
  minorUnits,
  parseDecimal,
  purchaseLineTotal,
  purchaseOrderTotal,
  spreadTotal,
  unitCostFromTotal,
} from "@bookalyze/core";
import { Calculator, Plus, Save, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { addSupplierAction, savePurchaseOrderAction } from "./actions";

export type PurchaseOrderDefaults = {
  supplierId: string;
  currency: string;
  orderDate: string;
  expectedDate: string | null;
  reference: string | null;
  notes: string | null;
  lines: { productId: string; quantity: number; unitCost: string }[];
};

/**
 * A line on the form. The cost of one and the line total are both editable: whichever was typed
 * last (`anchor`) is kept as typed, and the other is worked out from it and the quantity.
 */
type Line = {
  key: number;
  productId: string;
  quantity: string;
  /** Exact cost of one (as typed, or total ÷ quantity to 10 places). */
  unitCost: string;
  /** The line total as typed, when `anchor` is "total". */
  total: string;
  anchor: "cost" | "total";
};

/** What a receipt said about a line (by its place in `defaults.lines`), shown under it. */
export type LineHint = { description: string; note: string | null };

/** "2.4500" → "2.45": what someone would type. */
function plainCost(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

/** A worked-out cost of one, shown to 4 places ("17.5738500000" → "17.5739"). */
function shortCost(value: string): string {
  if (!isDecimal(value) || decimalPlaces(value) <= 4) return plainCost(value);
  return plainCost(formatDecimal(divRound(parseDecimal(value, 10), 1_000_000n)));
}

/** "3514.7700" → "3514.77": an amount as typed, in the currency's minor units. */
function plainAmount(value: string, currency: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const digits = minorUnits(currency);
  return digits ? `${whole}.${fraction.padEnd(digits, "0").slice(0, digits)}` : whole;
}

const wholeQuantity = (quantity: string) => /^\d+$/.test(quantity) && Number(quantity) > 0;

export function PurchaseOrderForm({
  slug,
  id,
  suppliers,
  products,
  currencies,
  defaults,
  suggestedSupplier = null,
  lineHints = [],
}: {
  slug: string;
  /** Set when editing a draft. */
  id?: string;
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string; sku: string | null }[];
  currencies: { code: string; name: string }[];
  defaults: PurchaseOrderDefaults;
  locale: string;
  /** A receipt's seller that isn't a vendor yet, offered as one. */
  suggestedSupplier?: { name: string; address: string | null } | null;
  lineHints?: LineHint[];
}) {
  const router = useRouter();
  const formId = useId();
  const [pending, start] = useTransition();
  const [supplierId, setSupplierId] = useState(defaults.supplierId);
  const [supplierList, setSupplierList] = useState(suppliers);
  const [suggested, setSuggested] = useState(suggestedSupplier);
  const [adding, startAdding] = useTransition();
  const [currency, setCurrency] = useState(defaults.currency);
  const [orderDate, setOrderDate] = useState(defaults.orderDate);
  const [expectedDate, setExpectedDate] = useState(defaults.expectedDate ?? "");
  const [reference, setReference] = useState(defaults.reference ?? "");
  const [notes, setNotes] = useState(defaults.notes ?? "");
  const [nextKey, setNextKey] = useState(defaults.lines.length + 1);
  const [lines, setLines] = useState<Line[]>(
    defaults.lines.length
      ? defaults.lines.map((line, i) => {
          const unitCost = plainCost(line.unitCost);
          // A cost with more than 4 places was worked out from a total: keep the total.
          const fromTotal = isDecimal(unitCost) && decimalPlaces(unitCost) > 4;
          return {
            key: i,
            productId: line.productId,
            quantity: String(line.quantity),
            unitCost,
            total: fromTotal
              ? plainAmount(
                  purchaseLineTotal(line.quantity, unitCost, defaults.currency),
                  defaults.currency,
                )
              : "",
            anchor: fromTotal ? ("total" as const) : ("cost" as const),
          };
        })
      : [{ key: 0, productId: "", quantity: "", unitCost: "", total: "", anchor: "cost" }],
  );
  /** The order total while it's being typed (spread over the lines when done). */
  const [totalDraft, setTotalDraft] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});

  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.name,
    keywords: p.sku ?? undefined,
    description: p.sku ? `Your SKU ${p.sku}` : undefined,
  }));
  const valid = (line: Line) => wholeQuantity(line.quantity) && isDecimal(line.unitCost);
  const lineTotal = (line: Line) =>
    valid(line) ? purchaseLineTotal(Number(line.quantity), line.unitCost, currency) : null;
  const total = purchaseOrderTotal(
    lines
      .filter(valid)
      .map((line) => ({ quantity: Number(line.quantity), unitCost: line.unitCost })),
    currency,
  );

  const addSuggested = () =>
    startAdding(async () => {
      if (!suggested) return;
      const result = await addSupplierAction(slug, suggested);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSupplierList((all) =>
        all.some((s) => s.id === result.id)
          ? all
          : [...all, { id: result.id, name: result.name }].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
      );
      setSupplierId(result.id);
      setSuggested(null);
      setErrors(({ supplierId: _, ...rest }) => rest);
      toast.success(`${result.name} added to your vendors`);
    });

  const update = (key: number, patch: Partial<Line>) =>
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  /** A changed field's old error goes as soon as it's edited. */
  const clearError = (index: number, field: string) =>
    setLineErrors(({ [`${index}.${field}`]: _, ...rest }) => rest);
  const setQuantity = (line: Line, quantity: string) =>
    update(line.key, {
      quantity,
      ...(line.anchor === "total"
        ? {
            unitCost:
              wholeQuantity(quantity) && isDecimal(line.total)
                ? (unitCostFromTotal(line.total, Number(quantity)) ?? "")
                : "",
          }
        : {}),
    });
  const setCost = (line: Line, unitCost: string) =>
    update(line.key, { unitCost, anchor: "cost", total: "" });
  const setTotal = (line: Line, total: string) =>
    update(line.key, {
      total,
      anchor: "total",
      unitCost:
        wholeQuantity(line.quantity) && isDecimal(total) && !total.startsWith("-")
          ? (unitCostFromTotal(total, Number(line.quantity)) ?? "")
          : "",
    });
  /** The order total typed in: spread over the lines by their totals (or quantities). */
  const applyTotal = () => {
    const typed = totalDraft;
    setTotalDraft(null);
    if (typed === null || !isDecimal(typed) || typed.startsWith("-")) return;
    if (plainAmount(formatDecimal(parseDecimal(typed)), currency) === plainAmount(total, currency))
      return;
    const counted = lines.filter((line) => wholeQuantity(line.quantity));
    if (!counted.length) {
      toast.error("Enter the quantities first, then the total.");
      return;
    }
    const byTotal = counted.map((line) => lineTotal(line) ?? "0");
    const shares =
      spreadTotal(typed, byTotal, currency) ??
      spreadTotal(
        typed,
        counted.map((line) => line.quantity),
        currency,
      );
    if (!shares) return;
    const share = new Map(counted.map((line, i) => [line.key, shares[i] ?? "0"]));
    setLines((all) =>
      all.map((line) => {
        const part = share.get(line.key);
        if (part === undefined) return line;
        return {
          ...line,
          anchor: "total",
          total: plainAmount(part, currency),
          unitCost: unitCostFromTotal(part, Number(line.quantity)) ?? "",
        };
      }),
    );
    setLineErrors({});
  };
  const addLine = () => {
    setLines((all) => [
      ...all,
      { key: nextKey, productId: "", quantity: "", unitCost: "", total: "", anchor: "cost" },
    ]);
    setNextKey((k) => k + 1);
  };

  const submit = () =>
    start(async () => {
      const result = await savePurchaseOrderAction(
        slug,
        {
          supplierId,
          currency,
          orderDate,
          expectedDate,
          reference,
          notes,
          lines: lines
            .filter((line) => line.productId || line.quantity || line.unitCost || line.total)
            .map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitCost: line.unitCost,
            })),
        },
        id,
      );
      if (!result.ok) {
        setErrors(result.errors ?? {});
        setLineErrors(result.lineErrors ?? {});
        toast.error(result.message);
        return;
      }
      toast.success(id ? `${result.number} saved` : `${result.number} created`, {
        description: "It's a draft until you mark it as sent to the supplier.",
      });
      router.push(`/o/${slug}/inventory/purchase-orders/${result.id}`);
    });

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <section className="grid gap-5 rounded-2xl border bg-card p-5 shadow-xs sm:grid-cols-2">
        <Field
          label="Supplier"
          htmlFor={`${formId}-supplier`}
          error={errors.supplierId}
          hint={
            suggested && !supplierId ? undefined : supplierList.length ? undefined : (
              <>
                Suppliers are your vendors.{" "}
                <Link
                  href={`/o/${slug}/accounting/contacts?type=vendor`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Add one under Customers &amp; vendors
                </Link>
                .
              </>
            )
          }
        >
          <Combobox
            id={`${formId}-supplier`}
            value={supplierId}
            onChange={setSupplierId}
            placeholder="Choose a supplier…"
            searchPlaceholder="Search vendors"
            searchable
            emptyText="No vendor by that name."
            invalid={Boolean(errors.supplierId)}
            options={supplierList.map((s) => ({ value: s.id, label: s.name }))}
          />
          {suggested && !supplierId ? (
            <div className="fade-in-0 mt-2 flex animate-in flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed bg-muted/30 px-3 py-2.5 text-sm">
              <p className="min-w-[10rem] flex-1">
                <span className="text-muted-foreground">The receipt's seller: </span>
                <span className="font-medium">{suggested.name}</span>
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addSuggested}
                disabled={adding}
              >
                {adding ? <Spinner /> : <UserPlus />}
                Add as a vendor
              </Button>
            </div>
          ) : null}
        </Field>
        <Field
          label="Currency"
          htmlFor={`${formId}-currency`}
          error={errors.currency}
          hint="The currency the supplier bills you in."
        >
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
        <Field label="Order date" htmlFor={`${formId}-ordered`} error={errors.orderDate}>
          <Input
            id={`${formId}-ordered`}
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            aria-invalid={Boolean(errors.orderDate)}
          />
        </Field>
        <Field
          label="Expected (optional)"
          htmlFor={`${formId}-expected`}
          error={errors.expectedDate}
          hint="When the supplier says it will arrive."
        >
          <Input
            id={`${formId}-expected`}
            type="date"
            value={expectedDate}
            min={orderDate || undefined}
            onChange={(e) => setExpectedDate(e.target.value)}
            aria-invalid={Boolean(errors.expectedDate)}
          />
        </Field>
        <Field
          label="Supplier's reference (optional)"
          htmlFor={`${formId}-reference`}
          error={errors.reference}
          hint="Their order or proforma invoice number."
          className="sm:col-span-2"
        >
          <Input
            id={`${formId}-reference`}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. PI-2026-118"
          />
        </Field>
      </section>

      <section
        aria-labelledby={`${formId}-products`}
        className="overflow-hidden rounded-2xl border bg-card shadow-xs"
      >
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 id={`${formId}-products`} className="font-medium text-sm">
            Products
          </h2>
          {errors.lines ? (
            <p className="text-destructive text-xs">{errors.lines}</p>
          ) : (
            <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <Calculator className="size-3.5" />
              Type the cost of one or the line total; the other is worked out.
            </p>
          )}
        </div>
        <div className="hidden grid-cols-[minmax(0,1fr)_6rem_8rem_9rem_2.25rem] gap-3 border-b bg-muted/30 px-5 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
          <span>Product</span>
          <span>Quantity</span>
          <span>Cost of one</span>
          <span>Line total</span>
          <span />
        </div>
        <ul className="divide-y">
          {lines.map((line, index) => {
            const err = (field: string) => lineErrors[`${index}.${field}`];
            const amount = lineTotal(line);
            const costShown = line.anchor === "cost" ? line.unitCost : shortCost(line.unitCost);
            const totalShown =
              line.anchor === "total" ? line.total : amount ? plainAmount(amount, currency) : "";
            return (
              <li
                key={line.key}
                className="fade-in-0 grid animate-in grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-start gap-3 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1fr)_6rem_8rem_9rem_2.25rem]"
              >
                <div className="col-span-4 grid min-w-0 grid-cols-1 gap-1 md:col-span-1">
                  <Combobox
                    aria-label={`Product ${index + 1}`}
                    value={line.productId}
                    onChange={(productId) => update(line.key, { productId })}
                    placeholder="Choose a product…"
                    searchPlaceholder="Search products"
                    searchable
                    emptyText="No product by that name. Add it under Products first."
                    invalid={Boolean(err("productId"))}
                    options={productOptions}
                  />
                  {err("productId") ? (
                    <p className="text-destructive text-xs">{err("productId")}</p>
                  ) : null}
                  {lineHints[line.key] ? (
                    <div className="grid gap-0.5 text-xs">
                      <p className="line-clamp-2 text-muted-foreground">
                        <span className="font-medium text-foreground">On the receipt: </span>
                        {lineHints[line.key]?.description}
                      </p>
                      {lineHints[line.key]?.note ? (
                        <p className="flex gap-1.5 text-muted-foreground">
                          <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
                          {lineHints[line.key]?.note}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <Input
                    aria-label={`Quantity ${index + 1}`}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) => {
                      setQuantity(line, e.target.value.trim());
                      clearError(index, "quantity");
                    }}
                    placeholder="Qty"
                    aria-invalid={Boolean(err("quantity"))}
                    className="tabular-nums"
                  />
                  {err("quantity") ? (
                    <p className="text-destructive text-xs">{err("quantity")}</p>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <Input
                    aria-label={`Cost of one ${index + 1}`}
                    inputMode="decimal"
                    value={costShown}
                    onChange={(e) => {
                      setCost(line, e.target.value.trim());
                      clearError(index, "unitCost");
                    }}
                    placeholder="0.00"
                    aria-invalid={Boolean(err("unitCost"))}
                    title={
                      line.anchor === "total" && line.unitCost
                        ? `Worked out from the line total: ${plainCost(line.unitCost)}`
                        : undefined
                    }
                    className={cn(
                      "tabular-nums",
                      line.anchor === "total" && "bg-muted/40 text-muted-foreground",
                    )}
                  />
                  {err("unitCost") ? (
                    <p className="text-destructive text-xs">{err("unitCost")}</p>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <Input
                    aria-label={`Line total ${index + 1}`}
                    inputMode="decimal"
                    value={totalShown}
                    onChange={(e) => {
                      setTotal(line, e.target.value.trim());
                      clearError(index, "unitCost");
                    }}
                    placeholder="0.00"
                    title={
                      line.anchor === "cost" && amount
                        ? "Worked out from the cost of one"
                        : undefined
                    }
                    className={cn(
                      "text-end tabular-nums",
                      line.anchor === "cost" && "bg-muted/40 text-muted-foreground",
                    )}
                  />
                </div>
                <div className="flex h-10 items-center justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove product ${index + 1}`}
                    disabled={lines.length === 1}
                    onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus />
            Add a product
          </Button>
          <div className="flex items-center gap-3 text-sm">
            <label htmlFor={`${formId}-total`} className="text-muted-foreground">
              Total ({currency})
            </label>
            <Input
              id={`${formId}-total`}
              aria-label="Order total"
              inputMode="decimal"
              value={totalDraft ?? plainAmount(total, currency)}
              onFocus={() => setTotalDraft(plainAmount(total, currency))}
              onChange={(e) => setTotalDraft(e.target.value.trim())}
              onBlur={applyTotal}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyTotal();
                } else if (e.key === "Escape") {
                  setTotalDraft(null);
                }
              }}
              title="Type the total you paid to spread it over the lines"
              className="h-9 w-36 text-end font-semibold tabular-nums"
            />
          </div>
        </div>
      </section>

      <Field
        label="Notes (optional)"
        htmlFor={`${formId}-notes`}
        error={errors.notes}
        hint="For you: terms, shipping method, anything to remember."
      >
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" asChild>
          <Link
            href={
              id
                ? `/o/${slug}/inventory/purchase-orders/${id}`
                : `/o/${slug}/inventory/purchase-orders`
            }
          >
            Cancel
          </Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Save />}
          {id ? "Save changes" : "Save draft"}
        </Button>
      </div>
    </form>
  );
}
