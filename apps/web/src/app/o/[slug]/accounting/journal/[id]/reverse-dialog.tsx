"use client";

import { Undo2 } from "lucide-react";
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
import { reverseJournalEntryAction } from "../../actions";

/** Posted entries can't be edited; reversing posts an equal and opposite entry. */
export function ReverseDialog({
  slug,
  entryId,
  entryNumber,
  today,
}: {
  slug: string;
  entryId: string;
  entryNumber: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Undo2 />
          Reverse
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await reverseJournalEntryAction(slug, entryId, date);
              if (result.ok) {
                toast.success(`${entryNumber} reversed by ${result.data.number}`);
                setOpen(false);
                router.push(`/o/${slug}/accounting/journal/${result.data.id}`);
              } else {
                setError(result.errors?.date);
                if (result.message) toast.error(result.message);
              }
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Reverse {entryNumber}?</DialogTitle>
            <DialogDescription>
              Posted entries are never edited or deleted, so your history stays trustworthy.
              Reversing posts a new entry with every debit and credit swapped, cancelling this one
              out. You can then post a corrected entry.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Date of the reversal"
            htmlFor="reverse-date"
            error={error}
            hint="Usually today, or the same date as the original to undo it in that period."
          >
            <Input
              id="reverse-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Keep entry
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : <Undo2 />}
              Reverse entry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
