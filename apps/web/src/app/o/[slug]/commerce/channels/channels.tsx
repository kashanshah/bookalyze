"use client";

import { AMAZON_REGIONS, type AmazonRegion } from "@bookalyze/core";
import { CircleAlert, KeyRound, PlugZap, RefreshCw, ShoppingBag, Unplug } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  connectAmazonAction,
  disconnectAmazonAction,
  setChannelActiveAction,
  testAmazonAction,
} from "../actions";

type ConnectionView = {
  id: string;
  name: string;
  status: "active" | "error" | "disconnected";
  region: string;
  storeName: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  channels: {
    id: string;
    name: string;
    country: string | null;
    currency: string;
    isActive: boolean;
  }[];
};

export function ChannelsScreen({
  slug,
  locale,
  canManage,
  defaultRegion,
  connections,
}: {
  slug: string;
  locale: string;
  canManage: boolean;
  defaultRegion: AmazonRegion;
  connections: ConnectionView[];
}) {
  const [connecting, setConnecting] = useState<AmazonRegion | null>(null);
  const [key, setKey] = useState(0);
  const open = (region: AmazonRegion) => {
    setKey((k) => k + 1);
    setConnecting(region);
  };
  const live = connections.filter((c) => c.status !== "disconnected");

  return (
    <div className="grid gap-6">
      {live.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-12 shadow-xs">
          <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.06]" />
          <div className="relative mx-auto grid max-w-xl gap-5">
            <div className="flex flex-col items-center gap-4 text-center">
              <span className="zoom-in-75 flex size-14 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
                <ShoppingBag className="size-7" />
              </span>
              <div>
                <h2 className="font-semibold text-lg tracking-tight">
                  Connect Amazon Seller Central
                </h2>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                  Orders come in on their own, and you can ask buyers for reviews the way Amazon
                  allows. Bookalyze uses your own developer app, so your data stays between you and
                  Amazon.
                </p>
              </div>
            </div>
            <ol className="grid gap-2.5 rounded-xl border bg-background/60 p-4 text-sm">
              <li>
                <span className="font-medium">1.</span> In Seller Central, open{" "}
                <span className="font-medium">Apps and Services → Develop Apps</span> and add (or
                open) your private app.
              </li>
              <li>
                <span className="font-medium">2.</span> Give it these roles: Selling Partner
                Insights, Inventory and Order Tracking, and Buyer Communication.
              </li>
              <li>
                <span className="font-medium">3.</span> Copy its LWA client ID and client secret,
                then choose <span className="font-medium">Authorize</span> to get a refresh token.
              </li>
            </ol>
            <div className="flex justify-center">
              <Button onClick={() => open(defaultRegion)} disabled={!canManage}>
                <PlugZap />
                Connect Amazon
              </Button>
            </div>
            {canManage ? null : (
              <p className="text-center text-muted-foreground text-xs">
                Only owners and admins can connect accounts.
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          {live.map((c) => (
            <ConnectionCard
              key={c.id}
              slug={slug}
              locale={locale}
              canManage={canManage}
              connection={c}
              onReplace={() => open(c.region as AmazonRegion)}
            />
          ))}
          {canManage ? (
            <div>
              <Button
                variant="outline"
                onClick={() =>
                  open(
                    AMAZON_REGIONS.find((r) => !live.some((c) => c.region === r.key))?.key ??
                      defaultRegion,
                  )
                }
              >
                <PlugZap />
                Connect another region
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog open={connecting !== null} onOpenChange={(o) => (o ? null : setConnecting(null))}>
        <DialogContent>
          {connecting ? (
            <ConnectForm
              key={key}
              slug={slug}
              initialRegion={connecting}
              replacing={live.some((c) => c.region === connecting)}
              onDone={() => setConnecting(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectionCard({
  slug,
  locale,
  canManage,
  connection: c,
  onReplace,
}: {
  slug: string;
  locale: string;
  canManage: boolean;
  connection: ConnectionView;
  onReplace: () => void;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const run = (id: string, task: () => Promise<void>) =>
    start(async () => {
      setBusy(id);
      await task();
      setBusy(null);
    });
  const test = () =>
    run("test", async () => {
      const result = await testAmazonAction(slug, c.id);
      if (!result.ok) return void toast.error(result.message);
      toast.success("Amazon answered", {
        description: `Selling in ${result.marketplaces} ${result.marketplaces === 1 ? "marketplace" : "marketplaces"}.`,
      });
    });
  const toggle = (channelId: string, on: boolean) =>
    run(channelId, async () => {
      const result = await setChannelActiveAction(slug, channelId, on);
      if (!result.ok) toast.error(result.message);
    });
  const disconnect = () =>
    run("disconnect", async () => {
      const result = await disconnectAmazonAction(slug, c.id);
      if (!result.ok) return void toast.error(result.message);
      setConfirming(false);
      toast.success("Disconnected", {
        description: "The credentials are deleted. Orders already brought in stay.",
      });
    });
  const checked = c.lastSyncedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(c.lastSyncedAt),
      )
    : null;

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShoppingBag className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 font-semibold">
            {c.name}
            {c.status === "error" ? (
              <Badge variant="warning">Needs attention</Badge>
            ) : (
              <Badge variant="success">Connected</Badge>
            )}
          </h2>
          <p className="text-muted-foreground text-sm">
            {c.storeName ? `${c.storeName} · ` : ""}
            {checked ? `Last checked ${checked}` : "Not checked yet"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={test} disabled={pending}>
            {busy === "test" ? <Spinner /> : <RefreshCw />}
            Test connection
          </Button>
          {canManage ? (
            <>
              <Button variant="ghost" size="sm" onClick={onReplace} disabled={pending}>
                <KeyRound />
                Replace credentials
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
        </div>
      </div>
      {c.lastError ? (
        <p className="flex items-start gap-2 border-b bg-warning/10 px-5 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {c.lastError}
        </p>
      ) : null}
      <div className="px-5 pt-4 pb-1">
        <h3 className="font-medium text-sm">Marketplaces</h3>
        <p className="text-muted-foreground text-xs">
          Switched-on marketplaces bring in orders. You can change this any time.
        </p>
      </div>
      {c.channels.length ? (
        <ul className="divide-y">
          {c.channels.map((ch) => (
            <li key={ch.id} className="flex items-center gap-3 px-5 py-3">
              <div className={cn("min-w-0 flex-1", !ch.isActive && "opacity-60")}>
                <p className="font-medium text-sm">{ch.name}</p>
                <p className="text-muted-foreground text-xs">
                  {[ch.country, ch.currency].filter(Boolean).join(" · ")}
                </p>
              </div>
              {busy === ch.id ? <Spinner className="text-muted-foreground" /> : null}
              <Switch
                id={`channel-${ch.id}`}
                checked={ch.isActive}
                disabled={!canManage || pending}
                onCheckedChange={(on) => toggle(ch.id, on)}
                aria-label={`Bring in orders from ${ch.name}`}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-muted-foreground text-sm">
          Amazon didn't list any marketplaces for this account.
        </p>
      )}
    </section>
  );
}

function ConnectForm({
  slug,
  initialRegion,
  replacing,
  onDone,
}: {
  slug: string;
  initialRegion: AmazonRegion;
  replacing: boolean;
  onDone: () => void;
}) {
  const [region, setRegion] = useState<AmazonRegion>(initialRegion);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const hint = AMAZON_REGIONS.find((r) => r.key === region)?.hint;
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await connectAmazonAction(slug, {
            region,
            clientId,
            clientSecret,
            refreshToken,
          });
          if (!result.ok) {
            setErrors(result.errors ?? {});
            if (!result.errors) toast.error(result.message);
            return;
          }
          toast.success(replacing ? "Credentials replaced" : "Amazon connected", {
            description: `Selling in ${result.channels} ${result.channels === 1 ? "marketplace" : "marketplaces"}.`,
          });
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{replacing ? "Replace Amazon credentials" : "Connect Amazon"}</DialogTitle>
        <DialogDescription>
          From your app in Seller Central → Develop Apps. They're checked with Amazon, then stored
          encrypted; nobody can read them back.
        </DialogDescription>
      </DialogHeader>
      <Field label="Region" htmlFor="amazon-region" hint={hint} error={errors.region}>
        <Combobox
          id="amazon-region"
          value={region}
          onChange={(v) => setRegion(v as AmazonRegion)}
          options={AMAZON_REGIONS.map((r) => ({ value: r.key, label: r.label }))}
        />
      </Field>
      <Field label="LWA client ID" htmlFor="amazon-client-id" error={errors.clientId}>
        <Input
          id="amazon-client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="amzn1.application-oa2-client.…"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field label="LWA client secret" htmlFor="amazon-client-secret" error={errors.clientSecret}>
        <Input
          id="amazon-client-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          autoComplete="off"
        />
      </Field>
      <Field
        label="Refresh token"
        htmlFor="amazon-refresh-token"
        error={errors.refreshToken}
        hint="Shown once when you choose Authorize on your app. It starts with Atzr|."
      >
        <Input
          id="amazon-refresh-token"
          type="password"
          value={refreshToken}
          onChange={(e) => setRefreshToken(e.target.value)}
          autoComplete="off"
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
