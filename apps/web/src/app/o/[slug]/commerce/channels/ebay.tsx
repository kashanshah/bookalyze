"use client";

import { EBAY_MARKETPLACES } from "@bookalyze/core";
import { CircleAlert, PlugZap, Plus, RefreshCw, Tag, Unplug } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  addEbayChannelAction,
  disconnectEbayAction,
  startEbayConnectAction,
  testEbayAction,
} from "../actions";

/** A channel the company already has, so the add form can grey it out. */
export type ExistingChannel = { marketplaceId: string; isActive: boolean };

/** eBay: each eBay site the company sells on is a channel in that site's currency. */
export function AddEbayForm({
  slug,
  channels,
  initialMarketplace,
  onDone,
  onBack,
}: {
  slug: string;
  channels: ExistingChannel[];
  initialMarketplace: string;
  onDone: (channelId: string) => void;
  onBack: () => void;
}) {
  const [marketplace, setMarketplace] = useState(initialMarketplace);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await addEbayChannelAction(slug, { marketplace });
          if (!result.ok) {
            setErrors(result.errors ?? {});
            if (!result.errors) toast.error(result.message);
            return;
          }
          toast.success(result.created ? `${result.name} added` : `${result.name} switched on`, {
            description: result.created
              ? "Link its SKUs to your products on Products."
              : "It keeps everything it had before.",
          });
          onDone(result.channelId);
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Add an eBay site</DialogTitle>
        <DialogDescription>
          Each eBay site you sell on is its own channel, in that site's currency. You ship the
          orders.
        </DialogDescription>
      </DialogHeader>
      <Field
        label="eBay site"
        htmlFor="ebay-marketplace"
        error={errors.marketplace}
        hint="The site your listings are on. A listing on eBay US that Canadians buy still counts as eBay US."
      >
        <Combobox
          id="ebay-marketplace"
          value={marketplace}
          onChange={setMarketplace}
          invalid={Boolean(errors.marketplace)}
          options={EBAY_MARKETPLACES.map((m) => {
            const existing = channels.find((c) => c.marketplaceId === m.id);
            return {
              value: m.id,
              label: m.name,
              description: existing?.isActive
                ? "Already added"
                : existing
                  ? `${m.currency} · switched off, adding it switches it back on`
                  : `${m.site} · ${m.currency}`,
              disabled: existing?.isActive ?? false,
            };
          })}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Plus />}
          Add site
        </Button>
      </DialogFooter>
    </form>
  );
}

export type EbayConnectionView = {
  status: "active" | "error" | "disconnected";
  username: string | null;
  /** The eBay site the account was registered on, e.g. EBAY_CA. */
  marketplace: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

/**
 * The eBay account behind a site: one per company, shared by all its eBay sites. Connecting
 * sends the admin to eBay's own page to agree; eBay sends them back here.
 */
export function EbayAccount({
  slug,
  locale,
  canManage,
  channelId,
  configured,
  connection: c,
}: {
  slug: string;
  locale: string;
  canManage: boolean;
  channelId: string;
  /** Whether this server has Bookalyze's eBay app keys. */
  configured: boolean;
  connection: EbayConnectionView | null;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const live = c && c.status !== "disconnected" ? c : null;
  const run = (id: string, task: () => Promise<void>) =>
    start(async () => {
      setBusy(id);
      await task();
      setBusy(null);
    });
  const connect = () =>
    run("connect", async () => {
      const result = await startEbayConnectAction(slug, channelId);
      if (!result.ok) return void toast.error(result.message);
      window.location.assign(result.url);
      // Stay busy while the browser leaves for eBay.
      await new Promise(() => {});
    });
  const test = () =>
    run("test", async () => {
      const result = await testEbayAction(slug);
      if (!result.ok) return void toast.error(result.message);
      toast.success("eBay answered", { description: `Signed in as ${result.username}.` });
    });
  const disconnect = () =>
    run("disconnect", async () => {
      const result = await disconnectEbayAction(slug);
      if (!result.ok) return void toast.error(result.message);
      setConfirming(false);
      toast.success("eBay disconnected", {
        description: "The sign-in is deleted. Your eBay sites and everything brought in stay.",
      });
    });
  const checked = live?.lastSyncedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(live.lastSyncedAt),
      )
    : null;

  return (
    <section
      aria-labelledby="account-heading"
      className="overflow-hidden rounded-2xl border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-start gap-3 px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Tag className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-0">
          <h2 id="account-heading" className="flex flex-wrap items-center gap-2 font-semibold">
            eBay account
            {live ? (
              live.status === "error" ? (
                <Badge variant="warning">Needs attention</Badge>
              ) : (
                <Badge variant="success">Connected</Badge>
              )
            ) : null}
          </h2>
          <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
            {live
              ? [
                  live.username ? `Signed in as ${live.username}` : null,
                  checked ? `Last checked ${checked}` : null,
                  "Shared by all your eBay sites",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Connect your eBay seller account so this site's orders and payouts can come in by themselves. You'll agree on eBay's own page; Bookalyze only reads, and never sees your eBay password."}
          </p>
        </div>
        <div className="ms-13 flex flex-wrap gap-2 sm:ms-0">
          {live ? (
            <>
              <Button variant="outline" size="sm" onClick={test} disabled={pending}>
                {busy === "test" ? <Spinner /> : <RefreshCw />}
                Test connection
              </Button>
              {canManage ? (
                <>
                  <Button variant="ghost" size="sm" onClick={connect} disabled={pending}>
                    {busy === "connect" ? <Spinner /> : <PlugZap />}
                    Connect again
                  </Button>
                  <Button
                    variant={confirming ? "destructive" : "ghost"}
                    size="sm"
                    onClick={() => (confirming ? disconnect() : setConfirming(true))}
                    disabled={pending}
                  >
                    {busy === "disconnect" ? <Spinner /> : <Unplug />}
                    {confirming ? "Click again to disconnect" : "Disconnect"}
                  </Button>
                </>
              ) : null}
            </>
          ) : canManage ? (
            <Button onClick={connect} disabled={pending || !configured}>
              {busy === "connect" ? <Spinner /> : <PlugZap />}
              Connect eBay
            </Button>
          ) : null}
        </div>
      </div>
      {live?.lastError ? (
        <p className="flex items-start gap-2 border-t bg-warning/10 px-5 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {live.lastError}
        </p>
      ) : !live && !configured ? (
        <p className="flex items-start gap-2 border-t bg-muted/40 px-5 py-3 text-muted-foreground text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          Connecting eBay isn't available on this server yet: Bookalyze's eBay app keys still need
          to be added. Until then, link this site's SKUs to your products on Products.
        </p>
      ) : null}
    </section>
  );
}

/** Says how connecting went when eBay sends the admin back, once, then tidies the address. */
export function EbayConnectNotice({
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
    if (result === "connected") {
      toast.success("eBay connected", { description: "Your eBay sites are on this account." });
    } else if (result === "declined") {
      toast.error("eBay wasn't connected", {
        description: "Nothing was shared: the request was declined on eBay's page.",
      });
    } else {
      toast.error("eBay wasn't connected", { description: message ?? "Try again." });
    }
    router.replace(pathname, { scroll: false });
  }, [result, message, router, pathname]);
  return null;
}
