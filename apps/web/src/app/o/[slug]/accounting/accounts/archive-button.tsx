"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { setAccountArchivedAction } from "../actions";

/** Archive hides an account from pickers but keeps its history on reports. */
export function ArchiveButton({
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
          const result = await setAccountArchivedAction(slug, id, !archived);
          if (result.ok) toast.success(archived ? `${name} restored` : `${name} archived`);
          else toast.error(result.message ?? "Something went wrong");
        })
      }
    >
      {pending ? <Spinner /> : archived ? <ArchiveRestore /> : <Archive />}
    </Button>
  );
}
