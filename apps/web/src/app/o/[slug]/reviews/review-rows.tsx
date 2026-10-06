"use client";

import type { ReviewStatus } from "@bookalyze/core";
import { Ban, ChevronRight, RotateCcw, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { askReviewsAction, restoreReviewsAction, skipReviewsAction } from "./actions";

export type ReviewRow = {
  id: string;
  externalId: string;
  title: string;
  /** Placed date and marketplace. */
  meta: string;
  /** When it can be / will be / was asked. */
  when: string;
  reason: string | null;
  status: ReviewStatus | null;
  /** Amazon's window is open today. */
  open: boolean;
};

/** At most this many calls per click: Amazon allows about one request a second. */
const MAX_ROUNDS = 20;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type AskInput = Parameters<typeof askReviewsAction>[1];

/** Sends requests until done (or MAX_ROUNDS), refreshing the list after each call. */
function useAsk(slug: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);

  const ask = (first: AskInput, onDone?: () => void) =>
    start(async () => {
      let input = first;
      const total = { sent: 0, skipped: 0, notEligible: 0, failed: 0, later: 0 };
      let single: { status: string; reason: string | null } | null = null;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await askReviewsAction(slug, input);
        if (!result.ok) {
          toast.error(result.message);
          break;
        }
        for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += result[k];
        if (round === 0 && "orderIds" in first && first.orderIds.length === 1) {
          single = result.results[0] ?? null;
        }
        router.refresh();
        if (result.error) {
          toast.error(result.error);
          break;
        }
        if (!result.more) break;
        if (result.pendingIds.length) input = { orderIds: result.pendingIds, bulk: true };
        setProgress(`Asking… ${plural(total.sent, "request")} sent so far`);
        if (round === MAX_ROUNDS - 1) toast.info("Still going: click again to carry on.");
      }
      setProgress(null);
      onDone?.();
      if (single) {
        if (single.status === "sent") toast.success("Review request sent");
        else if (single.reason) toast.info(single.reason);
        return;
      }
      const notes = [
        total.skipped ? `${total.skipped} skipped (refunded or already asked)` : null,
        total.notEligible ? `${total.notEligible} not eligible` : null,
        total.failed ? `${total.failed} didn't go through` : null,
      ].filter(Boolean);
      if (total.sent || notes.length) {
        toast.success(
          total.sent ? `${plural(total.sent, "review request")} sent` : "No requests sent",
          notes.length ? { description: `${notes.join(" · ")}. See "Left out".` } : {},
        );
      }
    });

  return { ask, pending, progress };
}

/** "Ask all": every order whose window is open, a batch at a time. */
export function AskAllButton({
  slug,
  count,
  channelId,
}: {
  slug: string;
  count: number;
  channelId: string | null;
}) {
  const { ask, pending, progress } = useAsk(slug);
  return (
    <div className="flex items-center gap-3">
      {progress ? (
        <span className="fade-in-0 hidden animate-in text-muted-foreground text-sm sm:inline">
          {progress}
        </span>
      ) : null}
      <Button size="sm" onClick={() => ask({ all: true, channelId })} disabled={pending}>
        {pending ? <Spinner /> : <Send />}
        {pending ? "Asking…" : `Ask all ${count} ready`}
      </Button>
    </div>
  );
}

/** "Ask now" for one order (the order page). */
export function AskOneButton({ slug, orderId }: { slug: string; orderId: string }) {
  const { ask, pending } = useAsk(slug);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => ask({ orderIds: [orderId] })}
      disabled={pending}
    >
      {pending ? <Spinner /> : <Send />}
      {pending ? "Asking…" : "Ask for a review now"}
    </Button>
  );
}

const STATUS_VARIANT: Record<ReviewStatus, "success" | "warning" | "outline" | "secondary"> = {
  scheduled: "secondary",
  sent: "success",
  skipped: "outline",
  not_eligible: "outline",
  failed: "warning",
};
const STATUS_TEXT: Record<ReviewStatus, string> = {
  scheduled: "Scheduled",
  sent: "Requested",
  skipped: "Skipped",
  not_eligible: "Not eligible",
  failed: "Didn't go through",
};

