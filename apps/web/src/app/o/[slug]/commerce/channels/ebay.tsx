"use client";

import { EBAY_MARKETPLACES } from "@bookalyze/core";
import { Plus, Tag } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { addEbayChannelAction } from "../actions";

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

/** The eBay account behind a site: not connected yet (connecting comes next). */
export function EbayAccount() {
  return (
    <section
      aria-labelledby="account-heading"
      className="overflow-hidden rounded-2xl border bg-card shadow-xs"
    >
      <div className="flex items-start gap-3 px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Tag className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="account-heading" className="font-semibold">
            eBay account
          </h2>
          <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
            Connecting your eBay account will bring this site's orders and payouts in by themselves;
            it's being built now. Until then, link this site's SKUs to your products on Products, so
            its sales can carry their cost.
          </p>
        </div>
      </div>
    </section>
  );
}
