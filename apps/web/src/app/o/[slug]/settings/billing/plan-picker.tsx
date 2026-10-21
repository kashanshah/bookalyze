"use client";

import {
  BILLING_PACKAGES,
  type BillingInterval,
  PACKAGE_KEYS,
  type PackageKey,
  selectionTotal,
} from "@bookalyze/core";
import { Check, CreditCard } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { startCheckoutAction } from "./actions";

const INCLUDES: Record<PackageKey, string> = {
  books: "Accounting, banking, and your company's profile and calendar.",
  seller: "Everything in Books, plus Amazon, Walmart, Noon and eBay.",
  seller_reviews: "Everything in Seller, plus review requests, by hand or automatic.",
  seller_stock: "Everything in Seller, plus stock, purchase orders and cost of goods.",
  seller_plus: "Everything in Seller, plus stock, cost of goods and review requests.",
  reviews_only:
    "Amazon review requests on their own: connect your store and its orders come in. No books.",
};

const money = (amount: string) => `$${amount.replace(/\.00$/, "")}`;

/** Choose a package and how often to pay, then go to Stripe Checkout. */
export function PlanPicker({
  slug,
  suggested,
  canBuy,
  cta = "Continue to payment",
}: {
  slug: string;
  suggested: PackageKey;
  canBuy: boolean;
  /** The button's label, e.g. "Start 30 days free" at sign-up. */
  cta?: string;
}) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [pkg, setPkg] = useState<PackageKey>(suggested);
  const [pending, start] = useTransition();
  const total = selectionTotal({ package: pkg, interval });
  const per = interval === "year" ? "year" : "month";

  return (
    <div className="grid gap-5">
      <fieldset className="flex w-fit rounded-xl border bg-muted/40 p-1 text-sm">
        <legend className="sr-only">How often to pay</legend>
        {(["month", "year"] as const).map((value) => (
          <label
            key={value}
            className={cn(
              "cursor-pointer rounded-lg px-3.5 py-1.5 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
              interval === value ? "bg-card font-medium shadow-xs" : "text-muted-foreground",
            )}
          >
            <input
              type="radio"
              name="interval"
              value={value}
              checked={interval === value}
              onChange={() => setInterval(value)}
              className="sr-only"
            />
            {value === "month" ? "Monthly" : "Yearly · two months free"}
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="sr-only">Plan</legend>
        {PACKAGE_KEYS.map((key) => {
          const p = BILLING_PACKAGES[key];
          const on = pkg === key;
          return (
            <label
              key={key}
              className={cn(
                "grid cursor-pointer content-start gap-2 rounded-2xl border bg-card p-4 text-start shadow-xs transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                on ? "border-primary ring-1 ring-primary" : "hover:border-primary/30",
              )}
            >
              <input
                type="radio"
                name="package"
                value={key}
                checked={on}
                onChange={() => setPkg(key)}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{p.name}</span>
                {on ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                ) : null}
              </span>
              <span className="font-semibold text-2xl tabular-nums">
                {money(interval === "year" ? p.yearly : p.monthly)}
                <span className="font-normal text-muted-foreground text-sm"> / {per}</span>
              </span>
              <span className="text-muted-foreground text-sm leading-relaxed">{INCLUDES[key]}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
        <p className="text-sm">
          Total <span className="font-semibold tabular-nums">{money(total)}</span> a {per}, in US
          dollars, for this company
        </p>
        <Button
          disabled={!canBuy || pending}
          onClick={() =>
            start(async () => {
              const result = await startCheckoutAction(slug, { package: pkg, interval });
              if (!result.ok) {
                toast.error(result.message);
                return;
              }
              window.location.assign(result.url);
            })
          }
        >
          {pending ? <Spinner /> : <CreditCard />}
          {cta}
        </Button>
      </div>
    </div>
  );
}
