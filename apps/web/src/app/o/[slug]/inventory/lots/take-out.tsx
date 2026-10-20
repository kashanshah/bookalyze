"use client";

import { ArrowRightLeft, PackageMinus, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
import { moveStockAction, putBackInStockAction, takeOutOfStockAction } from "../cogs/actions";

/**
 * Takes units out of a lot by hand: sold or used outside the marketplaces, taken by the owner,
 * lost or thrown away. Its cost goes to the account chosen, at the lot's cost.
 */
export function TakeOutDialog({
  slug,
  lotId,
  left,
  label,
  receivedOn,
  today,
  accounts,
  defaultAccountId,
}: {
  slug: string;
  lotId: string;
  left: number;
  label: string;
  receivedOn: string;
  today: string;
  accounts: ComboboxOption[];
  defaultAccountId: string;
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(String(left));
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const result = await takeOutOfStockAction(slug, { lotId, quantity, date, accountId, notes });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("Taken out of stock", {
        description: "The units left the lot, and their cost is in your books.",
      });
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuantity(String(left));
          setDate(today);
          setAccountId(defaultAccountId);
          setNotes("");
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Take units out of ${label}`}>
          <PackageMinus />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take out of stock</DialogTitle>
          <DialogDescription>
            For units that left without a marketplace sale: sold or used elsewhere, taken by you,
            lost or thrown away. They leave {label} at its cost, booked to the account you choose.
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="How many"
              htmlFor={`${formId}-qty`}
              error={errors.quantity}
              hint={`${left} left in this lot.`}
            >
              <Input
                id={`${formId}-qty`}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.trim())}
                aria-invalid={Boolean(errors.quantity)}
                className="tabular-nums"
              />
            </Field>
            <Field label="When they left" htmlFor={`${formId}-date`} error={errors.date}>
              <Input
                id={`${formId}-date`}
                type="date"
                min={receivedOn}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={Boolean(errors.date)}
              />
            </Field>
          </div>
          <Field
            label="Where the cost goes"
            htmlFor={`${formId}-account`}
            error={errors.accountId}
            hint="Owner drawings if you took or sold them yourself; Inventory losses and write-offs if they were lost or thrown away."
          >
            <Combobox
              id={`${formId}-account`}
              value={accountId}
              onChange={setAccountId}
              placeholder="Choose an account…"
              searchPlaceholder="Search accounts"
              searchable
              invalid={Boolean(errors.accountId)}
              options={accounts}
            />
          </Field>
          <Field label="Note (optional)" htmlFor={`${formId}-notes`} error={errors.notes}>
            <Input
              id={`${formId}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Sold at cost outside Amazon"
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner /> : <PackageMinus />}
            Take out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Moves units from a lot to the product they really are (a label or listing mixed up): a new lot
 * there at the same cost. Nothing posts: it's stock either way.
 */
export function MoveStockDialog({
  slug,
  lotId,
  left,
  label,
  productName,
  receivedOn,
  today,
  products,
}: {
  slug: string;
  lotId: string;
  left: number;
  label: string;
  productName: string;
  receivedOn: string;
  today: string;
  products: ComboboxOption[];
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(String(left));
  const [date, setDate] = useState(today);
  const [productId, setProductId] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const result = await moveStockAction(slug, { lotId, quantity, date, productId, notes });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("Moved to the other product", {
        description: "A new lot there carries them, at the same cost.",
      });
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuantity(String(left));
          setDate(today);
          setProductId("");
          setNotes("");
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Move units from ${label} to another product`}
        >
          <ArrowRightLeft />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to another product</DialogTitle>
          <DialogDescription>
            For units that are really another product: a label or a listing mixed up. They leave{" "}
            {label} of {productName} and become a lot of the product you choose, at the same cost.
            Nothing is posted: it's stock either way.
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
          <Field
            label="The product they really are"
            htmlFor={`${formId}-product`}
            error={errors.productId}
          >
            <Combobox
              id={`${formId}-product`}
              value={productId}
              onChange={setProductId}
              placeholder="Choose a product…"
              searchPlaceholder="Search products"
              searchable
              invalid={Boolean(errors.productId)}
              options={products}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="How many"
              htmlFor={`${formId}-qty`}
              error={errors.quantity}
              hint={`${left} left in this lot.`}
            >
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
              label="From"
              htmlFor={`${formId}-date`}
              error={errors.date}
              hint="Sales of the other product use them from this day."
            >
              <Input
                id={`${formId}-date`}
                type="date"
                min={receivedOn}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={Boolean(errors.date)}
              />
            </Field>
          </div>
          <Field label="Note (optional)" htmlFor={`${formId}-notes`} error={errors.notes}>
            <Input
              id={`${formId}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Labelled as the 8.5 oz pair"
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner /> : <ArrowRightLeft />}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Puts units taken out by hand back into their lot, reversing the entry. */
export function PutBackInStock({
  slug,
  removalId,
  label,
}: {
  slug: string;
  removalId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`Put back ${label}`}
      onClick={() =>
        start(async () => {
          const result = await putBackInStockAction(slug, removalId);
          if (!result.ok) return void toast.error(result.message);
          toast.success("Put back in stock", { description: "Its entry was reversed." });
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <Undo2 />}
      Put back
    </Button>
  );
}
