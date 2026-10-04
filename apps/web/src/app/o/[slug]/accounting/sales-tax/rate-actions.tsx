"use client";

import type { TaxPack } from "@bookalyze/core";
import { Archive, ArchiveRestore, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { setTaxRateArchivedAction } from "./actions";
import { PackPicker } from "./pack-setup";

/** Archiving hides a rate from the transaction form; older transactions keep it. */
export function ArchiveRateButton({
  slug,
  id,
  name,
  archived,
}: {
  slug: string;
  id: string;
  name: string;
  archived: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={pending}
      aria-label={archived ? `Restore ${name}` : `Archive ${name}`}
      title={archived ? "Restore" : "Archive"}
      onClick={() =>
        startTransition(async () => {
          const result = await setTaxRateArchivedAction(slug, id, !archived);
          if (result.ok) toast.success(archived ? `${name} restored` : `${name} archived`);
          else toast.error(result.message ?? "Something went wrong");
        })
      }
    >
      {pending ? <Spinner /> : archived ? <ArchiveRestore /> : <Archive />}
    </Button>
  );
}

/** The country's standard rates, for adding more after the first setup. */
export function PackDialog({
  slug,
  pack,
  suggested,
  existing,
}: {
  slug: string;
  pack: TaxPack;
  suggested: string[];
  existing: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles />
          Standard rates
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pack.label}</DialogTitle>
          <DialogDescription>Ready-made rates. Tick the ones you charge or pay.</DialogDescription>
        </DialogHeader>
        {open ? (
          <PackPicker
            slug={slug}
            pack={pack}
            suggested={suggested}
            existing={existing}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
