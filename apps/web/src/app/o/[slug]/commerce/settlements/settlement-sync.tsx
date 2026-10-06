"use client";

import { parseSettlementReport } from "@bookalyze/core";
import { FileUp, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { syncSettlementsAction, uploadSettlementAction } from "./actions";

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
 * Adds settlements from Amazon's flat files (older periods than the Reports API lists). Each
 * file is read here in the browser; only the settlement's totals are sent.
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
        let settlement: ReturnType<typeof parseSettlementReport>;
        try {
          settlement = parseSettlementReport(await file.text());
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
