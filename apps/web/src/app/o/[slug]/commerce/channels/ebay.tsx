"use client";

import { EBAY_MARKETPLACES } from "@bookalyze/core";
import { Plus, ShoppingBag } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { addEbayChannelAction, setChannelActiveAction } from "../actions";

export type EbayChannelView = {
  id: string;
  name: string;
  marketplaceId: string;
  country: string | null;
  currency: string;
  isActive: boolean;
};

/**
 * eBay: each eBay site the company sells on (eBay US, eBay Canada…) is a channel in that site's
 * currency. Channels work before eBay is connected, so their SKUs can be linked to products.
 */
export function EbayChannels({
  slug,
  canManage,
  defaultMarketplace,
  channels,
}: {
  slug: string;
  canManage: boolean;
  defaultMarketplace: string;
  channels: EbayChannelView[];
}) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(0);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = (channelId: string, on: boolean) =>
    start(async () => {
      setBusy(channelId);
      const result = await setChannelActiveAction(slug, channelId, on);
      setBusy(null);
      if (!result.ok) toast.error(result.message);
    });
  const open = () => {
    setKey((k) => k + 1);
    setAdding(true);
  };
  const unused = EBAY_MARKETPLACES.find(
    (m) => !channels.some((c) => c.marketplaceId === m.id && c.isActive),
  );

  return (
    <section
      aria-labelledby="ebay-heading"
      className="overflow-hidden rounded-2xl border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShoppingBag className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-0">
          <h2 id="ebay-heading" className="font-semibold">
            eBay
          </h2>
          <p className="text-muted-foreground text-sm">
            Add each eBay site you sell on, such as eBay US or eBay Canada. Its SKUs can then be
            linked to your products, bundles included.
          </p>
        </div>
        {canManage && unused && channels.length ? (
          <Button
            variant="outline"
            size="sm"
            className="ms-13 sm:ms-0"
            onClick={open}
            disabled={pending}
          >
            <Plus />
            Add an eBay site
          </Button>
        ) : null}
      </div>
      {channels.length ? (
        <ul className="divide-y">
          {channels.map((ch) => (
            <li key={ch.id} className="flex items-center gap-3 px-5 py-3">
              <div className={cn("min-w-0 flex-1", !ch.isActive && "opacity-60")}>
                <p className="font-medium text-sm">{ch.name}</p>
                <p className="text-muted-foreground text-xs">
                  {[ch.country, ch.currency, "You ship the orders"].filter(Boolean).join(" · ")}
                  {ch.isActive ? "" : " · Switched off"}
                </p>
              </div>
              {busy === ch.id ? <Spinner className="text-muted-foreground" /> : null}
              <Switch
                id={`channel-${ch.id}`}
                checked={ch.isActive}
                disabled={!canManage || pending}
                onCheckedChange={(on) => toggle(ch.id, on)}
                aria-label={`Use ${ch.name}`}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid justify-items-start gap-3 px-5 py-5">
          <p className="max-w-prose text-muted-foreground text-sm">
            Selling on eBay? Add the sites you sell on here. Each one is a channel in its own
            currency, like an Amazon marketplace.
          </p>
          {canManage ? (
            <Button onClick={open}>
              <Plus />
              Add an eBay site
            </Button>
          ) : (
            <p className="text-muted-foreground text-xs">
              Only owners and admins can add channels.
            </p>
          )}
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          {adding ? (
            <AddEbayForm
              key={key}
              slug={slug}
              channels={channels}
              initialMarketplace={
                channels.some((c) => c.marketplaceId === defaultMarketplace && c.isActive)
                  ? (unused?.id ?? defaultMarketplace)
                  : defaultMarketplace
              }
              onDone={() => setAdding(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AddEbayForm({
  slug,
  channels,
  initialMarketplace,
  onDone,
}: {
  slug: string;
  channels: EbayChannelView[];
  initialMarketplace: string;
  onDone: () => void;
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
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Add an eBay site</DialogTitle>
        <DialogDescription>
          Each eBay site you sell on is its own channel, in that site's currency.
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
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Plus />}
          Add site
        </Button>
      </DialogFooter>
    </form>
  );
}
