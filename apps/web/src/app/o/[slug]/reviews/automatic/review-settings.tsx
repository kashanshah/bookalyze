"use client";

import {
  REVIEW_DELAY_MAX,
  REVIEW_DELAY_MIN,
  type ReviewFulfillment,
  type ReviewSettings,
} from "@bookalyze/core";
import { Boxes, Info, Package, Plus, Truck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceCards } from "@/components/ui/choice-card";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { saveReviewSettingsAction } from "../actions";
import { dayLabel, hourLabel, scheduleSummary, WEEK } from "../schedule";

const DELAYS = Array.from(
  { length: REVIEW_DELAY_MAX - REVIEW_DELAY_MIN + 1 },
  (_, i) => REVIEW_DELAY_MIN + i,
);
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("grid gap-5 rounded-2xl border bg-card p-5 shadow-xs sm:p-6", className)}
    >
      <div>
        <h2 className="font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block font-medium text-sm">{label}</span>
        <span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function ReviewSettingsForm({
  slug,
  initial,
  channels,
  skus,
  locale,
  timezone,
  today,
  canManage,
}: {
  slug: string;
  initial: ReviewSettings;
  channels: { id: string; name: string }[];
  skus: string[];
  locale: string;
  timezone: string;
  today: string;
  canManage: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [s, setS] = useState<ReviewSettings>(() =>
    // Turning it on for the first time starts from today unless chosen otherwise.
    initial.enabled || initial.startsFrom ? initial : { ...initial, startsFrom: today },
  );
  const [sku, setSku] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();
  const set = <K extends keyof ReviewSettings>(key: K, value: ReviewSettings[K]) =>
    setS((prev) => ({ ...prev, [key]: value }));
  const disabled = !canManage || saving;

  const chosenChannels = s.channelIds ?? channels.map((c) => c.id);
  const toggleChannel = (channelId: string) => {
    const next = chosenChannels.includes(channelId)
      ? chosenChannels.filter((c) => c !== channelId)
      : [...chosenChannels, channelId];
    set("channelIds", next.length === channels.length ? null : next);
  };
  const toggleDay = (day: number) =>
    set(
      "sendDays",
      s.sendDays.includes(day) ? s.sendDays.filter((d) => d !== day) : [...s.sendDays, day],
    );
  const addSku = () => {
    const value = sku.trim();
    if (value && !s.excludedSkus.includes(value)) set("excludedSkus", [...s.excludedSkus, value]);
    setSku("");
  };

  const save = () =>
    startSaving(async () => {
      setErrors({});
      const result = await saveReviewSettingsAction(slug, s);
      if (!result.ok) {
        setErrors(result.errors ?? {});
        return void toast.error(result.message);
      }
      router.refresh();
      toast.success(s.enabled ? "Automatic requests are on" : "Saved", {
        description: s.enabled
          ? result.planned
            ? `${result.planned} ${result.planned === 1 ? "order" : "orders"} planned. See “Scheduled” on Review requests.`
            : "New orders are planned as they ship."
          : "No requests go out automatically.",
      });
    });

  return (
    <div className="grid gap-6">
      <section
        className={cn(
          "flex items-start justify-between gap-4 rounded-2xl border p-5 shadow-xs transition-colors sm:p-6",
          s.enabled ? "border-success/30 bg-success/5" : "bg-card",
        )}
      >
        <label htmlFor={`${id}-enabled`} className="min-w-0 cursor-pointer">
          <span className="block font-semibold tracking-tight">Ask every buyer automatically</span>
          <span className="mt-1 block text-muted-foreground text-sm leading-relaxed">
            {s.enabled
              ? `On: ${scheduleSummary(s, locale)}.`
              : "Off: requests only go out when you ask from the list."}
          </span>
        </label>
        <Switch
          id={`${id}-enabled`}
          checked={s.enabled}
          onCheckedChange={(v) => set("enabled", v)}
          disabled={disabled}
        />
      </section>

      <div className="flex gap-3 rounded-xl bg-primary/5 px-4 py-3 text-sm leading-relaxed">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Your Amazon app needs the <strong className="font-medium">Buyer Solicitation</strong> role
          to send requests, and <strong className="font-medium">Finance and Accounting</strong> to
          spot refunds. Add them in Seller Central → Develop Apps → Edit app, then authorize the app
          again and paste the new refresh token in{" "}
          <Link
            href={`/o/${slug}/commerce/channels`}
            className="text-primary underline-offset-4 hover:underline"
          >
            Channels
          </Link>
          . Amazon writes the message itself: it can't be changed, and only one request per order is
          allowed.
        </p>
      </div>

      <div className={cn("grid gap-6 transition-opacity", !s.enabled && "opacity-70")}>
        <Section
          title="When to ask"
          description="Amazon takes requests from 5 to 30 days after delivery. Most sellers ask after 7 to 10 days, once the buyer has had time to use the product."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Days after delivery"
              htmlFor={`${id}-days`}
              hint="Counted from Amazon's latest delivery date."
              error={errors.daysAfterDelivery}
            >
              <Combobox
                id={`${id}-days`}
                value={String(s.daysAfterDelivery)}
                onChange={(v) => set("daysAfterDelivery", Number(v))}
                options={DELAYS.map((d) => ({
                  value: String(d),
                  label: `${d} days after delivery`,
                }))}
                searchable={false}
                disabled={disabled}
                invalid={Boolean(errors.daysAfterDelivery)}
              />
            </Field>
            <Field
              label="Time of day"
              htmlFor={`${id}-hour`}
              hint={`In your company's time (${timezone.replaceAll("_", " ")}). Amazon delivers the email when it's ready, usually within the hour.`}
            >
              <Combobox
                id={`${id}-hour`}
                value={String(s.sendHour)}
                onChange={(v) => set("sendHour", Number(v))}
                options={HOURS.map((h) => ({ value: String(h), label: hourLabel(h, locale) }))}
                searchable={false}
                disabled={disabled}
              />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 font-medium text-sm">Days of the week</legend>
            <div className="flex flex-wrap gap-2">
              {WEEK.map((d) => {
                const on = s.sendDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(d)}
                    disabled={disabled}
                    title={dayLabel(d, locale, "long")}
                    className={cn(
                      "h-9 min-w-12 rounded-lg border px-3 font-medium text-sm transition-colors disabled:cursor-not-allowed",
                      on
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {dayLabel(d, locale)}
                  </button>
                );
              })}
            </div>
            <p
              className={cn(
                "text-xs",
                errors.sendDays ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {errors.sendDays ??
                "On other days, requests wait for the next chosen day (never past Amazon's window)."}
            </p>
          </fieldset>
        </Section>

        <Section
          title="Which orders"
          description="Orders left out here can still be asked by hand."
        >
          {channels.length > 1 ? (
            <div className="grid gap-2">
              <p className="font-medium text-sm">Marketplaces</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {channels.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
                  >
                    <Checkbox
                      checked={chosenChannels.includes(c.id)}
                      label={c.name}
                      onChange={() => !disabled && toggleChannel(c.id)}
                    />
                    <span className="text-sm">{c.name}</span>
                  </div>
                ))}
              </div>
              {errors.channelIds ? (
                <p className="text-destructive text-xs">{errors.channelIds}</p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-2">
            <p className="font-medium text-sm">Shipped by</p>
            <ChoiceCards
              name={`${id}-fulfillment`}
              value={s.fulfillment}
              onChange={(v) => !disabled && set("fulfillment", v as ReviewFulfillment)}
              columns={3}
              choices={[
                { value: "all", label: "Any", description: "Every order", icon: <Boxes /> },
                {
                  value: "amazon",
                  label: "Amazon (FBA)",
                  description: "Orders Amazon shipped",
                  icon: <Package />,
                },
                {
                  value: "merchant",
                  label: "You (FBM)",
                  description: "Orders you shipped",
                  icon: <Truck />,
                },
              ]}
            />
          </div>
          <div className="grid gap-4 border-t pt-5">
            <Toggle
              id={`${id}-refunded`}
              label="Skip refunded orders"
              hint="Checked with Amazon just before sending. Also skips A-to-z claims and chargebacks."
              checked={s.skipRefunded}
              onChange={(v) => set("skipRefunded", v)}
              disabled={disabled}
            />
            <Toggle
              id={`${id}-replacements`}
              label="Skip replacement orders"
              hint="Free replacements Amazon sent after a problem."
              checked={s.skipReplacements}
              onChange={(v) => set("skipReplacements", v)}
              disabled={disabled}
            />
            <Toggle
              id={`${id}-business`}
              label="Skip business orders"
              hint="Amazon Business buyers, who rarely leave reviews."
              checked={s.skipBusiness}
              onChange={(v) => set("skipBusiness", v)}
              disabled={disabled}
            />
            <Toggle
              id={`${id}-promotions`}
              label="Skip orders bought with a promotion"
              hint="Any item with a coupon or promotion discount."
              checked={s.skipPromotions}
              onChange={(v) => set("skipPromotions", v)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-2 border-t pt-5">
            <Field
              label="Products to leave out"
              htmlFor={`${id}-sku`}
              hint="Orders with any of these SKUs aren't asked automatically."
            >
              <div className="flex gap-2">
                <Input
                  id={`${id}-sku`}
                  list={`${id}-skus`}
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSku();
                    }
                  }}
                  placeholder="SKU"
                  disabled={disabled}
                />
                <datalist id={`${id}-skus`}>
                  {skus
                    .filter((k) => !s.excludedSkus.includes(k))
                    .map((k) => (
                      <option key={k} value={k} />
                    ))}
                </datalist>
                <Button
                  type="button"
                  variant="outline"
                  onClick={addSku}
                  disabled={disabled || !sku.trim()}
                >
                  <Plus />
                  Add
                </Button>
              </div>
            </Field>
            {s.excludedSkus.length ? (
              <ul className="flex flex-wrap gap-2">
                {s.excludedSkus.map((k) => (
                  <li
                    key={k}
                    className="zoom-in-95 fade-in-0 inline-flex animate-in items-center gap-1 rounded-full border bg-muted/40 py-1 ps-3 pe-1 text-xs"
                  >
                    <span className="tabular">{k}</span>
                    <button
                      type="button"
                      onClick={() =>
                        set(
                          "excludedSkus",
                          s.excludedSkus.filter((x) => x !== k),
                        )
                      }
                      disabled={disabled}
                      aria-label={`Stop leaving out ${k}`}
                      className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Section>

        <Section
          title="Start with"
          description="Orders already asked (here or in Seller Central) are never asked twice."
        >
          <ChoiceCards
            name={`${id}-start`}
            value={s.startsFrom ? "from" : "recent"}
            onChange={(v) =>
              !disabled && set("startsFrom", v === "from" ? (initial.startsFrom ?? today) : null)
            }
            choices={[
              {
                value: "from",
                label: `Orders delivered from ${formatDate(s.startsFrom ?? initial.startsFrom ?? today, locale)}`,
                description: "Only new deliveries are asked.",
              },
              {
                value: "recent",
                label: "Also recent orders",
                description: "Every order still within Amazon's 30-day window is asked too.",
              },
            ]}
          />
        </Section>
      </div>

      {canManage ? (
        <div className="sticky bottom-4 z-10 flex justify-end">
          <Button size="lg" onClick={save} disabled={saving} className="shadow-lg">
            {saving ? <Spinner /> : null}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          An owner or admin can change automatic requests.
        </p>
      )}
    </div>
  );
}
