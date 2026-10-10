"use client";

import { type AlibabaDraft, alibabaPurchaseDraft, readAlibabaReceipt } from "@bookalyze/core";
import { FileText, ListChecks, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { readPdfItems } from "@/lib/pdf-items";
import { cn } from "@/lib/utils";
import { type LineHint, type PurchaseOrderDefaults, PurchaseOrderForm } from "../po-form";

type FormProps = Omit<
  React.ComponentProps<typeof PurchaseOrderForm>,
  "defaults" | "suggestedSupplier" | "lineHints"
>;

/**
 * A new purchase order, typed in or filled from a supplier's receipt (Alibaba.com for now). The
 * receipt is read in the browser and only fills the form: nothing is saved until the order is
 * checked and saved as a draft.
 */
export function NewPurchaseOrder({
  defaults,
  ...props
}: FormProps & { defaults: PurchaseOrderDefaults }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filled, setFilled] = useState<{ file: string; draft: AlibabaDraft; n: number } | null>(
    null,
  );

  const read = async (file: File | undefined) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Choose the receipt as a PDF.");
      return;
    }
    setReading(true);
    try {
      const result = readAlibabaReceipt(await readPdfItems(file));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const draft = alibabaPurchaseDraft(result.receipt, {
        suppliers: props.suppliers,
        products: props.products,
      });
      setFilled((last) => ({ file: file.name, draft, n: (last?.n ?? 0) + 1 }));
      toast.success("Filled in from the receipt", {
        description: "Check it, then save it as a draft. Nothing is saved yet.",
      });
    } catch {
      toast.error("This PDF couldn't be read. Try downloading the receipt again.");
    } finally {
      setReading(false);
    }
  };

  const draft = filled?.draft;
  const formDefaults: PurchaseOrderDefaults = draft
    ? {
        supplierId: draft.supplierId,
        currency: props.currencies.some((c) => c.code === draft.currency)
          ? draft.currency
          : defaults.currency,
        orderDate: draft.orderDate ?? defaults.orderDate,
        expectedDate: null,
        reference: draft.reference,
        notes: draft.notes,
        lines: draft.lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitCost: l.unitCost,
        })),
      }
    : defaults;
  const hints: LineHint[] =
    draft?.lines.map((l) => ({ description: l.description, note: l.note })) ?? [];

  return (
    <div className="grid gap-6">
      {filled && draft ? (
        <section
          aria-label="Filled in from a receipt"
          className="fade-in-0 slide-in-from-top-1 grid animate-in gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ListChecks className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">Filled in from {filled.file}</p>
              <p className="text-muted-foreground text-sm">
                Check everything below, change what's needed, then save it as a draft. Nothing is
                saved yet.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => input.current?.click()}
              disabled={reading}
            >
              {reading ? <Spinner /> : <FileText />}
              Another receipt
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Start over without the receipt"
              onClick={() => setFilled(null)}
            >
              <X />
            </Button>
          </div>
          {draft.checks.length ? (
            <ul className="grid gap-1.5 ps-12 text-sm">
              {draft.checks.map((check) => (
                <li key={check} className="list-disc marker:text-primary">
                  {check}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void read(e.dataTransfer.files[0]);
          }}
          disabled={reading}
          className={cn(
            "flex items-center gap-4 rounded-2xl border-2 border-dashed bg-card px-5 py-4 text-start transition-colors hover:border-primary/40 hover:bg-primary/5",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {reading ? <Spinner /> : <FileText className="size-5" />}
          </span>
          <span className="grid gap-0.5">
            <span className="font-medium">Fill in from an Alibaba receipt</span>
            <span className="text-muted-foreground text-sm">
              Drop the receipt PDF from the Alibaba.com order here, or tap to choose it. You check
              everything before it's saved.
            </span>
          </span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Alibaba receipt (PDF)"
        onChange={(e) => {
          void read(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <PurchaseOrderForm
        key={filled?.n ?? 0}
        {...props}
        defaults={formDefaults}
        suggestedSupplier={draft?.newSupplier ?? null}
        lineHints={hints}
      />
    </div>
  );
}
