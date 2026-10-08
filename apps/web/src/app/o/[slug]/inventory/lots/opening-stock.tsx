"use client";

import { PackagePlus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
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
import { addOpeningStockAction, removeOpeningStockAction } from "../cogs/actions";

/** Stock on hand before Bookalyze: product, how many, what one cost, and when it was counted. */
export function OpeningStockDialog({
  slug,
  products,
  baseCurrency,
  today,
}: {
  slug: string;
  products: { id: string; name: string; sku: string | null }[];
  baseCurrency: string;
  today: string;
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const result = await addOpeningStockAction(slug, {
        productId,
        quantity,
        unitCost,
        date,
        notes,
      });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("Opening stock added", {
        description: "It's a stock lot now, and in your books as inventory.",
      });
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setProductId("");
          setQuantity("");
          setUnitCost("");
          setDate(today);
          setNotes("");
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <PackagePlus />
          Add opening stock
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stock you already had</DialogTitle>
          <DialogDescription>
            What was on hand (at Amazon or with you) before you started recording deliveries here.
            It becomes a stock lot, and is booked as inventory against opening balance equity.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label="Product" htmlFor={`${formId}-product`} error={errors.productId}>
            <Combobox
              id={`${formId}-product`}
              value={productId}
              onChange={setProductId}
              placeholder="Choose a product…"
              searchPlaceholder="Search products"
              invalid={Boolean(errors.productId)}
              options={products.map((p) => ({
                value: p.id,
                label: p.name,
                keywords: p.sku ?? undefined,
                description: p.sku ? `Your SKU ${p.sku}` : undefined,
              }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How many" htmlFor={`${formId}-qty`} error={errors.quantity}>
              <Input
                id={`${formId}-qty`}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.trim())}
                aria-invalid={Boolean(errors.quantity)}
                className="tabular-nums"
              />
            </Field>
            <Field
              label={`Cost of one (${baseCurrency})`}
              htmlFor={`${formId}-cost`}
              error={errors.unitCost}
              hint="What one cost you, landed."
            >
              <Input
                id={`${formId}-cost`}
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value.trim())}
                placeholder="0.00"
                aria-invalid={Boolean(errors.unitCost)}
                className="tabular-nums"
              />
            </Field>
          </div>
          <Field
            label="Counted on"
            htmlFor={`${formId}-date`}
            error={errors.date}
            hint="Use the day before your first sales here are costed, e.g. the last day of a month."
          >
            <Input
              id={`${formId}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Note (optional)" htmlFor={`${formId}-notes`} error={errors.notes}>
            <Input
              id={`${formId}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. FBA inventory count"
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner /> : <PackagePlus />}
            Add stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Removes an opening lot nothing has been sold from. */
export function RemoveOpeningStock({
  slug,
  lotId,
  label,
}: {
  slug: string;
  lotId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      aria-label={`Remove ${label}`}
      onClick={() =>
        start(async () => {
          const result = await removeOpeningStockAction(slug, lotId);
          if (!result.ok) return void toast.error(result.message);
          toast.success("Opening stock removed", { description: "Its entry was reversed." });
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <Trash2 />}
    </Button>
  );
}
