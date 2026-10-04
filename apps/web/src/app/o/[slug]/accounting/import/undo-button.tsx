"use client";

import { Undo2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { undoImportAction } from "./actions";

/** Removes everything an import added. Asks for a second click first. */
export function UndoImportButton({ slug, batchId }: { slug: string; batchId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <Button
      type="button"
      size="sm"
      variant={confirming ? "destructive" : "ghost"}
      disabled={pending}
      onClick={() => {
        if (!confirming) return setConfirming(true);
        startTransition(async () => {
          const result = await undoImportAction(slug, batchId);
          if (result.ok) {
            toast.success(`Import undone: ${result.removed.toLocaleString()} transactions removed`);
          } else toast.error(result.message);
          setConfirming(false);
        });
      }}
    >
      {pending ? <Spinner /> : <Undo2 />}
      {confirming ? "Click again to remove everything it added" : "Undo import"}
    </Button>
  );
}
