"use client";

import {
  type AmazonRegion,
  EBAY_MARKETPLACES as EBAY_IDS,
  NOON_MARKETPLACES as NOON_IDS,
} from "@bookalyze/core";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ConnectAmazonForm } from "./amazon";
import { AddEbayForm, type ExistingChannel } from "./ebay";
import { AddNoonForm } from "./noon";
import { PLATFORMS, type Platform } from "./platforms";

export type ChannelRowView = {
  id: string;
  platform: Platform;
  name: string;
  country: string | null;
  currency: string;
  isActive: boolean;
  /** Who ships its orders, in words. */
  shipping: string | null;
  /** Its account: connected, needing attention, or not connected (added by hand). */
  account: "connected" | "attention" | "none";
};

const ORDER: Platform[] = ["amazon", "ebay", "noon"];

/**
 * Every channel the company sells on, whatever the platform, each opening its own page. New
 * ones are added by choosing the platform first.
 */
export function ChannelList({
  slug,
  canManage,
  rows,
  defaults,
  existing,
}: {
  slug: string;
  canManage: boolean;
  rows: ChannelRowView[];
  defaults: { amazonRegion: AmazonRegion; ebay: string; noon: string };
  existing: { ebay: ExistingChannel[]; noon: ExistingChannel[] };
}) {
  const [adding, setAdding] = useState<Platform | "pick" | null>(null);
  const [key, setKey] = useState(0);
  const open = (step: Platform | "pick") => {
    setKey((k) => k + 1);
    setAdding(step);
  };
  const sorted = [...rows].sort(
    (a, b) => ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform) || a.name.localeCompare(b.name),
  );

  return (
    <div className="grid gap-4">
      {rows.length ? (
        <section
          aria-labelledby="channels-heading"
          className="fade-in-0 animate-in overflow-hidden rounded-2xl border bg-card shadow-xs"
        >
          <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id="channels-heading" className="font-semibold">
                Your channels
              </h2>
              <p className="text-muted-foreground text-sm">
                Open one to switch it on or off and manage its account.
              </p>
            </div>
            {canManage ? (
              <Button onClick={() => open("pick")}>
                <Plus />
                Add a channel
              </Button>
            ) : null}
          </div>
          <ul className="divide-y">
            {sorted.map((ch) => (
              <li key={ch.id}>
                <Link
                  href={`/o/${slug}/commerce/channels/${ch.id}`}
                  className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-[18px]",
                      !ch.isActive && "bg-muted text-muted-foreground",
                    )}
                  >
                    {PLATFORMS[ch.platform].icon}
                  </span>
                  <span className={cn("min-w-0 flex-1", !ch.isActive && "opacity-70")}>
                    <span className="block font-medium text-sm">{ch.name}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {[PLATFORMS[ch.platform].label, ch.country, ch.currency, ch.shipping]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {/* On phones the status goes under the name, so the row stays readable. */}
                  <span className="order-last flex w-full flex-wrap gap-1.5 ps-12 sm:order-none sm:w-auto sm:justify-end sm:ps-0">
                    <StatusBadges channel={ch} />
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-10 shadow-xs">
          <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.06]" />
          <div className="relative mx-auto grid max-w-xl gap-6">
            <div className="text-center">
              <h2 className="font-semibold text-lg tracking-tight">Add your first channel</h2>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                A channel is where you sell: an Amazon marketplace, an eBay site or a Noon country.
                Choose where you sell to start.
              </p>
            </div>
            <PlatformChoices onChoose={open} disabled={!canManage} />
            {canManage ? null : (
              <p className="text-center text-muted-foreground text-xs">
                Only owners and admins can add channels.
              </p>
            )}
          </div>
        </div>
      )}

      <Dialog open={adding !== null} onOpenChange={(o) => (o ? null : setAdding(null))}>
        <DialogContent>
          {adding === "pick" ? (
            <div key={key} className="grid gap-5">
              <DialogHeader>
                <DialogTitle>Add a channel</DialogTitle>
                <DialogDescription>Where do you sell?</DialogDescription>
              </DialogHeader>
              <PlatformChoices onChoose={open} />
            </div>
          ) : adding ? (
            <AddForm
              key={key}
              slug={slug}
              platform={adding}
              defaults={defaults}
              existing={existing}
              onBack={() => open("pick")}
              onClose={() => setAdding(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadges({ channel: ch }: { channel: ChannelRowView }) {
  return (
    <>
      {ch.isActive ? null : <Badge variant="secondary">Switched off</Badge>}
      {ch.account === "attention" ? (
        <Badge variant="warning">Needs attention</Badge>
      ) : ch.account === "connected" ? (
        <Badge variant="success">Connected</Badge>
      ) : (
        <Badge variant="outline">Not connected</Badge>
      )}
    </>
  );
}

function PlatformChoices({
  onChoose,
  disabled = false,
}: {
  onChoose: (platform: Platform) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="grid gap-2.5">
      {ORDER.map((p) => (
        <li key={p}>
          <button
            type="button"
            onClick={() => onChoose(p)}
            disabled={disabled}
            className="group flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-start shadow-xs outline-none transition-all duration-150 hover:border-primary/40 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-60"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-[18px]">
              {PLATFORMS[p].icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-sm">{PLATFORMS[p].label}</span>
              <span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed">
                {PLATFORMS[p].description}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function AddForm({
  slug,
  platform,
  defaults,
  existing,
  onBack,
  onClose,
}: {
  slug: string;
  platform: Platform;
  defaults: { amazonRegion: AmazonRegion; ebay: string; noon: string };
  existing: { ebay: ExistingChannel[]; noon: ExistingChannel[] };
  onBack: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const opened = (channelId: string) => {
    onClose();
    router.push(`/o/${slug}/commerce/channels/${channelId}`);
  };
  // Offer the company's own country first, unless it's already added.
  const first = (list: ExistingChannel[], preferred: string, all: readonly { id: string }[]) =>
    list.some((c) => c.marketplaceId === preferred && c.isActive)
      ? (all.find((m) => !list.some((c) => c.marketplaceId === m.id && c.isActive))?.id ??
        preferred)
      : preferred;

  if (platform === "amazon") {
    return (
      <ConnectAmazonForm
        slug={slug}
        initialRegion={defaults.amazonRegion}
        replacing={false}
        onDone={onClose}
        onBack={onBack}
      />
    );
  }
  if (platform === "ebay") {
    return (
      <AddEbayForm
        slug={slug}
        channels={existing.ebay}
        initialMarketplace={first(existing.ebay, defaults.ebay, EBAY_IDS)}
        onDone={opened}
        onBack={onBack}
      />
    );
  }
  return (
    <AddNoonForm
      slug={slug}
      channels={existing.noon}
      initialMarketplace={first(existing.noon, defaults.noon, NOON_IDS)}
      onDone={opened}
      onBack={onBack}
    />
  );
}
