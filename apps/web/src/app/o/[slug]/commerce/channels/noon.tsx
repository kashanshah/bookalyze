"use client";

import {
  FULFILMENT_MODES,
  type FulfilmentMode,
  NOON_FULFILMENT,
  NOON_MARKETPLACES,
} from "@bookalyze/core";
import {
  CircleAlert,
  Copy,
  FileKey,
  FileSearch,
  KeyRound,
  PlugZap,
  Plus,
  RefreshCw,
  Store,
  Unplug,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  addNoonChannelAction,
  checkNoonPayoutsReportAction,
  connectNoonAction,
  disconnectNoonAction,
  type NoonReportCheck,
  setChannelActiveAction,
  setChannelFulfilmentAction,
  testNoonAction,
} from "../actions";

export type NoonConnectionView = {
  status: "active" | "error" | "disconnected";
  projectCode: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  reports: number;
  payoutsReport: boolean;
};

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
  locale,
  canManage,
  defaultMarketplace,
  channels,
  connection,
}: {
  slug: string;
  locale: string;
  canManage: boolean;
  defaultMarketplace: string;
  channels: NoonChannelView[];
  connection: NoonConnectionView | null;
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
        <div className="min-w-0 flex-1 basis-[calc(100%-3.25rem)] sm:basis-0">
          <h2 id="noon-heading" className="font-semibold">
            Noon
          </h2>
          <p className="text-muted-foreground text-sm">
            Add each country you sell in on Noon and say who ships the orders. Its SKUs can then be
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
            Add a Noon country
          </Button>
        ) : null}
      </div>
      <NoonApi slug={slug} locale={locale} canManage={canManage} connection={connection} />
      {channels.length ? (
        <ul className="divide-y border-t">
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
        <div className="grid justify-items-start gap-3 border-t px-5 py-5">
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

/** Noon's API: the service-account key that lets Bookalyze download Noon's reports itself. */
function NoonApi({
  slug,
  locale,
  canManage,
  connection: c,
}: {
  slug: string;
  locale: string;
  canManage: boolean;
  connection: NoonConnectionView | null;
}) {
  const [connecting, setConnecting] = useState(false);
  const [key, setKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const live = c && c.status !== "disconnected" ? c : null;
  const open = () => {
    setKey((k) => k + 1);
    setConnecting(true);
  };
  const run = (id: string, task: () => Promise<void>) =>
    start(async () => {
      setBusy(id);
      await task();
      setBusy(null);
    });
  const test = () =>
    run("test", async () => {
      const result = await testNoonAction(slug);
      if (!result.ok) return void toast.error(result.message);
      toast.success("Noon answered", { description: reportsLine(result) });
    });
  const disconnect = () =>
    run("disconnect", async () => {
      const result = await disconnectNoonAction(slug);
      if (!result.ok) return void toast.error(result.message);
      setConfirming(false);
      toast.success("Noon disconnected", {
        description: "The key is deleted. Your Noon countries and everything brought in stay.",
      });
    });
  const checked = live?.lastSyncedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(live.lastSyncedAt),
      )
    : null;

  return (
    <div className="grid gap-3 bg-muted/30 px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-0">
          <h3 className="flex flex-wrap items-center gap-2 font-medium text-sm">
            Noon's API
            {live ? (
              live.status === "error" ? (
                <Badge variant="warning">Needs attention</Badge>
              ) : (
                <Badge variant="success">Connected</Badge>
              )
            ) : null}
          </h3>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {live
              ? [
                  live.projectCode ? `Project ${live.projectCode}` : null,
                  checked ? `Last checked ${checked}` : "Not checked yet",
                  reportsLine(live),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Connect it with your service account's key file, so Noon's reports come in by themselves. Without it, they can be uploaded by hand."}
          </p>
        </div>
        <div className="ms-7 flex flex-wrap gap-2 sm:ms-0">
          {live ? (
            <>
              <Button variant="outline" size="sm" onClick={test} disabled={pending}>
                {busy === "test" ? <Spinner /> : <RefreshCw />}
                Test connection
              </Button>
              {canManage ? (
                <>
                  <Button variant="ghost" size="sm" onClick={open} disabled={pending}>
                    <FileKey />
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
              Connect Noon's API
            </Button>
          ) : null}
        </div>
      </div>
      {live?.lastError ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {live.lastError}
        </p>
      ) : live && !live.lastError && !live.payoutsReport ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          Noon's payouts report (the transaction view) isn't among the reports this key can
          download. Give the service account a role that can see finance, then test again.
        </p>
      ) : null}
      {live?.payoutsReport && canManage ? <PayoutsReportCheck slug={slug} /> : null}

      <Dialog open={connecting} onOpenChange={setConnecting}>
        <DialogContent>
          {connecting ? (
            <ConnectNoonForm
              key={key}
              slug={slug}
              replacing={Boolean(live)}
              onDone={() => setConnecting(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function reportsLine(r: { reports: number; payoutsReport: boolean }) {
  const count = r.reports === 1 ? "1 report" : `${r.reports} reports`;
  return `${count} available${r.payoutsReport ? ", payouts included" : ""}`;
}

function ConnectNoonForm({
  slug,
  replacing,
  onDone,
}: {
  slug: string;
  replacing: boolean;
  onDone: () => void;
}) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!file) return setError("Choose the .json key file Noon downloaded.");
        start(async () => {
          const result = await connectNoonAction(slug, { keyFile: file.text });
          if (!result.ok) {
            setError(result.errors?.keyFile ?? result.message);
            return;
          }
          toast.success(result.replaced ? "Key replaced" : "Noon connected", {
            description: reportsLine(result),
          });
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>{replacing ? "Replace Noon's key" : "Connect Noon's API"}</DialogTitle>
        <DialogDescription>
          The key file is checked with Noon, then stored encrypted. Nobody can read it back, and you
          can delete the file from your computer afterwards.
        </DialogDescription>
      </DialogHeader>
      <ol className="grid gap-2.5 rounded-xl border bg-background/60 p-4 text-sm">
        <li>
          <span className="font-medium">1.</span> In{" "}
          <span className="font-medium">access.noon.partners → User &amp; Access → API Users</span>,
          choose <span className="font-medium">Add Service Account</span>.
        </li>
        <li>
          <span className="font-medium">2.</span> Give it a role that can download reports, such as
          Project Owner or Project Admin. Leave the IP whitelist empty: Bookalyze's servers don't
          have a fixed address.
        </li>
        <li>
          <span className="font-medium">3.</span> Noon downloads a{" "}
          <span className="font-medium">.json</span> key file once. Choose it below.
        </li>
      </ol>
      <Field
        label="Key file"
        htmlFor="noon-key-file"
        error={error ?? undefined}
        hint={file ? `Chosen: ${file.name}` : "The .json file, e.g. noon_credentials.json."}
      >
        <input
          ref={input}
          id="noon-key-file"
          type="file"
          accept=".json,application/json"
          aria-invalid={Boolean(error)}
          className="block w-full min-w-0 rounded-lg border border-input bg-card text-sm file:me-3 file:border-0 file:border-e file:bg-muted file:px-3 file:py-2 file:font-medium file:text-foreground"
          onChange={async (e) => {
            setError(null);
            const chosen = e.target.files?.[0];
            if (!chosen) return setFile(null);
            if (chosen.size > 20_000) {
              setFile(null);
              return setError("This file is too large to be a Noon key file.");
            }
            setFile({ name: chosen.name, text: await chosen.text() });
          }}
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

/**
 * Asks Noon for the last 7 days of its payouts report and shows what it is (CSV, Excel…), its
 * columns and how many rows: nothing is kept. Noon makes reports in the background, so this
 * asks again with the export's code until it's ready.
 */
function PayoutsReportCheck({ slug }: { slug: string }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<NoonReportCheck, { state: "ready" }> | null>(null);
  const run = async () => {
    setRunning(true);
    setResult(null);
    setProgress("Asking Noon for the last 7 days…");
    let exportCode: string | undefined;
    const giveUp = Date.now() + 6 * 60_000;
    try {
      while (Date.now() < giveUp) {
        const response = await checkNoonPayoutsReportAction(slug, { exportCode });
        if (!response.ok) return void toast.error(response.message);
        const check = response.check;
        if (check.state === "ready") {
          setResult(check);
          toast.success("Noon's payouts report checked");
          return;
        }
        exportCode = check.exportCode;
        setProgress(`Noon is making the report (${check.status.toLowerCase()})…`);
      }
      toast.error("Noon is still making the report. Try again in a few minutes.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };
  const preview = result?.preview;
  const kind = preview ? KIND_LABELS[preview.kind] : null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="outline" size="sm" onClick={run} disabled={running}>
          {running ? <Spinner /> : <FileSearch />}
          Check the payouts report
        </Button>
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {progress ??
            "Downloads the last 7 days once and shows its columns, so the next step can read it. Nothing is saved."}
        </p>
      </div>
      {result && preview ? (
        <div className="fade-in-0 grid animate-in gap-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm">
              <span className="font-medium">{kind}</span>
              {preview.gzip ? ", compressed" : ""} ·{" "}
              {preview.kind === "xlsx" || preview.kind === "zip"
                ? `${preview.columns.length} files inside`
                : `${preview.columns.length} columns`}
              {preview.rows !== null ? ` · ${preview.rows} rows` : ""}
              <span className="block text-muted-foreground text-xs">
                {result.from} to {result.to} · Noon export {result.exportCode}
              </span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(preview.columns.join("\n"));
                  toast.success("Column names copied");
                } catch {
                  toast.error("Couldn't copy. Select the names below instead.");
                }
              }}
            >
              <Copy />
              Copy names
            </Button>
          </div>
          <ul className="flex flex-wrap gap-1.5" aria-label="Columns in Noon's payouts report">
            {preview.columns.map((c, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: names can repeat; the list never reorders
                key={`${i}-${c}`}
                className="select-all rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-xs"
              >
                {c || "(blank)"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  csv: "CSV file",
  tsv: "Tab-separated file",
  xlsx: "Excel file",
  zip: "Zip file",
  json: "JSON file",
  unknown: "Unrecognised file",
};
