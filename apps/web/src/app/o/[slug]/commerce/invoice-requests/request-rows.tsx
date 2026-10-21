"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setInvoiceRequestStatusAction } from "../orders/[id]/invoice-actions";

export function RequestActions({
  slug,
  requestId,
  status,
}: {
  slug: string;
  requestId: string;
  status: "open" | "done" | "dismissed";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (next: "open" | "done" | "dismissed") =>
    start(async () => {
      const result = await setInvoiceRequestStatusAction(slug, requestId, next);
      if (!result.ok) toast.error(result.message);
      else router.refresh();
    });
  if (status !== "open") {
    return (
      <Button size="sm" variant="ghost" onClick={() => set("open")} disabled={pending}>
        <RotateCcw />
        Reopen
      </Button>
    );
  }
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => set("done")} disabled={pending}>
        <Check />
        Answered
      </Button>
      <Button size="sm" variant="ghost" onClick={() => set("dismissed")} disabled={pending}>
        <X />
        Dismiss
      </Button>
    </>
  );
}
