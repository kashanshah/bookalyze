"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { setContactArchivedAction } from "../actions";

export function ArchiveContactButton({
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
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setContactArchivedAction(slug, id, !archived);
          if (result.ok) toast.success(archived ? `${name} restored` : `${name} archived`);
          else toast.error(result.message);
        })
      }
    >
      {pending ? <Spinner /> : archived ? <ArchiveRestore /> : <Archive />}
      {archived ? "Restore" : "Archive"}
    </Button>
  );
}
