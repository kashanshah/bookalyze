"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { setGettingStartedHiddenAction } from "./settings/general/actions";

/** Hides the setup checklist on this company's home page. */
export function HideGettingStarted({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setGettingStartedHiddenAction(slug, true);
          if (result.ok) toast.success("Setup steps hidden");
          else toast.error(result.message);
        })
      }
      className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-muted-foreground text-sm hover:text-foreground disabled:opacity-60"
    >
      {pending ? <Spinner className="size-3.5" /> : null}
      Hide
    </button>
  );
}
