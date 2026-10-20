"use client";

import { ClipboardCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
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
import { addStockCountAction, removeStockCountAction } from "./actions";

/** How many of a product you hold yourself (with you, at a 3PL), and the day you counted. */
export function StockCountDialog({
  slug,
  productId,
  productName,
  today,
  current,
}: {
  slug: string;
  productId: string;
  productName: string;
  today: string;
  current: number | null;
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [countedOn, setCountedOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const result = await addStockCountAction(slug, { productId, quantity, countedOn, notes });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("Count saved", { description: "It's what you hold at hand from now on." });
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuantity(current === null ? "" : String(current));
          setCountedOn(today);
          setNotes("");
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        {current === null ? (
          <Button variant="ghost" size="sm" aria-label={`Count ${productName} at hand`}>
            <ClipboardCheck />
            Count
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Recount ${productName} at hand`}
            title="Recount"
          >
            <ClipboardCheck />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stock at hand</DialogTitle>
          <DialogDescription>
            How many of {productName} you hold yourself: with you, at a warehouse or a 3PL, not at
            Amazon or Noon. It's compared with your books; it doesn't change them.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
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
          <Field label="Counted on" htmlFor={`${formId}-date`} error={errors.countedOn}>
            <Input
              id={`${formId}-date`}
              type="date"
              value={countedOn}
              onChange={(e) => setCountedOn(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note (optional)" htmlFor={`${formId}-notes`} error={errors.notes}>
              <Input
                id={`${formId}-notes`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Home storage, 3PL warehouse"
              />
            </Field>
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner /> : <ClipboardCheck />}
            Save count
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Removes the latest count (made by mistake); the one before it, if any, counts again. */
export function RemoveStockCount({
  slug,
  productId,
  countId,
  label,
}: {
  slug: string;
  productId: string;
  countId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      aria-label={`Remove the count of ${label}`}
      onClick={() =>
        start(async () => {
          const result = await removeStockCountAction(slug, { productId, countId });
          if (!result.ok) return void toast.error(result.message);
          toast.success("Count removed");
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <Trash2 />}
    </Button>
  );
}
