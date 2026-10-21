"use client";

import { ExternalLink } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { openPortalAction } from "./actions";

/** Stripe's customer portal: card, invoices, change or cancel the plan. */
export function PortalButton({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await openPortalAction(slug);
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          window.location.assign(result.url);
        })
      }
    >
      {pending ? <Spinner /> : <ExternalLink />}
      Manage billing
    </Button>
  );
}
