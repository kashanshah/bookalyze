"use client";

import { Trash2 } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { deleteTransactionAction } from "../../transactions/actions";

/**
 * Deleting an entry, the way you'd expect: it disappears from your books. Underneath it's
 * reversed on its own date (posted entries are never erased), exactly like removing a
 * transaction.
 */
export function DeleteDialog({
  slug,
  entryId,
  entryNumber,
}: {
  slug: string;
  entryId: string;
  entryNumber: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const remove = () =>
    startTransition(async () => {
      const result = await deleteTransactionAction(slug, entryId);
      if (!result.ok) return void toast.error(result.message);
      toast.success(`${entryNumber} deleted`, {
        description: "Your reports no longer include it.",
      });
      setOpen(false);
      router.push(`/o/${slug}/accounting/journal`);
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Trash2 />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {entryNumber}?</DialogTitle>
          <DialogDescription>
            It's taken out of your books and reports. A record that it was deleted stays in the
            history, so your accountant can always see what happened.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
            {pending ? <Spinner /> : <Trash2 />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
