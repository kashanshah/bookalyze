"use client";

import { formatMoney } from "@bookalyze/core";
import { ExternalLink, Link2 } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import {
  type BalanceChoice,
  checkWiseTokenAction,
  connectWiseAction,
  wiseBalancesAction,
} from "../actions";
import { summaryMessage } from "./summary";

type Profile = { id: number; type: string; name: string };
type Setup = {
  balances: BalanceChoice[];
  bankAccounts: { id: string; label: string; currency: string | null }[];
  feeAccounts: { id: string; label: string }[];
  defaultSyncFrom: string;
  defaultFeeAccountId: string | null;
};

/** Connect Wise in three steps: paste a token, pick the profile, choose the balances. */
export function ConnectWiseDialog({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Link2 />
          Connect Wise
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        {open ? <ConnectWiseFlow slug={slug} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ConnectWiseFlow({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string>();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [syncFrom, setSyncFrom] = useState("");
  const [feeAccountId, setFeeAccountId] = useState("");
  const [formError, setFormError] = useState<string>();

  const loadBalances = (p: Profile) =>
    start(async () => {
      setProfile(p);
      const result = await wiseBalancesAction(slug, token, p.id);
      if (!result.ok) return void setFormError(result.message);
      setSetup(result);
      setSyncFrom(result.defaultSyncFrom);
      setFeeAccountId(result.defaultFeeAccountId ?? "");
      // Each balance fills an existing account in its currency if there's exactly one, else a new one.
      setTargets(
        Object.fromEntries(
          result.balances.map((b) => {
            const same = result.bankAccounts.filter((a) => a.currency === b.currency);
            return [b.id, same.length === 1 && same[0] ? same[0].id : "new"];
          }),
        ),
      );
    });

  const checkToken = () =>
    start(async () => {
      setTokenError(undefined);
      setFormError(undefined);
      const result = await checkWiseTokenAction(slug, token);
      if (!result.ok) {
        setTokenError(result.errors?.token ?? result.message);
        return;
      }
      setProfiles(result.profiles);
      // One profile: straight to its balances. Several: let them pick (usually the business).
      const only = result.profiles.length === 1 ? result.profiles[0] : undefined;
      if (only) loadBalances(only);
    });

  const connect = () =>
    start(async () => {
      if (!setup || !profile) return;
      setFormError(undefined);
      const result = await connectWiseAction(slug, {
        token,
        profileId: profile.id,
        profileName: profile.name,
        syncFrom,
        feeAccountId: feeAccountId || null,
        balances: setup.balances.map((b) => ({ id: b.id, target: targets[b.id] ?? "skip" })),
      });
      if (!result.ok) return void setFormError(result.message);
      const { description } = summaryMessage(result.summary);
      toast.success("Wise connected", { description });
      onDone();
    });

  // Step 3: balances.
  if (setup && profile) {
    const chosen = setup.balances.filter((b) => targets[b.id] !== "skip").length;
    return (
      <div className="grid gap-5">
        <DialogHeader>
          <DialogTitle>Choose what to bring in</DialogTitle>
          <DialogDescription>
            Each Wise balance fills one bank account in Bookalyze. Use an existing account if you
            already track this balance, or let Bookalyze create one.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3">
          {setup.balances.map((b) => {
            const options = [
              { value: "new", label: `New account “Wise ${b.currency}”` },
              ...setup.bankAccounts
                .filter((a) => !a.currency || a.currency === b.currency)
                .map((a) => ({ value: a.id, label: a.label })),
              { value: "skip", label: "Don't bring this one in" },
            ];
            return (
              <li
                key={b.id}
                className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[8rem_1fr] sm:items-center"
              >
                <span>
                  <span className="block font-medium">{b.name ?? `${b.currency} balance`}</span>
                  <span className="tabular block text-muted-foreground text-xs">
                    {formatMoney(b.amount, b.currency)}
                  </span>
                </span>
                <Combobox
                  id={`balance-${b.id}`}
                  aria-label={`Account for the ${b.currency} balance`}
                  value={targets[b.id] ?? "new"}
                  onChange={(v) => setTargets((t) => ({ ...t, [b.id]: v }))}
                  options={options}
                  searchable={options.length > 6}
                />
              </li>
            );
          })}
        </ul>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Bring in transactions from"
            htmlFor="sync-from"
            hint="Usually the day your books in Bookalyze start. Earlier transactions stay out, so nothing is counted twice."
          >
            <Input
              id="sync-from"
              type="date"
              value={syncFrom}
              onChange={(e) => setSyncFrom(e.target.value)}
            />
          </Field>
          <Field
            label="Wise fees go to"
            htmlFor="fee-account"
            hint="Fees Wise takes on cards, transfers and conversions."
          >
            <Combobox
              id="fee-account"
              value={feeAccountId}
              onChange={setFeeAccountId}
              options={setup.feeAccounts.map((a) => ({ value: a.id, label: a.label }))}
            />
          </Field>
        </div>
        {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSetup(null)} disabled={pending}>
            Back
          </Button>
          <Button type="button" onClick={connect} disabled={pending || chosen === 0 || !syncFrom}>
            {pending ? <Spinner /> : null}
            {pending
              ? "Connecting and syncing…"
              : `Connect ${chosen} balance${chosen === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  // Step 2: several profiles (personal and business).
  if (profiles && profiles.length > 1) {
    return (
      <div className="grid gap-5">
        <DialogHeader>
          <DialogTitle>Which Wise profile?</DialogTitle>
          <DialogDescription>
            Your Wise login has more than one. Pick the one for this company.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadBalances(p)}
              disabled={pending}
              className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-start transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
            >
              <span>
                <span className="block font-medium">{p.name}</span>
                <span className="block text-muted-foreground text-xs capitalize">{p.type}</span>
              </span>
              {pending && profile?.id === p.id ? <Spinner /> : null}
            </button>
          ))}
        </div>
        {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
      </div>
    );
  }

  // Step 1: the token.
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        checkToken();
      }}
    >
      <DialogHeader>
        <DialogTitle>Connect Wise</DialogTitle>
        <DialogDescription>
          Bookalyze reads your balances and statements with an API token. It can't send money.
        </DialogDescription>
      </DialogHeader>
      <ol className="grid list-decimal gap-1.5 ps-5 text-muted-foreground text-sm">
        <li>
          In Wise, open{" "}
          <a
            href="https://wise.com/settings/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            Settings → API tokens
            <ExternalLink className="size-3" />
          </a>{" "}
          (on the business profile, for a company).
        </li>
        <li>
          Add a new token with <span className="font-medium text-foreground">Read only</span>{" "}
          permission.
        </li>
        <li>Copy it and paste it below. It's stored encrypted and only used to sync.</li>
      </ol>
      <Field label="API token" htmlFor="wise-token" error={tokenError}>
        <PasswordInput
          id="wise-token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the token from Wise"
          aria-invalid={tokenError ? true : undefined}
        />
      </Field>
      {formError ? <p className="text-destructive text-sm">{formError}</p> : null}
      <DialogFooter>
        <Button type="submit" disabled={pending || !token.trim()}>
          {pending ? <Spinner /> : null}
          {pending ? "Checking with Wise…" : "Continue"}
        </Button>
      </DialogFooter>
    </form>
  );
}
