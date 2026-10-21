"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** An email address to forward to, with a Copy button. */
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
