"use client";

import { CalendarDays, RefreshCw, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { startOrdersAction, syncOrdersAction } from "../actions";

/** At most this many calls per click: a huge first sync carries on with the daily job. */
const MAX_ROUNDS = 30;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Runs "bring in orders" until Amazon has nothing more (or MAX_ROUNDS), refreshing the list after
 * each round so orders appear as they come in.
 */
function useOrderSync(slug: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      let orders = 0;
      let items = 0;
      let refunds = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await syncOrdersAction(slug);
        if (!result.ok) {
          toast.error(result.message);
          break;
        }
        orders += result.orders;
        items += result.items;
        refunds += result.refunds;
        router.refresh();
        if (result.error) {
          toast.error(result.error);
          break;
        }
        if (!result.more) {
          toast.success(
            orders ? `${plural(orders, "order")} brought in` : "Your orders are up to date",
            items || refunds
              ? {
                  description: [
                    items ? `Item details added for ${plural(items, "order")}.` : "",
                    refunds ? `${plural(refunds, "new refund")} found.` : "",
                  ]
                    .filter(Boolean)
                    .join(" "),
                }
              : {},
          );
          break;
        }
        setProgress(
          result.waiting
            ? `Adding item details… ${plural(result.waiting, "order")} to go`
            : `Bringing in orders… ${orders} so far`,
        );
        if (round === MAX_ROUNDS - 1) {
          toast.info("Still going: the rest comes in with the daily sync, or click again.");
        }
        await pause(1_500);
      }
      setProgress(null);
    });

  return { run, pending, progress };
}

export function SyncOrdersButton({ slug }: { slug: string }) {
  const { run, pending, progress } = useOrderSync(slug);
  return (
    <div className="flex items-center gap-3">
      {progress ? (
        <span className="fade-in-0 hidden animate-in text-muted-foreground text-sm sm:inline">
          {progress}
        </span>
      ) : null}
      <Button variant="outline" onClick={run} disabled={pending}>
        {pending ? <Spinner /> : <RefreshCw />}
        {pending ? "Bringing in…" : "Bring in new orders"}
      </Button>
    </div>
  );
}

/** First time: choose how far back to bring orders in from, then run the first sync. */
export function StartOrders({
  slug,
  defaultFrom,
  earliest,
  today,
  locale,
  channels,
  canManage,
}: {
  slug: string;
  defaultFrom: string;
  earliest: string;
  today: string;
  locale: string;
  channels: string[];
  canManage: boolean;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [error, setError] = useState<string | null>(null);
  const [starting, startStarting] = useTransition();
  const { run, pending, progress } = useOrderSync(slug);

  const begin = () =>
    startStarting(async () => {
      setError(null);
      const result = await startOrdersAction(slug, from);
      if (!result.ok) return void setError(result.message);
      run();
    });

  const busy = starting || pending;
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-10 shadow-xs">
      <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.06]" />
      <div className="relative mx-auto grid max-w-md gap-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="zoom-in-75 flex size-14 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
            <ShoppingCart className="size-7" />
          </span>
          <div>
            <h2 className="font-semibold text-lg tracking-tight">Bring in your orders</h2>
            <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
              From {channels.join(", ")}. After this, new orders come in every day on their own.
              Orders don't change your books: Amazon's settlements will.
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="grid gap-4">
            <Field
              label="Bring in orders placed from"
              htmlFor="orders-from"
              hint={`Amazon keeps about two years of orders. A long history takes a few minutes the first time.`}
              error={error ?? undefined}
            >
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="orders-from"
                  type="date"
                  value={from}
                  min={earliest}
                  max={today}
                  onChange={(e) => setFrom(e.target.value)}
                  className="ps-9"
                />
              </div>
            </Field>
            <Button onClick={begin} disabled={busy || !from} size="lg">
              {busy ? <Spinner /> : <ShoppingCart />}
              {busy
                ? (progress ?? "Starting…")
                : `Bring in orders from ${formatDate(from || defaultFrom, locale)}`}
            </Button>
          </div>
        ) : (
          <p className="text-center text-muted-foreground text-sm">
            An owner or admin can start bringing orders in.
          </p>
        )}
      </div>
    </div>
  );
}

/** Marketplaces switched on after orders started: bring theirs in from the same date. */
export function IncludeChannels({ slug, from }: { slug: string; from: string }) {
  const [starting, startStarting] = useTransition();
  const { run, pending } = useOrderSync(slug);
  const include = () =>
    startStarting(async () => {
      const result = await startOrdersAction(slug, from);
      if (!result.ok) return void toast.error(result.message);
      run();
    });
  return (
    <Button size="sm" variant="outline" onClick={include} disabled={starting || pending}>
      {starting || pending ? <Spinner /> : <ShoppingCart />}
      Bring theirs in too
    </Button>
  );
}
