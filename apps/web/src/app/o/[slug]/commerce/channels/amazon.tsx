"use client";

import { AMAZON_REGIONS, type AmazonRegion } from "@bookalyze/core";
import { CircleAlert, KeyRound, PlugZap, RefreshCw, ShoppingBag, Unplug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

export type AmazonConnectionView = {
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

/**
 * The Amazon seller account a marketplace comes from: one set of credentials per region, shared
 * by every marketplace of that region (Amazon.ca and Amazon.com, say). Test, replace or
 * disconnect it, and switch its other marketplaces on or off.
 */
export function AmazonAccount({
  slug,
  locale,
  canManage,
  connection: c,
  channelId,
}: {
  slug: string;
  locale: string;
  canManage: boolean;
  connection: AmazonConnectionView;
  /** The channel whose page this is; the account's other marketplaces are listed. */
  channelId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState(0);
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
  const toggle = (id: string, on: boolean) =>
    run(id, async () => {
      const result = await setChannelActiveAction(slug, id, on);
      if (!result.ok) toast.error(result.message);
    });
  const disconnect = () =>
    run("disconnect", async () => {
      const result = await disconnectAmazonAction(slug, c.id);
      if (!result.ok) return void toast.error(result.message);
      setConfirming(false);
      toast.success("Disconnected", {
        description:
          "The credentials are deleted. Its orders are kept but hidden, and come back if you connect this account again.",
      });
      router.push(`/o/${slug}/commerce/channels`);
    });
  const checked = c.lastSyncedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(c.lastSyncedAt),
      )
    : null;
  const others = c.channels.filter((ch) => ch.id !== channelId);

  return (
    <section
      aria-labelledby="account-heading"
      className="overflow-hidden rounded-2xl border bg-card shadow-xs"
    >
      <div className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShoppingBag className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-0">
          <h2 id="account-heading" className="flex flex-wrap items-center gap-2 font-semibold">
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
        <div className="ms-13 flex flex-wrap gap-2 sm:ms-0">
          <Button variant="outline" size="sm" onClick={test} disabled={pending}>
            {busy === "test" ? <Spinner /> : <RefreshCw />}
            Test connection
          </Button>
          {canManage ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setKey((k) => k + 1);
                  setReplacing(true);
                }}
                disabled={pending}
              >
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
        <h3 className="font-medium text-sm">Other marketplaces on this account</h3>
        <p className="text-muted-foreground text-xs">
          They share these credentials. Switched-on marketplaces bring in orders.
        </p>
      </div>
      {others.length ? (
        <ul className="divide-y">
          {others.map((ch) => (
            <li key={ch.id} className="flex items-center gap-3 px-5 py-3">
              <div className={cn("min-w-0 flex-1", !ch.isActive && "opacity-60")}>
                <Link
                  href={`/o/${slug}/commerce/channels/${ch.id}`}
                  className="font-medium text-sm underline-offset-4 hover:underline"
                >
                  {ch.name}
                </Link>
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
        <p className="px-5 pt-1 pb-4 text-muted-foreground text-sm">
          Amazon doesn't list any other marketplace for this account.
        </p>
      )}

      <Dialog open={replacing} onOpenChange={setReplacing}>
        <DialogContent>
          {replacing ? (
            <ConnectAmazonForm
              key={key}
              slug={slug}
              initialRegion={c.region as AmazonRegion}
              replacing
              onCancel={() => setReplacing(false)}
              onDone={(connectionId) => {
                setReplacing(false);
                // Another seller account's credentials start a new connection, with new
                // channels: this page's channel is hidden with the old account's orders.
                if (connectionId && connectionId !== c.id) {
                  router.push(`/o/${slug}/commerce/channels`);
                }
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** How to get the credentials, shown before the form when Amazon is added. */
export function AmazonSteps() {
  return (
    <ol className="grid gap-2 rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed">
      <li>
        <span className="font-medium">1.</span> In Seller Central, open{" "}
        <span className="font-medium">Apps and Services → Develop Apps</span> and add (or open) your
        private app.
      </li>
      <li>
        <span className="font-medium">2.</span> Give it these roles: Selling Partner Insights,
        Inventory and Order Tracking, Finance and Accounting (for refunds), and Buyer Communication.
        Add Tax Invoicing only when your developer profile already has that role. A role the profile
        does not have makes Amazon refuse the connection check.
      </li>
      <li>
        <span className="font-medium">3.</span> Copy its LWA client ID and client secret, then
        choose <span className="font-medium">Authorize</span> to get a refresh token.
      </li>
    </ol>
  );
}

export function ConnectAmazonForm({
  slug,
  initialRegion,
  replacing,
  onDone,
  onBack,
  onCancel,
}: {
  slug: string;
  initialRegion: AmazonRegion;
  replacing: boolean;
  /** Called with the connection the credentials ended up on. */
  onDone: (connectionId: string) => void;
  /** Back to choosing a platform (when adding a channel). */
  onBack?: () => void;
  onCancel?: () => void;
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
          const selling = `Selling in ${result.channels} ${result.channels === 1 ? "marketplace" : "marketplaces"}.`;
          toast.success(result.moved || !replacing ? "Amazon connected" : "Credentials replaced", {
            description: result.moved
              ? `These credentials are for ${result.regionLabel}, so the account was connected there. ${selling}`
              : selling,
          });
          onDone(result.connectionId);
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{replacing ? "Replace Amazon credentials" : "Connect Amazon"}</DialogTitle>
        <DialogDescription>
          Each Amazon region is one seller account, and its marketplaces become your channels. The
          credentials are checked with Amazon, then stored encrypted; nobody can read them back.
          {replacing
            ? " If they're for a different seller account, it starts fresh, and this account's orders are hidden until it's connected again."
            : null}
        </DialogDescription>
      </DialogHeader>
      {replacing ? null : <AmazonSteps />}
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
        <Button type="button" variant="outline" onClick={onBack ?? onCancel}>
          {onBack ? "Back" : "Cancel"}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : <PlugZap />}
          {replacing ? "Check and replace" : "Check and connect"}
        </Button>
      </DialogFooter>
    </form>
  );
}
