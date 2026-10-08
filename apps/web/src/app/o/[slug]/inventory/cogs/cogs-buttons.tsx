"use client";

import { BookCheck, Undo2 } from "lucide-react";
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
import { postCogsAction, undoCogsAction } from "./actions";

/** Posts one marketplace's month to the books. */
export function PostMonthButton({
  slug,
  channelId,
  month,
  label,
}: {
  slug: string;
  channelId: string;
  month: string;
  /** e.g. "September 2026 on Amazon.ca". */
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      aria-label={`Post ${label}`}
      onClick={() =>
        start(async () => {
          const result = await postCogsAction(slug, { channelId, month });
          if (!result.ok) return void toast.error(result.message);
          toast.success(`${label} posted`, {
            description: "Cost of goods sold is in the books, and those units left their lots.",
          });
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <BookCheck />}
      Post
    </Button>
  );
}

/** Undoes the latest posted month, after a confirm. */
export function UndoMonthButton({
  slug,
  periodId,
  label,
}: {
  slug: string;
  periodId: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Undo ${label}`}>
          <Undo2 />
          Undo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Undo {label}?</DialogTitle>
          <DialogDescription>
            Its entry is reversed and its units go back to their stock lots. Post it again once
            you've fixed what you needed to (a missing delivery, a cost, a link).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await undoCogsAction(slug, periodId);
                if (!result.ok) return void toast.error(result.message);
                setOpen(false);
                toast.success(`${label} undone`);
                router.refresh();
              })
            }
          >
            {pending ? <Spinner /> : <Undo2 />}
            Undo month
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
