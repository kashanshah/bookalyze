"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { syncEbayMoneyAction } from "./actions";

/** Calls per click (about 25 seconds each); what's left carries on with the next click. */
const MAX_ROUNDS = 40;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "Bring in from eBay": a year of eBay's money rows, a month at a time, until caught up. */
export function SyncEbayMoneyButton({ slug, locale }: { slug: string; locale: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      let added = 0;
      let updated = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await syncEbayMoneyAction(slug);
        if (!result.ok) {
          toast.error(result.message);
          break;
        }
        added += result.added;
        updated += result.updated;
        router.refresh();
        if (result.error) {
          toast.error(result.error);
          break;
        }
        if (!result.more) {
          toast.success(
            added ? `${plural(added, "transaction")} brought in` : "eBay's money is up to date",
            { description: updated ? `${plural(updated, "transaction")} refreshed.` : undefined },
          );
          break;
        }
        setProgress(
          result.through
            ? `In through ${formatDate(result.through, locale)}…`
            : `${plural(added, "transaction")} so far…`,
        );
        if (round === MAX_ROUNDS - 1) {
          toast.info("There's more: click again to carry on where this stopped.");
        }
      }
      setProgress(null);
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {progress ? (
        <span
          className="fade-in-0 order-last w-full animate-in text-muted-foreground text-sm sm:order-none sm:w-auto"
          aria-live="polite"
        >
          {progress}
        </span>
      ) : null}
      <Button onClick={run} disabled={pending}>
        {pending ? <Spinner /> : <RefreshCw />}
        {pending ? "Bringing in…" : "Bring in from eBay"}
      </Button>
    </div>
  );
}
