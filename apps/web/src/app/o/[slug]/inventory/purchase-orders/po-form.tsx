"use client";

import { isDecimal, purchaseLineTotal, purchaseOrderTotal } from "@bookalyze/core";
import { Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Amount } from "@/components/accounting/amount";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { savePurchaseOrderAction } from "./actions";

export type PurchaseOrderDefaults = {
  supplierId: string;
  currency: string;
  orderDate: string;
  expectedDate: string | null;
  reference: string | null;
  notes: string | null;
  lines: { productId: string; quantity: number; unitCost: string }[];
};

type Line = { key: number; productId: string; quantity: string; unitCost: string };

/** "2.4500" → "2.45": what someone would type. */
function plainCost(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function PurchaseOrderForm({
  slug,
  id,
  suppliers,
  products,
  currencies,
  defaults,
  locale,
}: {
  slug: string;
  /** Set when editing a draft. */
  id?: string;
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string; sku: string | null }[];
  currencies: { code: string; name: string }[];
  defaults: PurchaseOrderDefaults;
  locale: string;
}) {
  const router = useRouter();
  const formId = useId();
  const [pending, start] = useTransition();
  const [supplierId, setSupplierId] = useState(defaults.supplierId);
  const [currency, setCurrency] = useState(defaults.currency);
  const [orderDate, setOrderDate] = useState(defaults.orderDate);
  const [expectedDate, setExpectedDate] = useState(defaults.expectedDate ?? "");
  const [reference, setReference] = useState(defaults.reference ?? "");
  const [notes, setNotes] = useState(defaults.notes ?? "");
  const [nextKey, setNextKey] = useState(defaults.lines.length + 1);
  const [lines, setLines] = useState<Line[]>(
    defaults.lines.length
      ? defaults.lines.map((line, i) => ({
          key: i,
          productId: line.productId,
          quantity: String(line.quantity),
          unitCost: plainCost(line.unitCost),
        }))
      : [{ key: 0, productId: "", quantity: "", unitCost: "" }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});

  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.name,
    keywords: p.sku ?? undefined,
    description: p.sku ? `Your SKU ${p.sku}` : undefined,
  }));
  const valid = (line: Line) =>
    /^\d+$/.test(line.quantity) && Number(line.quantity) > 0 && isDecimal(line.unitCost);
  const lineTotal = (line: Line) =>
    valid(line) ? purchaseLineTotal(Number(line.quantity), line.unitCost, currency) : null;
  const total = purchaseOrderTotal(
    lines
      .filter(valid)
      .map((line) => ({ quantity: Number(line.quantity), unitCost: line.unitCost })),
    currency,
  );

  const update = (key: number, patch: Partial<Line>) =>
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const addLine = () => {
    setLines((all) => [...all, { key: nextKey, productId: "", quantity: "", unitCost: "" }]);
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
            .filter((line) => line.productId || line.quantity || line.unitCost)
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
            suppliers.length ? undefined : (
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
            emptyText="No vendor by that name."
            invalid={Boolean(errors.supplierId)}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
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
          {errors.lines ? <p className="text-destructive text-xs">{errors.lines}</p> : null}
        </div>
        <div className="hidden grid-cols-[minmax(0,1fr)_6rem_8rem_8rem_2.25rem] gap-3 border-b bg-muted/30 px-5 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
          <span>Product</span>
          <span>Quantity</span>
          <span>Cost of one</span>
          <span className="text-end">Line total</span>
          <span />
        </div>
        <ul className="divide-y">
          {lines.map((line, index) => {
            const err = (field: string) => lineErrors[`${index}.${field}`];
            const amount = lineTotal(line);
            return (
              <li
                key={line.key}
                className="fade-in-0 grid animate-in grid-cols-2 items-start gap-3 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1fr)_6rem_8rem_8rem_2.25rem]"
              >
                <div className="col-span-2 grid gap-1 md:col-span-1">
                  <Combobox
                    aria-label={`Product ${index + 1}`}
                    value={line.productId}
                    onChange={(productId) => update(line.key, { productId })}
                    placeholder="Choose a product…"
                    searchPlaceholder="Search products"
                    emptyText="No product by that name. Add it under Products first."
                    invalid={Boolean(err("productId"))}
                    options={productOptions}
                  />
                  {err("productId") ? (
                    <p className="text-destructive text-xs">{err("productId")}</p>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <Input
                    aria-label={`Quantity ${index + 1}`}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) => update(line.key, { quantity: e.target.value.trim() })}
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
                    value={line.unitCost}
                    onChange={(e) => update(line.key, { unitCost: e.target.value.trim() })}
                    placeholder="0.00"
                    aria-invalid={Boolean(err("unitCost"))}
                    className="tabular-nums"
                  />
                  {err("unitCost") ? (
                    <p className="text-destructive text-xs">{err("unitCost")}</p>
                  ) : null}
                </div>
                <p className="flex h-10 items-center text-sm md:justify-end">
                  <Amount value={amount} currency={currency} locale={locale} />
                </p>
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
          <p className="text-sm">
            <span className="me-3 text-muted-foreground">Total</span>
            <Amount value={total} currency={currency} locale={locale} className="font-semibold" />
          </p>
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
