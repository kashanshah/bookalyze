"use client";

import {
  ArrowRight,
  CircleAlert,
  DownloadCloud,
  Megaphone,
  PlugZap,
  RefreshCw,
  Unplug,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Spinner } from "@/components/ui/spinner";
import {
  chooseAmazonAdsProfileAction,
  disconnectAmazonAdsAction,
  startAmazonAdsConnectAction,
  syncAmazonAdsAction,
} from "../ads-actions";

export type AmazonAdsView = {
  status: "active" | "error" | "disconnected";
  /** The store this channel takes its ads from (name, country, Amazon's ID). */
  accountName: string | null;
  /** Whether the company's logins have an ads account for this marketplace. */
  matches: boolean;
  /** The chosen store's profile, when one is chosen or the only one. */
  profileId: string | null;
  /** Stores to choose between, when the logins see more than one in this marketplace. */
  choices: { value: string; label: string }[];
  /** How many Amazon logins the company has connected in this region. */
  logins: number;
  /** Other marketplaces the same login advertises in (countries). */
  others: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
};

/**
 * Amazon Ads for one Amazon marketplace: what its ads cost per product per day, for profit
 * after ads. One sign-in per Ads region (North America, Europe…) serves every marketplace in it.
 */
export function AmazonAdsPanel({
  slug,
  locale,
  canManage,
  channelId,
  channelName,
  configured,
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
  channelName: string;
  /** Whether this server has Bookalyze's Amazon Ads app keys. */
  configured: boolean;
  connection: AmazonAdsView | null;
  /** The last day of ad spend brought in for this channel. */
  through: string | null;
  /** Reports Amazon is still making. */
  pending: number;
  reportError: string | null;
  /** Channel profit → By product, when the company has it. */
  profitHref: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [choice, setChoice] = useState(c?.profileId ?? "");
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
      const result = await startAmazonAdsConnectAction(slug, channelId);
      if (!result.ok) return void toast.error(result.message);
      window.location.assign(result.url);
      // Stay busy while the browser leaves for Amazon.
      await new Promise(() => {});
    });
  const sync = () =>
    run("sync", async () => {
      const result = await syncAmazonAdsAction(slug, channelId);
      if (!result.ok) return void toast.error(result.message);
      if (result.pending && !result.collected) {
        toast.success("Amazon is making the reports", {
          description:
            "They usually take a few minutes. They come in by themselves; nothing else to do.",
        });
      } else {
        toast.success("Ad spend brought in", {
          description: `${result.rows.toLocaleString(locale)} rows of ad spend by day, campaign and product.${result.pending ? " A few more reports are still being made." : ""}`,
        });
      }
    });
  const choose = () =>
    run("choose", async () => {
      const result = await chooseAmazonAdsProfileAction(slug, channelId, { profileId: choice });
      if (!result.ok) return void toast.error(result.message);
      toast.success("Ads account chosen", {
        description: `${channelName} now brings in this account's ad spend. The first reports are on their way.`,
      });
    });
  const choosing = Boolean(live?.choices.length && !live.profileId);
  const disconnect = () =>
    run("disconnect", async () => {
      const result = await disconnectAmazonAdsAction(slug, channelId);
      if (!result.ok) return void toast.error(result.message);
      setConfirming(false);
      toast.success("Amazon Ads disconnected", {
        description: "The sign-in is deleted. The ad spend brought in so far stays.",
      });
    });
  const dateOf = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${iso}T12:00:00Z`));

  const summary = live
    ? [
        !live.matches
          ? `This login has no ads account for ${channelName}`
          : choosing
            ? `Your Amazon logins see ${live.choices.length} stores on ${channelName}: choose which one is this store`
            : live.accountName
              ? `Ads account ${live.accountName}`
              : "Connected",
        through
          ? `Ad spend in through ${dateOf(through)}`
          : pending
            ? "First reports on their way"
            : null,
        live.others.length ? `Also covers ${live.others.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Connect your Amazon Ads account to see what ads cost for each product, every day, and each product's real profit after ads, its TACOS and its break-even ACOS. You agree on Amazon's own page; Bookalyze only reads reports and never sees your password.";

  return (
    <section
      aria-labelledby="ads-heading"
      className="overflow-hidden rounded-2xl border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-start gap-3 px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Megaphone className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-0">
          <h2 id="ads-heading" className="flex flex-wrap items-center gap-2 font-semibold">
            Amazon Ads
            {live ? (
              live.status === "error" || !live.matches || choosing ? (
                <Badge variant="warning">Needs attention</Badge>
              ) : (
                <Badge variant="success">Connected</Badge>
              )
            ) : null}
            {pending ? (
              <Badge variant="outline">
                Amazon is making {pending} {pending === 1 ? "report" : "reports"}
              </Badge>
            ) : null}
          </h2>
          <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">{summary}</p>
        </div>
        <div className="ms-13 flex flex-wrap gap-2 sm:ms-0">
          {live ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={sync}
                disabled={pendingTransition || choosing}
              >
                {busy === "sync" ? <Spinner /> : <DownloadCloud />}
                Bring in ads now
              </Button>
              {canManage ? (
                <>
                  <Button variant="ghost" size="sm" onClick={connect} disabled={pendingTransition}>
                    {busy === "connect" ? <Spinner /> : <RefreshCw />}
                    Connect again
                  </Button>
                  <Button
                    variant={confirming ? "destructive" : "ghost"}
                    size="sm"
                    onClick={() => (confirming ? disconnect() : setConfirming(true))}
                    disabled={pendingTransition}
                  >
                    {busy === "disconnect" ? <Spinner /> : <Unplug />}
                    {confirming ? "Click again to disconnect" : "Disconnect"}
                  </Button>
                </>
              ) : null}
            </>
          ) : canManage ? (
            <Button onClick={connect} disabled={pendingTransition || !configured}>
              {busy === "connect" ? <Spinner /> : <PlugZap />}
              Connect Amazon Ads
            </Button>
          ) : null}
        </div>
      </div>
      {live && canManage && live.choices.length ? (
        <div className="flex flex-wrap items-end gap-2 border-t bg-muted/30 px-5 py-3.5">
          <div className="min-w-0 flex-1 basis-64">
            <label htmlFor="ads-store" className="font-medium text-sm">
              Which ads account is this store?
            </label>
            <p id="ads-store-hint" className="text-muted-foreground text-xs">
              One Amazon login can manage several stores. Pick the one that sells on {channelName}{" "}
              for this company, so its ad spend isn't mixed with another store's.
            </p>
            <Combobox
              id="ads-store"
              aria-describedby="ads-store-hint"
              wrapperClassName="mt-2"
              options={live.choices}
              value={choice}
              onChange={setChoice}
              placeholder="Choose an ads account"
            />
          </div>
          <Button
            size="sm"
            onClick={choose}
            disabled={pendingTransition || !choice || choice === live.profileId}
          >
            {busy === "choose" ? <Spinner /> : null}
            Use this account
          </Button>
        </div>
      ) : null}
      {live?.lastError || reportError ? (
        <p className="flex items-start gap-2 border-t bg-warning/10 px-5 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {live?.lastError ?? reportError}
        </p>
      ) : !live && !configured ? (
        <p className="flex items-start gap-2 border-t bg-muted/40 px-5 py-3 text-muted-foreground text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          Connecting Amazon Ads isn't available on this server yet: Bookalyze's Amazon Ads app keys
          still need to be added.
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

/** Says how connecting went when Amazon sends the admin back, once, then tidies the address. */
export function AmazonAdsConnectNotice({
  result,
  message,
}: {
  result: string | null;
  message: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef(false);
  useEffect(() => {
    if (!result || shown.current) return;
    shown.current = true;
    if (result === "choose") {
      toast.success("Amazon Ads connected", {
        description: "This login manages more than one store here. Choose which one is this store.",
      });
    } else if (result === "connected") {
      toast.success("Amazon Ads connected", {
        description: "The first reports are on their way: about 60 days of ad spend, in minutes.",
      });
    } else if (result === "declined") {
      toast.error("Amazon Ads wasn't connected", {
        description: "Nothing was shared: the request was declined on Amazon's page.",
      });
    } else {
      toast.error("Amazon Ads wasn't connected", { description: message ?? "Try again." });
    }
    router.replace(pathname, { scroll: false });
  }, [result, message, router, pathname]);
  return null;
}