export function ReviewRows({
  slug,
  tab,
  rows,
  canSend,
  orderBase,
}: {
  slug: string;
  tab: "ask" | "scheduled" | "sent" | "other";
  rows: ReviewRow[];
  canSend: boolean;
  orderBase: string;
}) {
  const router = useRouter();
  const { ask, pending, progress } = useAsk(slug);
  const [busy, startBusy] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = canSend && (tab === "ask" || tab === "scheduled");
  const choosable = rows.filter((r) => r.open);
  const chosen = choosable.filter((r) => selected.has(r.id)).map((r) => r.id);
  const all = choosable.length > 0 && chosen.length === choosable.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const clear = () => setSelected(new Set());

  const skip = (ids: string[]) =>
    startBusy(async () => {
      const result = await skipReviewsAction(slug, ids);
      if (!result.ok) return void toast.error(result.message);
      clear();
      router.refresh();
      toast.success(
        ids.length === 1 ? "Won't be asked" : `${plural(result.count, "order")} won't be asked`,
        {
          description: "Find them under “Left out” to put them back.",
          action: { label: "Undo", onClick: () => restore(ids, true) },
        },
      );
    });
  const restore = (ids: string[], quiet = false) =>
    startBusy(async () => {
      const result = await restoreReviewsAction(slug, ids);
      if (!result.ok) return void toast.error(result.message);
      router.refresh();
      if (!quiet) toast.success("Back among the orders to ask");
    });

  const working = pending || busy;
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      {selectable ? (
        <div className="flex min-h-12 flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-2 sm:px-5">
          <Checkbox
            checked={all}
            label={all ? "Clear the selection" : "Select every order that can be asked"}
            onChange={() => (all ? clear() : setSelected(new Set(choosable.map((r) => r.id))))}
          />
          <span className="text-muted-foreground text-sm">
            {chosen.length
              ? `${chosen.length} selected`
              : (progress ?? "Select orders to ask together")}
          </span>
          {chosen.length ? (
            <div className="fade-in-0 ms-auto flex animate-in gap-2">
              <Button size="sm" variant="ghost" onClick={() => skip(chosen)} disabled={working}>
                <Ban />
                Don't ask
              </Button>
              <Button
                size="sm"
                onClick={() => ask({ orderIds: chosen, bulk: true }, clear)}
                disabled={working}
              >
                {pending ? <Spinner /> : <Send />}
                {pending ? (progress ?? "Asking…") : `Ask ${chosen.length} now`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ul className="divide-y">
        {rows.map((r, i) => {
          const canPick = selectable && r.open;
          return (
            <li
              key={r.id}
              className="fade-in-0 flex animate-in items-center gap-3 fill-mode-both px-4 py-3.5 sm:px-5"
              style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
            >
              {selectable ? (
                <Checkbox
                  checked={selected.has(r.id)}
                  label={`Select order ${r.externalId}`}
                  onChange={() => toggle(r.id)}
                  className={cn(!canPick && "pointer-events-none invisible")}
                />
              ) : null}
              <Link href={`${orderBase}/${r.id}`} className="group min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate font-medium text-sm">
                  <span className="truncate">{r.title}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" />
                </span>
                <span className="block truncate text-muted-foreground text-xs">
                  <span className="tabular">{r.externalId}</span> · {r.meta}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {r.status && tab !== "sent" && tab !== "scheduled" ? (
                    <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_TEXT[r.status]}</Badge>
                  ) : null}
                  <span
                    className={cn(r.status === "sent" ? "text-success" : "text-muted-foreground")}
                  >
                    {r.status && tab === "other" ? r.reason : r.when}
                  </span>
                  {r.reason && tab === "scheduled" ? (
                    <span className="text-muted-foreground">· {r.reason}</span>
                  ) : null}
                </span>
              </Link>
              {canSend ? (
                <div className="flex shrink-0 items-center gap-1">
                  {tab === "ask" || tab === "scheduled" ? (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Don't ask for this order"
                        aria-label={`Don't ask for order ${r.externalId}`}
                        onClick={() => skip([r.id])}
                        disabled={working}
                        className="size-8 text-muted-foreground"
                      >
                        <Ban className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => ask({ orderIds: [r.id] })}
                        disabled={working || !r.open}
                        title={r.open ? undefined : r.when}
                      >
                        <Send />
                        <span className="hidden sm:inline">Ask now</span>
                      </Button>
                    </>
                  ) : tab === "other" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => restore([r.id])}
                      disabled={working}
                      title="Put it back among the orders to ask"
                    >
                      <RotateCcw />
                      <span className="hidden sm:inline">Put back</span>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
