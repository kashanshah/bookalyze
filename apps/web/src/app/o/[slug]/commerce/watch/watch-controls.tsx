"use client";

import { Pause, Play, RefreshCw, Trash2 } from "lucide-react";
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
import {
  checkListingWatchAction,
  deleteListingWatchAction,
  pauseListingWatchAction,
} from "./actions";

export function CheckNowButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await checkListingWatchAction(slug, id);
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          toast.success("Checked with Amazon", {
            description:
              result.changed === 0
                ? "Nothing changed since the last look."
                : result.changed === 1
                  ? "One thing changed."
                  : `${result.changed} things changed.`,
          });
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : <RefreshCw />}
      Check now
    </Button>
  );
}

export function PauseWatchButton({
  slug,
  id,
  paused,
}: {
  slug: string;
  id: string;
  paused: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await pauseListingWatchAction(slug, id, !paused);
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          toast.success(paused ? "Checks resumed" : "Checks paused");
          router.refresh();
        })
      }
    >
      {pending ? <Spinner /> : paused ? <Play /> : <Pause />}
      {paused ? "Resume" : "Pause"}
    </Button>
  );
}

export function StopWatchButton({ slug, id, name }: { slug: string; id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Trash2 />
          Stop watching
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop watching {name}?</DialogTitle>
          <DialogDescription>
            Checks and emails stop. The history of changes already found is removed. You can watch
            it again later, and the next look starts fresh.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Keep watching
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteListingWatchAction(slug, id);
                if (!result.ok) {
                  toast.error(result.message);
                  return;
                }
                toast.success("Stopped watching");
                router.push(`/o/${slug}/commerce/watch`);
              })
            }
          >
            {pending ? <Spinner /> : <Trash2 />}
            Stop watching
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
