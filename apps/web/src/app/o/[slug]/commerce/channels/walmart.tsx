"use client";

import {
  FULFILMENT_MODES,
  type FulfilmentMode,
  WALMART_FULFILMENT,
  WALMART_MARKETPLACES,
} from "@bookalyze/core";
import { KeyRound, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { addWalmartChannelAction, setChannelFulfilmentAction } from "../actions";
import type { ExistingChannel } from "./ebay";

const fulfilmentOptions = FULFILMENT_MODES.map((m) => ({
  value: m,
  label: WALMART_FULFILMENT[m].label,
  description: WALMART_FULFILMENT[m].hint,
}));

/** Adds a Walmart country (US, Canada or Mexico) as a channel, with who ships its orders. */
export function AddWalmartForm({
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
  const [fulfilment, setFulfilment] = useState<string>("seller");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const fulfilmentHint = WALMART_FULFILMENT[fulfilment as FulfilmentMode]?.hint;
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await addWalmartChannelAction(slug, { marketplace, fulfilment });
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
        <DialogTitle>Add a Walmart country</DialogTitle>
        <DialogDescription>
          Each country you sell in on Walmart is its own channel, in that country's currency.
        </DialogDescription>
      </DialogHeader>
      <Field label="Walmart country" htmlFor="walmart-marketplace" error={errors.marketplace}>
        <Combobox
          id="walmart-marketplace"
          value={marketplace}
          onChange={setMarketplace}
          invalid={Boolean(errors.marketplace)}
          options={WALMART_MARKETPLACES.map((m) => {
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
      <Field
        label="Who ships the orders?"
        htmlFor="walmart-fulfilment"
        error={errors.fulfilment}
        hint={fulfilmentHint}
      >
        <Combobox
          id="walmart-fulfilment"
          value={fulfilment}
          onChange={setFulfilment}
          invalid={Boolean(errors.fulfilment)}
          options={fulfilmentOptions}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <Plus />}
          Add country
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Who ships a Walmart country's orders, changed on its channel page. */
export function WalmartFulfilment({
  slug,
  channel,
  canManage,
}: {
  slug: string;
  channel: { id: string; name: string; fulfilment: FulfilmentMode | null };
  canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const ship = (fulfilment: string) =>
    start(async () => {
      const result = await setChannelFulfilmentAction(slug, channel.id, fulfilment);
      if (!result.ok) return void toast.error(result.message);
      toast.success("Saved", { description: result.label });
    });
  return (
    <Field
      label="Who ships the orders?"
      htmlFor={`fulfilment-${channel.id}`}
      hint={
        channel.fulfilment
          ? WALMART_FULFILMENT[channel.fulfilment].hint
          : "Walmart's warehouses (WFS), you, or both."
      }
    >
      <Combobox
        id={`fulfilment-${channel.id}`}
        aria-label={`Who ships ${channel.name} orders`}
        value={channel.fulfilment ?? ""}
        placeholder="Who ships the orders?"
        onChange={ship}
        options={fulfilmentOptions}
        disabled={!canManage || pending}
      />
    </Field>
  );
}

/** The Walmart account on a Walmart country's page. Connecting its API comes next. */
export function WalmartAccount() {
  return (
    <section
      aria-labelledby="walmart-account-heading"
      className="fade-in-0 grid animate-in gap-3 rounded-2xl border bg-card px-5 py-5 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-[18px]">
          <KeyRound />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="walmart-account-heading" className="font-semibold">
            Walmart account
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Connecting your Walmart account comes next: you'll create API keys in Walmart's
            Developer Portal and paste them here, and orders, payments and fees will come in by
            themselves. Until then, link this channel's SKUs to your products so they're ready.
          </p>
        </div>
      </div>
    </section>
  );
}
