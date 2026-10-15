"use client";

import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { changeDeliveryDateAction } from "../../../actions";

/** Fixes the day a delivery arrived, when it was recorded on the wrong one. */
export function DeliveryDateDialog({
  slug,
  receiptId,
  receivedOn,
  orderDate,
  today,
}: {
  slug: string;
  receiptId: string;
  receivedOn: string;
  orderDate: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(receivedOn);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setDate(receivedOn);
          setError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <CalendarClock />
          Change arrival date
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            start(async () => {
              const result = await changeDeliveryDateAction(slug, receiptId, { receivedOn: date });
              if (!result.ok) {
                if (result.errors?.receivedOn) setError(result.errors.receivedOn);
                else setError(result.message);
                return;
              }
              toast.success("Arrival date changed", { description: result.message });
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>When did this delivery arrive?</DialogTitle>
            <DialogDescription>
              Its stock lots count from this day, so sales from then on can use them. If the order
              is in your books, its entry into Inventory moves to this day too.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Arrived on"
            htmlFor="delivery-received-on"
            hint="The day the stock reached you or Amazon's warehouse. The exchange rate and costs stay as they are; change them below if they should too."
            error={error}
          >
            <Input
              id="delivery-received-on"
              type="date"
              value={date}
              min={orderDate}
              max={today}
              onChange={(e) => {
                setDate(e.target.value);
                setError(undefined);
              }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !date || date === receivedOn}>
              {pending ? <Spinner /> : null}
              Change date
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
