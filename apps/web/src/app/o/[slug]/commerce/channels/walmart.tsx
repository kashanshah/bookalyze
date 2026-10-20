"use client";

import {
  FULFILMENT_MODES,
  type FulfilmentMode,
  WALMART_FULFILMENT,
  WALMART_MARKETPLACES,
  WALMART_SCOPE_AREAS,
  type WalmartAccess,
  type WalmartScopeArea,
} from "@bookalyze/core";
import { CircleAlert, KeyRound, PlugZap, Plus, RefreshCw, Unplug } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  addWalmartChannelAction,
  connectWalmartAction,
  disconnectWalmartAction,
  setChannelFulfilmentAction,
  testWalmartAction,
} from "../actions";
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

export type WalmartConnectionView = {
  status: "active" | "error" | "disconnected";
  /** The client ID's last characters, so people can tell which key is saved. */
  clientIdEnding: string | null;
  scopes: Record<WalmartScopeArea, WalmartAccess> | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

const ACCESS_LABEL: Record<WalmartAccess, string> = {
  full_access: "Full access",
  view_only: "View only",
  no_access: "No access",
};

const missingLine = (missing: string[]) =>
  missing.length
    ? `This key can't see ${missing.join(" or ")} yet. Give it access in Walmart's Developer Portal, then test again.`
    : undefined;

/**
 * The Walmart seller account on a Walmart country's page: its API key (client ID and secret),
 * what the key may do, and Test connection, Replace key and Disconnect. Each country is its own
 * Walmart seller account, so each has its own key.
 */
export function WalmartAccount({
  slug,
  locale,
  canManage,
  channel,
  connection: c,
}: {
  slug: string;
  locale: string;
  canManage: boolean;
  channel: { id: string; name: string };
  connection: WalmartConnectionView | null;
}) {
  const [connecting, setConnecting] = useState(false);
  const [key, setKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"test" | "disconnect" | null>(null);
  const [pending, start] = useTransition();
  const live = c && c.status !== "disconnected" ? c : null;
  const open = () => {
    setKey((k) => k + 1);
    setConnecting(true);
  };
  const test = () =>
    start(async () => {
      setBusy("test");
      const result = await testWalmartAction(slug, channel.id);
      setBusy(null);
      if (!result.ok) return void toast.error(result.message);
      toast.success("Walmart answered", {
        description:
          missingLine(result.missing) ?? "The key works and can see what Bookalyze needs.",
      });
    });
  const disconnect = () =>
    start(async () => {
      setBusy("disconnect");
      const result = await disconnectWalmartAction(slug, channel.id);
      setBusy(null);
      if (!result.ok) return void toast.error(result.message);
      setConfirming(false);
      toast.success("Walmart disconnected", {
        description: `The key is deleted. ${channel.name} and everything brought in stay.`,
      });
    });
  const checked = live?.lastSyncedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(live.lastSyncedAt),
      )
    : null;
  const missing = live?.scopes
    ? WALMART_SCOPE_AREAS.filter((a) => live.scopes?.[a.key] === "no_access")
    : [];

  return (
    <section
      aria-labelledby="walmart-account-heading"
      className="fade-in-0 grid animate-in gap-4 rounded-2xl border bg-card px-5 py-5 shadow-xs"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <KeyRound className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-0">
          <h2
            id="walmart-account-heading"
            className="flex flex-wrap items-center gap-2 font-semibold"
          >
            Walmart account
            {live ? (
              live.status === "error" ? (
                <Badge variant="warning">Needs attention</Badge>
              ) : (
                <Badge variant="success">Connected</Badge>
              )
            ) : null}
          </h2>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {live
              ? [
                  live.clientIdEnding ? `Key ending ${live.clientIdEnding}` : null,
                  checked ? `Last checked ${checked}` : "Not checked yet",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : `Connect ${channel.name}'s seller account with an API key from Walmart's Developer Portal, so its orders, payments and fees can come in by themselves. Each Walmart country is its own seller account with its own key.`}
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
                  <Button variant="ghost" size="sm" onClick={open} disabled={pending}>
                    <KeyRound />
                    Replace key
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
            <Button variant="outline" size="sm" onClick={open}>
              <PlugZap />
              Connect Walmart
            </Button>
          ) : null}
        </div>
      </div>

      {live?.lastError ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {live.lastError}
        </p>
      ) : live && missing.length ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {missingLine(missing.map((m) => m.label))}
        </p>
      ) : null}

      {live?.scopes ? (
        <dl aria-label="What this key can see" className="grid gap-2 sm:grid-cols-3">
          {WALMART_SCOPE_AREAS.map((area) => {
            const access = live.scopes?.[area.key] ?? "no_access";
            return (
              <div key={area.key} className="rounded-xl border bg-background/60 px-3 py-2.5">
                <dt className="text-muted-foreground text-xs">{area.label}</dt>
                <dd
                  className={cn(
                    "font-medium text-sm",
                    access === "no_access" ? "text-warning" : "text-foreground",
                  )}
                >
                  {ACCESS_LABEL[access]}
                </dd>
                <dd className="text-muted-foreground text-xs">For {area.needed}</dd>
              </div>
            );
          })}
        </dl>
      ) : null}

      <Dialog open={connecting} onOpenChange={setConnecting}>
        <DialogContent>
          {connecting ? (
            <ConnectWalmartForm
              key={key}
              slug={slug}
              channel={channel}
              replacing={Boolean(live)}
              onDone={() => setConnecting(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ConnectWalmartForm({
  slug,
  channel,
  replacing,
  onDone,
}: {
  slug: string;
  channel: { id: string; name: string };
  replacing: boolean;
  onDone: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await connectWalmartAction(slug, {
            channelId: channel.id,
            clientId,
            clientSecret,
          });
          if (!result.ok) {
            setErrors(result.errors ?? {});
            if (!result.errors) toast.error(result.message);
            return;
          }
          toast.success(result.replaced ? "Key replaced" : `${channel.name} connected`, {
            description:
              missingLine(result.missing) ?? "The key works and can see what Bookalyze needs.",
          });
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {replacing ? `Replace ${channel.name}'s key` : `Connect ${channel.name}`}
        </DialogTitle>
        <DialogDescription>
          The key is checked with Walmart, then stored encrypted. Nobody can read the secret back.
        </DialogDescription>
      </DialogHeader>
      <ol className="grid gap-2.5 rounded-xl border bg-background/60 p-4 text-sm">
        <li>
          <span className="font-medium">1.</span> Sign in to Walmart's Developer Portal (
          <span className="font-medium">developer.walmart.com</span>) with your {channel.name}{" "}
          Seller Center account.
        </li>
        <li>
          <span className="font-medium">2.</span> Open API key management and add a key (or use an
          existing one) with access to Orders, Reports and Inventory. View only is enough.
        </li>
        <li>
          <span className="font-medium">3.</span> Copy its client ID and client secret here.
        </li>
      </ol>
      <Field label="Client ID" htmlFor="walmart-client-id" error={errors.clientId}>
        <Input
          id="walmart-client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(errors.clientId)}
          className="font-mono"
        />
      </Field>
      <Field
        label="Client secret"
        htmlFor="walmart-client-secret"
        error={errors.clientSecret}
        hint="Shown once in Walmart's portal when the key is made."
      >
        <Input
          id="walmart-client-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(errors.clientSecret)}
          className="font-mono"
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <PlugZap />}
          {replacing ? "Check and replace" : "Check and connect"}
        </Button>
      </DialogFooter>
    </form>
  );
}
