"use client";

import {
  FULFILMENT_MODES,
  type FulfilmentMode,
  NOON_FULFILMENT,
  NOON_MARKETPLACES,
} from "@bookalyze/core";
import { Plus, Store } from "lucide-react";
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
import {
  addNoonChannelAction,
  setChannelActiveAction,
  setChannelFulfilmentAction,
} from "../actions";

export type NoonChannelView = {
  id: string;
  name: string;
  marketplaceId: string;
  country: string | null;
  currency: string;
  fulfilment: FulfilmentMode | null;
  isActive: boolean;
};

const fulfilmentOptions = FULFILMENT_MODES.map((m) => ({
  value: m,
  label: NOON_FULFILMENT[m].label,
  description: NOON_FULFILMENT[m].hint,
}));

export function NoonChannels({
  slug,
  canManage,
  defaultMarketplace,
  channels,
}: {
  slug: string;
  canManage: boolean;
  defaultMarketplace: string;
  channels: NoonChannelView[];
}) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState(0);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const run = (id: string, task: () => Promise<void>) =>
    start(async () => {
      setBusy(id);
      await task();
      setBusy(null);
    });
  const toggle = (channelId: string, on: boolean) =>
    run(channelId, async () => {
      const result = await setChannelActiveAction(slug, channelId, on);
      if (!result.ok) toast.error(result.message);
    });
  const ship = (channelId: string, fulfilment: string) =>
    run(channelId, async () => {
      const result = await setChannelFulfilmentAction(slug, channelId, fulfilment);
      if (!result.ok) return void toast.error(result.message);
      toast.success("Saved", { description: result.label });
    });
  const open = () => {
    setKey((k) => k + 1);
    setAdding(true);
  };
  const unused = NOON_MARKETPLACES.find(
    (m) => !channels.some((c) => c.marketplaceId === m.id && c.isActive),
  );

  return (
    <section
      aria-labelledby="noon-heading"
      className="overflow-hidden rounded-2xl border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Store className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="noon-heading" className="font-semibold">
            Noon
          </h2>
          <p className="text-muted-foreground text-sm">
            Add each country you sell in on Noon and say who ships the orders. Its SKUs can then be
            linked to your products, bundles included.
          </p>
        </div>
        {canManage && unused ? (
          <Button variant="outline" size="sm" onClick={open} disabled={pending}>
            <Plus />
            Add a Noon country
          </Button>
        ) : null}
      </div>
      {channels.length ? (
        <ul className="divide-y">
          {channels.map((ch) => (
            <li
              key={ch.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 sm:flex-nowrap"
            >
              <div className={cn("min-w-0 flex-1", !ch.isActive && "opacity-60")}>
                <p className="font-medium text-sm">{ch.name}</p>
                <p className="text-muted-foreground text-xs">
                  {[ch.country, ch.currency].filter(Boolean).join(" · ")}
                  {ch.isActive ? "" : " · Switched off"}
                </p>
              </div>
              <Combobox
                aria-label={`Who ships ${ch.name} orders`}
                value={ch.fulfilment ?? ""}
                placeholder="Who ships the orders?"
                onChange={(v) => ship(ch.id, v)}
                options={fulfilmentOptions}
                disabled={!canManage || pending}
                wrapperClassName="order-last w-full sm:order-none sm:w-60"
              />
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
            Selling on Noon in the UAE, Saudi Arabia or Egypt? Add the country here. Each one is a
            channel in its own currency, like an Amazon marketplace.
          </p>
          {canManage ? (
            <Button onClick={open}>
              <Plus />
              Add a Noon country
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
            <AddNoonForm
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

function AddNoonForm({
  slug,
  channels,
  initialMarketplace,
  onDone,
}: {
  slug: string;
  channels: NoonChannelView[];
  initialMarketplace: string;
  onDone: () => void;
}) {
  const [marketplace, setMarketplace] = useState(initialMarketplace);
  const [fulfilment, setFulfilment] = useState<string>("marketplace");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const fulfilmentHint = NOON_FULFILMENT[fulfilment as FulfilmentMode]?.hint;
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await addNoonChannelAction(slug, { marketplace, fulfilment });
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
        <DialogTitle>Add a Noon country</DialogTitle>
        <DialogDescription>
          Each country you sell in on Noon is its own channel, in that country's currency.
        </DialogDescription>
      </DialogHeader>
      <Field label="Country" htmlFor="noon-marketplace" error={errors.marketplace}>
        <Combobox
          id="noon-marketplace"
          value={marketplace}
          onChange={setMarketplace}
          invalid={Boolean(errors.marketplace)}
          options={NOON_MARKETPLACES.map((m) => {
            const existing = channels.find((c) => c.marketplaceId === m.id);
            return {
              value: m.id,
              label: m.name,
              description: existing?.isActive
                ? "Already added"
                : existing
                  ? `${m.currency} · switched off, adding it switches it back on`
                  : m.currency,
              disabled: existing?.isActive ?? false,
            };
          })}
        />
      </Field>
      <Field
        label="Who ships the orders?"
        htmlFor="noon-fulfilment"
        error={errors.fulfilment}
        hint={fulfilmentHint}
      >
        <Combobox
          id="noon-fulfilment"
          value={fulfilment}
          onChange={setFulfilment}
          invalid={Boolean(errors.fulfilment)}
          options={fulfilmentOptions}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Plus />}
          Add country
        </Button>
      </DialogFooter>
    </form>
  );
}
