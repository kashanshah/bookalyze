"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { ButtonLink } from "@/components/button";
import { Checklist } from "@/components/section";
import { ADD_ONS, type Interval, PACKAGES, PEGGED } from "@/content/pricing";
import { cn, SIGN_UP_URL } from "@/lib/site";

/** The three packages and the add-ons, monthly or yearly. Prices are per company. */
export function PricingTable() {
  const [interval, setInterval] = useState<Interval>("month");
  const price = (p: { monthly: number; yearly: number }) =>
    interval === "month" ? p.monthly : p.yearly;
  const per = interval === "month" ? "a month" : "a year";
  const local = (usd: number) =>
    PEGGED.map((c) => `${c.code} ${Math.round(usd * c.perUsd).toLocaleString("en-US")}`).join(
      " · ",
    );

  return (
    <div className="grid gap-10">
      <div className="flex justify-center">
        <fieldset className="inline-flex gap-1 rounded-xl border bg-card p-1 shadow-xs">
          <legend className="sr-only">Billing period</legend>
          {(
            [
              { id: "month", label: "Monthly" },
              { id: "year", label: "Yearly · 2 months free" },
            ] as const
          ).map((o) => (
            <label
              key={o.id}
              className={cn(
                "cursor-pointer rounded-lg px-4 py-2 font-medium text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-primary/30",
                interval === o.id
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name="interval"
                value={o.id}
                checked={interval === o.id}
                onChange={() => setInterval(o.id)}
                className="sr-only"
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {PACKAGES.map((p) => (
          <article
            key={p.id}
            aria-label={p.name}
            className={cn(
              "relative flex flex-col gap-6 rounded-3xl border bg-card p-7 shadow-xs",
              p.highlight && "border-primary shadow-primary/10 shadow-xl",
            )}
          >
            {p.highlight ? (
              <span className="absolute start-7 -top-3 rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground text-xs">
                Best value
              </span>
            ) : null}
            <div className="grid gap-1.5">
              <h2 className="font-semibold text-xl">{p.name}</h2>
              <p className="text-muted-foreground text-sm">{p.forWhom}</p>
            </div>
            <div className="grid gap-1">
              <p className="flex items-baseline gap-2">
                <span className="font-semibold text-4xl tabular-nums tracking-tight">
                  ${price(p)}
                </span>
                <span className="text-muted-foreground text-sm">{per}, per company</span>
              </p>
              <p className="text-muted-foreground text-xs">
                US dollars{PEGGED.length ? ` · about ${local(price(p))}` : ""}
              </p>
              <p className="mt-2 inline-flex w-fit items-center gap-2 rounded-full bg-success/12 px-2.5 py-1 font-medium text-success text-xs">
                <span className="size-1.5 rounded-full bg-success" />
                Free during early access, then a 30-day free trial
              </p>
            </div>
            <div className="grid gap-3">
              {p.builds ? <p className="font-medium text-sm">{p.builds}</p> : null}
              <Checklist items={p.includes} />
            </div>
            <ButtonLink
              href={SIGN_UP_URL}
              variant={p.highlight ? "primary" : "outline"}
              className="mt-auto w-full"
            >
              Start free
              <ArrowRight className="rtl:rotate-180" />
            </ButtonLink>
          </article>
        ))}
      </div>

      <div className="mx-auto grid w-full max-w-3xl gap-4 rounded-2xl border bg-card p-6 shadow-xs sm:p-7">
        <div className="grid gap-1">
          <h2 className="font-semibold text-lg">Add-ons for Seller</h2>
          <p className="text-muted-foreground text-sm">
            Add just what you need. Taking both costs more than Seller Plus, so we'd suggest that
            instead.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ADD_ONS.map((a) => (
            <li key={a.id} className="grid content-start gap-1.5 rounded-xl bg-accent/60 p-4">
              <p className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{a.name}</span>
                <span className="font-semibold tabular-nums">
                  +${price(a)}
                  <span className="font-normal text-muted-foreground text-xs"> {per}</span>
                </span>
              </p>
              <p className="text-muted-foreground text-sm leading-6">{a.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
