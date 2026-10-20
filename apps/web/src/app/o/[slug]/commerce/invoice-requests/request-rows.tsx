"use client";

import { Check, Copy, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setInvoiceRequestStatusAction } from "../orders/[id]/invoice-actions";

export function CopyAddress({ address }: { address: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy. Select the address and copy it.");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 break-all rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm">
        {address}
      </code>
      <Button size="sm" variant="outline" onClick={copy}>
        <Copy />
        Copy
      </Button>
    </div>
  );
}

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
