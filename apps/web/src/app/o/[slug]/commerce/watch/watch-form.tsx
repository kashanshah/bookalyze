"use client";

import {
  LISTING_CADENCES,
  LISTING_CHECKS,
  type ListingCadence,
  type ListingCheck,
  listingWatchIssue,
  reviewTopicsAvailableFor,
  reviewTopicsUnavailableNote,
} from "@bookalyze/core";
import { Check, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/choice-card";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { saveListingWatchAction } from "./actions";

export type WatchDraft = {
  id?: string;
  channelId: string;
  asin: string;
  checks: ListingCheck[];
  cadence: ListingCadence;
  notify: boolean;
  /** Up to two more people emailed about this product's changes. */
  notifyEmails: string[];
};

/** How many extra people one product can email. */
const MAX_EXTRA_EMAILS = 2;

const DEFAULT_CHECKS: ListingCheck[] = [
  "price",
  "featured",
  "offers",
  "content",
  "images",
  "rank",
  "reviews",
];

export function WatchForm({
  slug,
  channels,
  initial,
}: {
  slug: string;
  channels: { id: string; name: string }[];
  initial?: WatchDraft;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [channelId, setChannelId] = useState(initial?.channelId ?? channels[0]?.id ?? "");
  const [asin, setAsin] = useState(initial?.asin ?? "");
  const [checks, setChecks] = useState<ListingCheck[]>(initial?.checks ?? DEFAULT_CHECKS);
  const [cadence, setCadence] = useState<ListingCadence>(initial?.cadence ?? "daily");
  const [notify, setNotify] = useState(initial?.notify ?? true);
  const [emails, setEmails] = useState<string[]>(initial?.notifyEmails ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const issue = listingWatchIssue({ checks, cadence });
  const channelName = channels.find((channel) => channel.id === channelId)?.name ?? "";
  const reviewsHere = reviewTopicsAvailableFor(channelName);

  const toggle = (key: ListingCheck) => {
    setChecks((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
    setErrors((current) => ({ ...current, checks: "", cadence: "" }));
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveListingWatchAction(
        slug,
        {
          channelId,
          asin,
          checks,
          cadence,
          notify,
          notifyEmails: emails.map((email) => email.trim()).filter(Boolean),
        },
        initial?.id,
      );
      if (!result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message);
        return;
      }
      if (result.checkError) {
        toast.error(result.checkError, {
          description: "The product is saved. We'll try Amazon again on the next check.",
        });
      } else {
        toast.success(initial?.id ? "Watch updated" : "Watching this product", {
          description: initial?.id
            ? "The next check uses these settings."
            : "This first look is what later checks are compared with.",
        });
      }
      router.push(`/o/${slug}/commerce/watch/${result.id}`);
    });

  return (
    <form
      className="grid gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <section className="grid gap-5 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <div>
          <h2 className="font-medium">Which product</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Pick the marketplace, then the ASIN from the product page. The same product on another
            marketplace is watched on its own.
          </p>
        </div>
        {channels.length > 1 ? (
          <Field label="Marketplace" htmlFor="watch-channel" error={errors.channelId}>
            <Combobox
              id="watch-channel"
              value={channelId}
              onChange={(value) => {
                setChannelId(value);
                setErrors((current) => ({ ...current, channelId: "" }));
              }}
              options={channels.map((channel) => ({ value: channel.id, label: channel.name }))}
              placeholder="Choose a marketplace"
              invalid={Boolean(errors.channelId)}
            />
          </Field>
        ) : (
          <p className="text-sm">
            Marketplace <span className="font-medium">{channels[0]?.name}</span>
          </p>
        )}
        <Field
          label="ASIN"
          htmlFor="watch-asin"
          error={errors.asin}
          hint="10 letters and numbers, like B0XXXXXXXX."
        >
          <Input
            id="watch-asin"
            value={asin}
            onChange={(event) => {
              setAsin(event.target.value.toUpperCase());
              setErrors((current) => ({ ...current, asin: "" }));
            }}
            placeholder="B0XXXXXXXX"
            autoCapitalize="characters"
            spellCheck={false}
            className="tabular uppercase sm:max-w-xs"
            aria-invalid={Boolean(errors.asin)}
          />
        </Field>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <div>
          <h2 className="font-medium">What to watch</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Turn off anything you don't need an email about.
          </p>
        </div>
        <div className="grid gap-2">
          {LISTING_CHECKS.map((check) => {
            const on = checks.includes(check.key);
            const blocked = check.key === "reviews" && !reviewsHere;
            return (
              <label
                key={check.key}
                className={cn(
                  "flex gap-3 rounded-xl border p-3.5 transition-colors",
                  blocked ? "cursor-default opacity-80" : "cursor-pointer",
                  on ? "border-primary/50 bg-primary/[0.03]" : "hover:bg-muted/40",
                  blocked && !on && "hover:bg-transparent",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={blocked && !on}
                  onChange={() => {
                    if (blocked && !on) return;
                    toggle(check.key);
                  }}
                />
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border",
                    on ? "border-primary bg-primary text-primary-foreground" : "bg-background",
                  )}
                >
                  {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-sm">{check.label}</span>
                  <span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed">
                    {blocked ? reviewTopicsUnavailableNote(channelName) : check.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.checks ? <p className="text-destructive text-xs">{errors.checks}</p> : null}
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <div>
          <h2 className="font-medium">How often</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Daily suits almost every product. Hourly is for price and offers on a short list.
          </p>
        </div>
        <ChoiceCards
          name="cadence"
          value={cadence}
          onChange={(value) => {
            setCadence(value as ListingCadence);
            setErrors((current) => ({ ...current, cadence: "" }));
          }}
          choices={LISTING_CADENCES.map((item) => ({
            value: item.key,
            label: item.label,
            description: item.hint,
          }))}
          columns={3}
        />
        {issue || errors.cadence ? (
          <p className="text-destructive text-sm">{errors.cadence || issue}</p>
        ) : null}
        <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
          <span>
            <span className="block font-medium text-sm">Email when something changes</span>
            <span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed">
              Owners and admins get one email. A check that finds nothing stays quiet.
            </span>
          </span>
          <Switch
            checked={notify}
            onCheckedChange={setNotify}
            aria-label="Email when something changes"
          />
        </div>
        <div className="grid gap-3 rounded-xl border p-4">
          <span>
            <span className="block font-medium text-sm">Also email (optional)</span>
            <span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed">
              Up to {MAX_EXTRA_EMAILS} more people, such as a teammate or your sourcing agent. They
              get this product's changes only, even with the switch above off.
            </span>
          </span>
          {emails.map((email, index) => {
            const error = errors[`notifyEmails.${index}`];
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; order is stable.
              <div key={index} className="fade-in-0 grid animate-in gap-1">
                <div className="flex items-center gap-2">
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    aria-label={`Extra email ${index + 1}`}
                    value={email}
                    placeholder="name@example.com"
                    aria-invalid={Boolean(error)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setEmails((current) => current.map((e, i) => (i === index ? value : e)));
                      setErrors((current) => ({ ...current, [`notifyEmails.${index}`]: "" }));
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove extra email ${index + 1}`}
                    onClick={() => {
                      setEmails((current) => current.filter((_, i) => i !== index));
                      setErrors((current) => ({
                        ...current,
                        "notifyEmails.0": "",
                        "notifyEmails.1": "",
                      }));
                    }}
                  >
                    <X />
                  </Button>
                </div>
                {error ? <p className="text-destructive text-xs">{error}</p> : null}
              </div>
            );
          })}
          {emails.length < MAX_EXTRA_EMAILS ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setEmails((current) => [...current, ""])}
            >
              <Plus />
              {emails.length ? "Add another person" : "Add a person"}
            </Button>
          ) : null}
        </div>
      </section>

      <p className="text-muted-foreground text-sm leading-relaxed">
        Amazon doesn't share star ratings, the text of each review, Amazon's Choice, or how many
        were bought recently. Best seller rank is the number in a category, not the badge on the
        page.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || Boolean(issue)}>
          {pending ? <Spinner /> : null}
          {initial?.id ? "Save" : "Watch this product"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        {!initial?.id ? (
          <p className="text-muted-foreground text-xs">
            The first look usually takes a few seconds.
          </p>
        ) : null}
      </div>
    </form>
  );
}
