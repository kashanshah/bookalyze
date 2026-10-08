"use client";

import { Ban, PackageCheck, Pencil, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { RateField } from "@/components/accounting/rate-field";
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
import {
  cancelPurchaseOrderAction,
  deletePurchaseOrderAction,
  markOrderedAction,
  receiveAction,
} from "./actions";

type Status = "draft" | "ordered" | "partial" | "received" | "cancelled";

/** A confirm step for the actions that can't be taken back. */
function ConfirmButton({
  label,
  title,
  description,
  confirm,
  icon,
  destructive = false,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  confirm: string;
  icon: React.ReactNode;
  destructive?: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={destructive ? "ghost" : "outline"}>
          {icon}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Keep it
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (await onConfirm()) setOpen(false);
              })
            }
          >
            {pending ? <Spinner /> : icon}
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The buttons a purchase order's status allows. */
export function PurchaseOrderActions({
  slug,
  id,
  number,
  status,
  lines,
  today,
  orderDate,
  currency,
  baseCurrency,
  locale,
}: {
  slug: string;
  id: string;
  number: string;
  status: Status;
  lines: { id: string; name: string; quantity: number; received: number }[];
  today: string;
  orderDate: string;
  currency: string;
  baseCurrency: string;
  locale: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const base = `/o/${slug}/inventory/purchase-orders`;

  if (status === "draft") {
    return (
      <div className="flex flex-wrap gap-2">
        <ConfirmButton
          label="Delete"
          title={`Delete ${number}?`}
          description="The draft goes away. Nothing was sent to the supplier yet."
          confirm="Delete draft"
          icon={<Trash2 />}
          destructive
          onConfirm={async () => {
            const result = await deletePurchaseOrderAction(slug, id);
            if (!result.ok) {
              toast.error(result.message);
              return false;
            }
            toast.success(`${number} deleted`);
            router.push(base);
            return true;
          }}
        />
        <Button variant="outline" asChild>
          <Link href={`${base}/${id}/edit`}>
            <Pencil />
            Edit
          </Link>
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await markOrderedAction(slug, id);
              if (!result.ok) return void toast.error(result.message);
              toast.success(`${number} marked as sent`, {
                description: "Record deliveries here as they arrive.",
              });
              router.refresh();
            })
          }
        >
          {pending ? <Spinner /> : <Send />}
          Mark as sent
        </Button>
      </div>
    );
  }

  if (status === "ordered" || status === "partial") {
    return (
      <div className="flex flex-wrap gap-2">
        {status === "ordered" ? (
          <ConfirmButton
            label="Cancel order"
            title={`Cancel ${number}?`}
            description="Use this when the supplier won't deliver it. It stays in your list as cancelled."
            confirm="Cancel order"
            icon={<Ban />}
            destructive
            onConfirm={async () => {
              const result = await cancelPurchaseOrderAction(slug, id);
              if (!result.ok) {
                toast.error(result.message);
                return false;
              }
              toast.success(`${number} cancelled`);
              router.refresh();
              return true;
            }}
          />
        ) : null}
        <ReceiveDialog
          slug={slug}
          id={id}
          number={number}
          lines={lines}
          today={today}
          orderDate={orderDate}
          currency={currency}
          baseCurrency={baseCurrency}
          locale={locale}
        />
      </div>
    );
  }
  return null;
}

function ReceiveDialog({
  slug,
  id,
  number,
  lines,
  today,
  orderDate,
  currency,
  baseCurrency,
  locale,
}: {
  slug: string;
  id: string;
  number: string;
  lines: { id: string; name: string; quantity: number; received: number }[];
  today: string;
  orderDate: string;
  currency: string;
  baseCurrency: string;
  locale: string;
}) {
  const router = useRouter();
  const formId = useId();
  const [rate, setRate] = useState("");
  const open = lines.filter((line) => line.quantity > line.received);
  const remaining = () =>
    Object.fromEntries(open.map((line) => [line.id, String(line.quantity - line.received)]));
  const [isOpen, setOpen] = useState(false);
  const [receivedOn, setReceivedOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>(remaining);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const result = await receiveAction(slug, id, {
        receivedOn,
        notes,
        exchangeRate: currency === baseCurrency ? "" : rate,
        quantities: Object.fromEntries(
          Object.entries(quantities).map(([lineId, qty]) => [lineId, qty.trim() || "0"]),
        ),
      });
      if (!result.ok) {
        setErrors(result.errors ?? {});
        setLineErrors(result.lineErrors ?? {});
        toast.error(result.message);
        return;
      }
      setOpen(false);
      toast.success("Delivery recorded", { description: result.message });
      router.refresh();
    });

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuantities(remaining());
          setReceivedOn(today < orderDate ? orderDate : today);
          setNotes("");
          setErrors({});
          setLineErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PackageCheck />
          Record a delivery
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What arrived for {number}?</DialogTitle>
          <DialogDescription>
            Filled in with everything still to come. Lower a number if only part arrived; the rest
            stays open for the next delivery.
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
          <ul className="grid gap-3">
            {open.map((line) => (
              <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_6rem] items-start gap-3">
                <div className="min-w-0 pt-2">
                  <p className="truncate font-medium text-sm">{line.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {line.quantity - line.received} still to come
                    {line.received ? ` · ${line.received} arrived` : ""}
                  </p>
                </div>
                <div className="grid gap-1">
                  <Input
                    aria-label={`Arrived: ${line.name}`}
                    inputMode="numeric"
                    value={quantities[line.id] ?? ""}
                    onChange={(e) => setQuantities((q) => ({ ...q, [line.id]: e.target.value }))}
                    aria-invalid={Boolean(lineErrors[line.id])}
                    className="text-end tabular-nums"
                  />
                  {lineErrors[line.id] ? (
                    <p className="text-destructive text-xs">{lineErrors[line.id]}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <Field label="Arrived on" htmlFor={`${formId}-date`} error={errors.receivedOn}>
            <Input
              id={`${formId}-date`}
              type="date"
              value={receivedOn}
              min={orderDate}
              onChange={(e) => setReceivedOn(e.target.value)}
            />
          </Field>
          {currency !== baseCurrency ? (
            <RateField
              slug={slug}
              id={`${formId}-rate`}
              currency={currency}
              baseCurrency={baseCurrency}
              date={receivedOn}
              value={rate}
              onChange={setRate}
              error={errors.exchangeRate}
              locale={locale}
            />
          ) : null}
          <Field label="Note (optional)" htmlFor={`${formId}-notes`} error={errors.notes}>
            <Textarea
              id={`${formId}-notes`}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 2 cartons damaged, tracking number"
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner /> : <PackageCheck />}
            Record delivery
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
