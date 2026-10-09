"use client";

import { parseNoonTransactions } from "@bookalyze/core";
import { FileUp, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { syncNoonTransactionsAction, uploadNoonTransactionsAction } from "./actions";

/** Calls per click (about 25 seconds each); what's left carries on with the next click. */
const MAX_ROUNDS = 60;
/** Rows sent per call when uploading. */
const UPLOAD_ROWS = 1_000;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * "Bring in from Noon": asks Noon for its transaction view a month at a time, starting a year
 * back, until it's caught up. Noon makes each month's report in the background, so this keeps
 * calling while there's more, showing which days Noon is working on.
 */
export function SyncNoonButton({ slug, locale }: { slug: string; locale: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      let added = 0;
      let updated = 0;
      const countries = new Set<string>();
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await syncNoonTransactionsAction(slug);
        if (!result.ok) {
          toast.error(result.message);
          break;
        }
        added += result.added;
        updated += result.updated;
        for (const c of result.channelsAdded) countries.add(c);
        router.refresh();
        if (result.error) {
          toast.error(result.error);
          break;
        }
        if (!result.more) {
          toast.success(
            added
              ? `${plural(added, "transaction")} brought in`
              : "Noon's transactions are up to date",
            {
              description: [
                updated ? `${plural(updated, "transaction")} refreshed.` : null,
                countries.size ? `Added ${[...countries].join(", ")} to your channels.` : null,
              ]
                .filter(Boolean)
                .join(" "),
            },
          );
          break;
        }
        const through = result.through ? `in through ${formatDate(result.through, locale)}` : null;
        const working = result.working
          ? `Noon is making the report for ${formatDate(result.working.from, locale)} – ${formatDate(result.working.to, locale)}`
          : "Bringing in Noon's transactions";
        setProgress(`${working}… ${through ?? `${plural(added, "row")} so far`}`);
        if (round === MAX_ROUNDS - 1) {
          toast.info("Noon is taking a while: click again later to carry on where this stopped.");
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
        {pending ? "Bringing in…" : "Bring in from Noon"}
      </Button>
    </div>
  );
}

/**
 * Adds Noon's transaction view from a file (seller portal → Finance → Transaction view → CSV).
 * The file is read here in the browser and its rows are sent in parts.
 */
export function UploadNoonTransactions({
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
        const parsed = parseNoonTransactions(await file.text());
        if (!parsed.ok) {
          toast.error(`${file.name}: ${parsed.error}`);
          continue;
        }
        if (!parsed.rows.length) {
          toast.error(`${file.name}: there are no transactions in it.`);
          continue;
        }
        let added = 0;
        let updated = 0;
        let unknownCurrency = 0;
        let failed: string | null = null;
        for (let i = 0; i < parsed.rows.length; i += UPLOAD_ROWS) {
          setProgress(
            `Adding ${file.name}… ${Math.min(i, parsed.rows.length).toLocaleString()} of ${parsed.rows.length.toLocaleString()}`,
          );
          const result = await uploadNoonTransactionsAction(slug, {
            fileName: file.name.slice(0, 200),
            rows: parsed.rows.slice(i, i + UPLOAD_ROWS),
          });
          if (!result.ok) {
            failed = result.message;
            break;
          }
          added += result.added;
          updated += result.updated;
          unknownCurrency += result.unknownCurrency;
        }
        if (failed) {
          toast.error(`${file.name}: ${failed}`, {
            description: added
              ? `${plural(added, "transaction")} were added before it stopped.`
              : undefined,
          });
          continue;
        }
        const unbalanced = parsed.rows.filter((r) => !r.balanced).length;
        toast.success(
          added
            ? `${file.name}: ${plural(added, "transaction")} added`
            : `${file.name} is already in`,
          {
            description: [
              updated ? `${plural(updated, "transaction")} refreshed.` : null,
              parsed.skipped ? `${plural(parsed.skipped, "row")} couldn't be read.` : null,
              unknownCurrency
                ? `${plural(unknownCurrency, "row")} in a currency Noon doesn't sell in were left out.`
                : null,
              unbalanced ? `${plural(unbalanced, "row")} don't add up to their total.` : null,
            ]
              .filter(Boolean)
              .join(" "),
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
        <span className="fade-in-0 animate-in text-muted-foreground text-sm" aria-live="polite">
          {progress}
        </span>
      ) : null}
      <input
        ref={input}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
        multiple
        className="hidden"
        aria-label="Noon transaction files"
        onChange={(e) => upload(e.target.files)}
      />
      <Button variant={variant} onClick={() => input.current?.click()} disabled={pending}>
        {pending ? <Spinner /> : <FileUp />}
        {pending ? "Adding…" : "Upload a file"}
      </Button>
    </div>
  );
}
