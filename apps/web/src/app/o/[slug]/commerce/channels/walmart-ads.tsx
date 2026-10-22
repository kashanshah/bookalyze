"use client";

import { ArrowRight, CircleAlert, DownloadCloud, Megaphone, PlugZap, Unplug } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  connectWalmartAdsAction,
  disconnectWalmartAdsAction,
  syncWalmartAdsAction,
} from "../ads-actions";

export type WalmartAdsView = {
  status: "active" | "error" | "disconnected";
  advertiserId: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

/**
 * Walmart Connect for one Walmart channel: what Sponsored Products cost per item per day, for
 * profit after ads. The advertiser adds Bookalyze as an API partner in Ad Center, then enters its
 * advertiser ID here; Bookalyze only reads reports.
 */
export function WalmartAdsPanel({
  slug,
  locale,
  canManage,
  channelId,
  configured,
  connected: sellerConnected,
  connection: c,
  through,
  pending,
  reportError,
  profitHref,
}: {
  slug: string;
  locale: string;
  canManage: boolean;
  channelId: string;
  /** Whether this server has Bookalyze's Walmart Connect partner keys. */
  configured: boolean;
  /** Whether the country's Walmart seller account is connected (it finds each item's SKU). */
  connected: boolean;
  connection: WalmartAdsView | null;
  through: string | null;
  pending: number;
  reportError: string | null;
  profitHref: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [advertiserId, setAdvertiserId] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pendingTransition, start] = useTransition();
  const live = c && c.status !== "disconnected" ? c : null;
  const run = (id: string, task: () => Promise<void>) =>
    start(async () => {
      setBusy(id);
      await task();
      setBusy(null);
    });
  const connect = () =>
    run("connect", async () => {
      setFieldError(null);
      const result = await connectWalmartAdsAction(slug, channelId, { advertiserId });
      if (!result.ok) return void setFieldError(result.message);
      setAdvertiserId("");
      toast.success("Walmart Connect linked", {
        description: `${result.campaigns === 1 ? "1 campaign" : `${result.campaigns.toLocaleString(locale)} campaigns`} found. The last 30 days of ad spend are on their way.`,
      });
    });
  const sync = () =>
    run("sync", async () => {
      const result = await syncWalmartAdsAction(slug, channelId);
      if (!result.ok) return void toast.error(result.message);
      if (result.pending && !result.collected) {
        toast.success("Walmart is making the report", {
          description:
            "It can take a while for a large account. It comes in by itself; nothing else to do.",
        });
      } else {
        toast.success("Ad spend brought in", {
          description: [
            `${result.rows.toLocaleString(locale)} rows of ad spend by day, campaign and item.`,
            result.unmatched
              ? `${result.unmatched.toLocaleString(locale)} ${result.unmatched === 1 ? "item" : "items"} couldn't be matched to a SKU yet.`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        });
      }
    });
  const disconnect = () =>
    run("disconnect", async () => {
      const result = await disconnectWalmartAdsAction(slug, channelId);
      if (!result.ok) return void toast.error(result.message);
      setConfirming(false);
      toast.success("Walmart Connect unlinked", {
        description: "Nothing new comes in. The ad spend brought in so far stays.",
      });
    });
  const dateOf = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${iso}T12:00:00Z`));

  const summary = live
    ? [
        `Advertiser ${live.advertiserId}`,
        through
          ? `Ad spend in through ${dateOf(through)}`
          : pending
            ? "First report on its way"
            : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Link your Walmart Connect advertiser to see what Sponsored Products cost for each item, every day, and each product's real profit after ads. Bookalyze only reads reports.";

  return (
    <section
      aria-labelledby="walmart-ads-heading"
      className="fade-in-0 animate-in overflow-hidden rounded-2xl border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-start gap-3 px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Megaphone className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-0">
          <h2 id="walmart-ads-heading" className="flex flex-wrap items-center gap-2 font-semibold">
            Walmart Connect
            {live ? (
              live.status === "error" ? (
                <Badge variant="warning">Needs attention</Badge>
              ) : (
                <Badge variant="success">Linked</Badge>
              )
            ) : null}
            {pending ? <Badge variant="outline">Walmart is making the report</Badge> : null}
          </h2>
          <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">{summary}</p>
        </div>
        {live ? (
          <div className="ms-13 flex flex-wrap gap-2 sm:ms-0">
            <Button variant="outline" size="sm" onClick={sync} disabled={pendingTransition}>
              {busy === "sync" ? <Spinner /> : <DownloadCloud />}
              Bring in ads now
            </Button>
            {canManage ? (
              <Button
                variant={confirming ? "destructive" : "ghost"}
                size="sm"
                onClick={() => (confirming ? disconnect() : setConfirming(true))}
                disabled={pendingTransition}
              >
                {busy === "disconnect" ? <Spinner /> : <Unplug />}
                {confirming ? "Click again to unlink" : "Unlink"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!live && canManage && configured ? (
        <form
          className="grid gap-3 border-t px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <Field
            label="Advertiser ID"
            htmlFor={`walmart-advertiser-${channelId}`}
            hint="First, in Walmart Connect's Ad Center, open Admin → API partners and add Bookalyze with reporting access. Then copy the advertiser ID Ad Center shows (a number) here."
            error={fieldError ?? undefined}
          >
            <Input
              id={`walmart-advertiser-${channelId}`}
              inputMode="numeric"
              autoComplete="off"
              value={advertiserId}
              onChange={(e) => setAdvertiserId(e.target.value)}
              placeholder="600123"
            />
          </Field>
          <Button
            type="submit"
            className="justify-self-start"
            disabled={pendingTransition || !advertiserId.trim()}
          >
            {busy === "connect" ? <Spinner /> : <PlugZap />}
            Check and link
          </Button>
        </form>
      ) : null}

      {live?.lastError || reportError ? (
        <p className="flex items-start gap-2 border-t bg-warning/10 px-5 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {live?.lastError ?? reportError}
        </p>
      ) : !live && !configured ? (
        <p className="flex items-start gap-2 border-t bg-muted/40 px-5 py-3 text-muted-foreground text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          Linking Walmart Connect isn't available on this server yet: Bookalyze's Walmart Connect
          partner keys still need to be added.
        </p>
      ) : live && !sellerConnected ? (
        <p className="flex items-start gap-2 border-t bg-muted/40 px-5 py-3 text-muted-foreground text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          Connect this country's Walmart account above too: Walmart Connect names items by Walmart's
          item ID, and the seller account tells Bookalyze which SKU each one is.
        </p>
      ) : null}

      {live && profitHref ? (
        <Link
          href={profitHref}
          className="group flex items-center gap-3 border-t px-5 py-3.5 text-sm transition-colors hover:bg-muted/40"
        >
          <span className="min-w-0 flex-1">
            <span className="font-medium">Profit by product, after ads</span>
            <span className="block text-muted-foreground text-xs">
              Each product's profit after fees, cost and ads; TACOS, break-even ACOS, and the
              products losing money.
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
        </Link>
      ) : null}
    </section>
  );
}
