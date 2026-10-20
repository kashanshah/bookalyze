"use client";

import {
  isTransactionReport,
  parseSettlementReport,
  parseTransactionReport,
  parseTransactionReportOrders,
} from "@bookalyze/core";
import { FileUp, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  syncSettlementsAction,
  uploadReportOrdersAction,
  uploadReportSettlementsAction,
  uploadSettlementAction,
} from "./actions";

/** At most this many calls per click: the rest comes in with the daily job. */
const MAX_ROUNDS = 6;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Bring in settlements": asks Amazon for new settlement reports until it has no more. */
export function SyncSettlementsButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      let added = 0;
      let unreadable = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await syncSettlementsAction(slug);
        if (!result.ok) {
          toast.error(result.message);
          break;
        }
        added += result.added;
        unreadable += result.unreadable;
        router.refresh();
        if (result.error) {
          toast.error(result.error);
          break;
        }
        if (!result.more) {
          toast.success(
            added ? `${plural(added, "settlement")} brought in` : "Your settlements are up to date",
            unreadable ? { description: `${plural(unreadable, "report")} couldn't be read.` } : {},
          );
          break;
        }
        setProgress(`Bringing in settlements… ${added} so far`);
        if (round === MAX_ROUNDS - 1) {
          toast.info("Amazon is rationing its answers: the rest comes in with the daily sync.");
        }
      }
      setProgress(null);
    });

  return (
    <div className="flex items-center gap-3">
      {progress ? (
        <span className="fade-in-0 hidden animate-in text-muted-foreground text-sm sm:inline">
          {progress}
        </span>
      ) : null}
      <Button variant="outline" onClick={run} disabled={pending}>
        {pending ? <Spinner /> : <RefreshCw />}
        {pending ? "Bringing in…" : "Bring in settlements"}
      </Button>
    </div>
  );
}

/**
 * Amazon's date range transaction report: every settlement in it, sent a part at a time. The
 * newest one is left out while it has no payout yet (it may still be open); ones already here
 * are kept as they are.
 */
async function addTransactionReport(
  slug: string,
  name: string,
  text: string,
): Promise<{ added: number; updated: number }> {
  let settlements: ReturnType<typeof parseTransactionReport>;
  try {
    settlements = parseTransactionReport(text);
  } catch (error) {
    toast.error(`${name}: ${(error as Error).message}`);
    return { added: 0, updated: 0 };
  }
  const newest = settlements.at(-1);
  const open = newest && !newest.depositDate ? newest : null;
  const ready = settlements.filter((s) => s !== open && s.currency);
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let posted = 0;
  for (let i = 0; i < ready.length; i += 20) {
    const result = await uploadReportSettlementsAction(slug, ready.slice(i, i + 20));
    if (!result.ok) {
      toast.error(`${name}: ${result.message}`);
      return { added, updated };
    }
    added += result.added;
    updated += result.updated;
    skipped += result.skipped;
    posted += result.posted;
  }
  // Its orders too: for the years Amazon's Orders API no longer reaches, so cost of goods sold
  // counts them. Orders already here (from the API) stay as they are.
  let orders = 0;
  for (const group of parseTransactionReportOrders(text)) {
    for (let i = 0; i < group.orders.length; i += 250) {
      const result = await uploadReportOrdersAction(slug, {
        marketplace: group.marketplace,
        currency: group.currency,
        orders: group.orders.slice(i, i + 250),
      });
      if (!result.ok) {
        toast.error(`${name}: ${result.message}`);
        break;
      }
      orders += result.added;
    }
  }
  const notes = [
    orders ? `${plural(orders, "older order")} added for cost of goods sold.` : null,
    skipped ? `${plural(skipped, "settlement")} already here, kept as they were.` : null,
    posted
      ? `${plural(posted, "settlement")} in the books read differently now (what Amazon held back). Take them out of the books, then upload the report again.`
      : null,
    open ? "The newest one is still open: it comes in once Amazon closes it." : null,
  ].filter(Boolean);
  if (!added && !updated && !orders) {
    toast.info(`${name}: nothing new`, notes.length ? { description: notes.join(" ") } : {});
  } else if (notes.length) {
    toast.info(`${name}: ${plural(added, "settlement")} from the transaction report`, {
      description: notes.join(" "),
    });
  }
  return { added, updated };
}

/**
 * Adds settlements from Amazon's flat files (older periods than the Reports API lists), or all
 * at once from its date range transaction report. Each file is read here in the browser; only
 * the settlements' totals are sent.
 */
export function UploadSettlements({ slug }: { slug: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  const upload = (files: FileList | null) =>
    start(async () => {
      let added = 0;
      let updated = 0;
      for (const file of Array.from(files ?? [])) {
        const text = await file.text();
        if (isTransactionReport(text)) {
          const report = await addTransactionReport(slug, file.name, text);
          added += report.added;
          updated += report.updated;
          continue;
        }
        let settlement: ReturnType<typeof parseSettlementReport>;
        try {
          settlement = parseSettlementReport(text);
        } catch (error) {
          toast.error(`${file.name}: ${(error as Error).message}`);
          continue;
        }
        const result = await uploadSettlementAction(slug, settlement);
        if (!result.ok) {
          toast.error(`${file.name}: ${result.message}`);
          continue;
        }
        if (result.created) added++;
        else updated++;
        if (!settlement.balanced) {
          toast.warning(`${file.name}: its lines don't add up to the payout. Check the file.`);
        }
      }
      if (input.current) input.current.value = "";
      router.refresh();
      if (added || updated) {
        toast.success(
          added ? `${plural(added, "settlement")} added` : "Settlements brought up to date",
          updated && added ? { description: `${plural(updated, "settlement")} updated.` } : {},
        );
      }
    });

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values"
        multiple
        className="hidden"
        aria-label="Settlement files"
        onChange={(e) => upload(e.target.files)}
      />
      <Button variant="ghost" onClick={() => input.current?.click()} disabled={pending}>
        {pending ? <Spinner /> : <FileUp />}
        {pending ? "Adding…" : "Upload settlement files"}
      </Button>
    </>
  );
}
