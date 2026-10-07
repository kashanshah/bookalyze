"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Amount } from "@/components/accounting/amount";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { InvoiceBuyerFields, InvoiceDraft } from "@/lib/invoice-draft";
import { loadInvoiceDraftAction, saveOrderInvoiceAction } from "./invoice-actions";

export function InvoiceDialog({
  slug,
  orderId,
  locale,
  mode,
}: {
  slug: string;
  orderId: string;
  locale: string;
  mode: "create" | "correct";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={mode === "create" ? "default" : "outline"} size="sm">
          <FileText />
          {mode === "create" ? "Create invoice" : "Correct details"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        {open ? (
          <InvoiceForm
            slug={slug}
            orderId={orderId}
            locale={locale}
            mode={mode}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function InvoiceForm({
  slug,
  orderId,
  locale,
  mode,
  onDone,
}: {
  slug: string;
  orderId: string;
  locale: string;
  mode: "create" | "correct";
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [buyer, setBuyer] = useState<InvoiceBuyerFields>({
    name: "",
    company: "",
    taxNumber: "",
    address: "",
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    loadInvoiceDraftAction(slug, orderId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDraft(result.draft);
        setBuyer(result.draft.buyer);
      } else {
        setLoadError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [slug, orderId]);

  if (loadError) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Customer invoice</DialogTitle>
          <DialogDescription>{loadError}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (!draft) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
        <Spinner />
        Preparing the invoice…
      </div>
    );
  }

  const set = (key: keyof InvoiceBuyerFields) => (value: string) =>
    setBuyer((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveOrderInvoiceAction(slug, orderId, buyer);
          if (result.ok) {
            toast.success(
              mode === "create"
                ? `${result.number} is ready to download`
                : `${result.number} updated`,
            );
            onDone();
          } else {
            toast.error(result.message);
          }
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{draft.existingNumber ? draft.existingNumber : draft.title}</DialogTitle>
        <DialogDescription>
          {draft.existingNumber
            ? "Correcting this keeps the same invoice number."
            : "A number is assigned when you save. Amazon has already collected the payment."}
        </DialogDescription>
      </DialogHeader>

      <fieldset disabled={pending} className="grid gap-5">
        <div className="grid gap-1 text-sm">
          {draft.seller.map((line) => (
            <p key={line.label}>
              <span className="text-muted-foreground">{line.label}. </span>
              {line.value}
            </p>
          ))}
          {draft.missingAddress ? (
            <p className="text-sm">
              Add the registered address in{" "}
              <Link
                href={`/o/${slug}/company`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Company
              </Link>{" "}
              before creating an invoice.
            </p>
          ) : null}
          {draft.registrationNote ? (
            <p className="text-muted-foreground text-xs">{draft.registrationNote}</p>
          ) : null}
        </div>

        {draft.amazonNote ? (
          <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm leading-relaxed">
            {draft.amazonNote}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Buyer name"
            htmlFor="invoice-buyer-name"
            hint="From Amazon, or from their message."
          >
            <Input
              id="invoice-buyer-name"
              value={buyer.name}
              onChange={(event) => set("name")(event.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </Field>
          <Field label="Company" htmlFor="invoice-buyer-company">
            <Input
              id="invoice-buyer-company"
              value={buyer.company}
              onChange={(event) => set("company")(event.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </Field>
          <Field
            label="Tax number"
            htmlFor="invoice-buyer-tax"
            hint="Their TRN or GST/HST number, if they sent one."
          >
            <Input
              id="invoice-buyer-tax"
              value={buyer.taxNumber}
              onChange={(event) => set("taxNumber")(event.target.value)}
              autoComplete="off"
              maxLength={50}
            />
          </Field>
        </div>
        <Field
          label="Address"
          htmlFor="invoice-buyer-address"
          hint="Amazon doesn't share this. Add it if the customer sent it."
        >
          <Textarea
            id="invoice-buyer-address"
            value={buyer.address}
            onChange={(event) => set("address")(event.target.value)}
            autoComplete="off"
            rows={2}
            maxLength={500}
          />
        </Field>

        <ul className="divide-y rounded-xl border text-sm">
          {draft.lines.map((line) => (
            <li
              key={`${line.sku ?? ""}-${line.title}`}
              className="flex items-start justify-between gap-3 px-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="block">{line.title}</span>
                <span className="block text-muted-foreground text-xs">
                  {[line.sku && `SKU ${line.sku}`, `× ${line.quantity}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Amount value={line.amount} currency={draft.currency} locale={locale} />
            </li>
          ))}
        </ul>
        <dl className="grid gap-1.5 text-sm">
          {draft.shipping ? (
            <Total
              label="Shipping"
              value={draft.shipping}
              currency={draft.currency}
              locale={locale}
            />
          ) : null}
          {draft.discounts ? (
            <Total
              label="Discounts"
              value={`-${draft.discounts}`}
              currency={draft.currency}
              locale={locale}
            />
          ) : null}
          {draft.tax ? (
            <Total
              label={draft.tax.label}
              value={draft.tax.amount}
              currency={draft.currency}
              locale={locale}
            />
          ) : null}
          <Total
            label="Order total"
            value={draft.total}
            currency={draft.currency}
            locale={locale}
            strong
          />
          {draft.refunded ? (
            <Total
              label="Refunded"
              value={`-${draft.refunded}`}
              currency={draft.currency}
              locale={locale}
            />
          ) : null}
        </dl>
      </fieldset>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || draft.missingAddress}>
          {pending ? <Spinner /> : null}
          {mode === "create" ? "Create invoice" : "Save invoice"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Total({
  label,
  value,
  currency,
  locale,
  strong = false,
}: {
  label: string;
  value: string;
  currency: string;
  locale: string;
  strong?: boolean;
}) {
  return (
    <div
      className={strong ? "flex justify-between gap-4 font-semibold" : "flex justify-between gap-4"}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <Amount value={value} currency={currency} locale={locale} />
      </dd>
    </div>
  );
}
