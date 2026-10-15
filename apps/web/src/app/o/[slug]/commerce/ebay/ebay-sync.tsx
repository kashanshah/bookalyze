"use client";

import { parseEbayTransactionReport } from "@bookalyze/core";
import { FileUp, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { syncEbayMoneyAction, uploadEbayReportAction } from "./actions";

/** Rows sent per call when uploading. */
const UPLOAD_ROWS = 1_000;
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
      let payouts = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await syncEbayMoneyAction(slug);
        if (!result.ok) {
          toast.error(result.message);
          break;
        }
        added += result.added;
        updated += result.updated;
        payouts += result.payouts;
        router.refresh();
        if (result.error) {
          toast.error(result.error);
          break;
        }
        if (!result.more) {
          const also = [
            payouts ? `${plural(payouts, "payout")} brought in.` : "",
            updated ? `${plural(updated, "transaction")} refreshed.` : "",
          ].filter(Boolean);
          toast.success(
            added ? `${plural(added, "transaction")} brought in` : "eBay's money is up to date",
            { description: also.length ? also.join(" ") : undefined },
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

/**
 * Adds eBay's transaction report from a file (Seller Hub → Payments → Reports → Transaction
 * report). The file is read here in the browser; its rows are sent in parts.
 */
export function UploadEbayReport({
  slug,
  variant = "ghost",
}: {
  slug: string;
  variant?: "ghost" | "outline";
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);

  const upload = (files: FileList | null) =>
    start(async () => {
      for (const file of Array.from(files ?? [])) {
        const parsed = parseEbayTransactionReport(await file.text());
        if (!parsed.ok) {
          toast.error(`${file.name}: ${parsed.error}`);
          continue;
        }
        const { transactions: rows, payouts } = parsed;
        if (!rows.length && !payouts.length) {
          toast.error(`${file.name}: there are no transactions in it.`);
          continue;
        }
        let added = 0;
        let fromApi = 0;
        let newPayouts = 0;
        let failed: string | null = null;
        for (let i = 0; i === 0 || i < rows.length; i += UPLOAD_ROWS) {
          setProgress(
            `Adding ${file.name}… ${Math.min(i, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}`,
          );
          const result = await uploadEbayReportAction(slug, {
            fileName: file.name.slice(0, 200),
            rows: rows.slice(i, i + UPLOAD_ROWS),
            payouts: i === 0 ? payouts : [],
          });
          if (!result.ok) {
            failed = result.message;
            break;
          }
          added += result.added;
          fromApi += result.fromApi;
          newPayouts += result.payouts;
        }
        if (failed) {
          toast.error(`${file.name}: ${failed}`, {
            description: added
              ? `${plural(added, "transaction")} were added before it stopped.`
              : undefined,
          });
          continue;
        }
        toast.success(
          added || newPayouts
            ? `${file.name}: ${plural(added, "transaction")} added`
            : `${file.name} is already in`,
          {
            description:
              [
                newPayouts ? `${plural(newPayouts, "payout")} added.` : null,
                fromApi
                  ? `${plural(fromApi, "row")} on days eBay's API already brought in were left out.`
                  : null,
                parsed.skipped ? `${plural(parsed.skipped, "row")} couldn't be read.` : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
          },
        );
      }
      setProgress(null);
      if (input.current) input.current.value = "";
      router.refresh();
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
      <input
        ref={input}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        multiple
        className="hidden"
        aria-label="eBay transaction reports"
        onChange={(e) => upload(e.target.files)}
      />
      <Button variant={variant} onClick={() => input.current?.click()} disabled={pending}>
        {pending ? <Spinner /> : <FileUp />}
        {pending ? "Adding…" : "Upload eBay's report"}
      </Button>
    </div>
  );
}
