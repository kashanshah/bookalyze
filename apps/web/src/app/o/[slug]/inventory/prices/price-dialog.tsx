"use client";

import { LARGE_PRICE_CHANGE_PERCENT, parseDecimal, priceChangePercent } from "@bookalyze/core";
import { AlertTriangle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Amount } from "@/components/accounting/amount";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { PriceEstimate } from "@/server/amazon-prices";
import { changePriceAction, estimatePriceAction } from "./actions";

const PRICE = /^\d+([.,]\d{1,2})?$/;

export function PriceDialog({
  slug,
  channelId,
  channelName,
  sku,
  what,
  currency,
  currentPrice,
  locale,
}: {
  slug: string;
  channelId: string;
  channelName: string;
  sku: string;
  what: string;
  currency: string;
  currentPrice: string;
  locale: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [estimate, setEstimate] = useState<PriceEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, start] = useTransition();
  const latest = useRef(0);
  const id = `price-${channelId}-${sku}`;

  const valid = PRICE.test(price.trim()) && Number(price.replace(",", ".")) > 0;
  const typed = valid ? price.trim().replace(",", ".") : null;
  const change = typed ? priceChangePercent(currentPrice, typed) : null;
  const large = change !== null && Math.abs(Number(change)) >= LARGE_PRICE_CHANGE_PERCENT;
  const same = typed !== null && parseDecimal(typed) === parseDecimal(currentPrice);

  // Amazon's fees for the typed price, a moment after typing stops.
  useEffect(() => {
    if (!open) return;
    const asked = typed ?? currentPrice;
    const ticket = ++latest.current;
    setEstimating(true);
    const timer = setTimeout(async () => {
      const result = await estimatePriceAction(slug, { channelId, sku, price: asked });
      if (ticket !== latest.current) return;
      setEstimating(false);
      if (!result.ok) {
        setEstimateError(result.message);
        setEstimate(null);
        return;
      }
      setEstimateError(null);
      setEstimate(result.estimate);
    }, 600);
    return () => clearTimeout(timer);
  }, [open, typed, currentPrice, slug, channelId, sku]);

  const reset = () => {
    setPrice("");
    setEstimate(null);
    setEstimateError(null);
    setError(undefined);
    setConfirmed(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Change price
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!typed) {
              setError("Enter a price, e.g. 19.99.");
              return;
            }
            start(async () => {
              const result = await changePriceAction(slug, { channelId, sku, price: typed });
              if (!result.ok) {
                if (result.errors?.price) setError(result.errors.price);
                else toast.error("Amazon didn't change the price", { description: result.message });
                router.refresh();
                return;
              }
              toast.success("New price sent to Amazon", {
                description:
                  "Amazon usually applies it within 15 minutes. This page shows Applied once it's live.",
              });
              setOpen(false);
              reset();
              router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Change the price of {sku}</DialogTitle>
            <DialogDescription>
              {what} on {channelName}. Amazon's fees and your profit update as you type.
            </DialogDescription>
          </DialogHeader>

          <Field
            label="New price"
            htmlFor={id}
            hint={
              <>
                Now <Amount value={currentPrice} currency={currency} locale={locale} />. What buyers
                pay, as on Seller Central.
              </>
            }
            error={error}
          >
            <Input
              id={id}
              inputMode="decimal"
              value={price}
              autoFocus
              onChange={(e) => {
                setPrice(e.target.value);
                setError(undefined);
                setConfirmed(false);
              }}
              placeholder={currentPrice.replace(/0+$/, "").replace(/\.$/, "")}
              className="tabular"
            />
          </Field>

          <div className="overflow-hidden rounded-xl border">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-3 border-b bg-muted/30 px-4 py-2 font-medium text-muted-foreground text-xs">
              <span>One sale</span>
              <span className="text-end">Now</span>
              <span className="text-end">New</span>
            </div>
            <Row
              label="Price"
              now={estimate?.current?.price ?? currentPrice}
              next={typed}
              currency={currency}
              locale={locale}
            />
            <Row
              label={estimate?.fulfilledByAmazon ? "Amazon fees (FBA)" : "Amazon fees"}
              now={negate(estimate?.current?.fees)}
              next={typed ? negate(estimate?.next.fees) : null}
              currency={currency}
              locale={locale}
              loading={estimating}
            />
            <Row
              label="Cost of what's in it"
              now={negate(estimate?.cost)}
              next={typed ? negate(estimate?.cost) : null}
              currency={currency}
              locale={locale}
              loading={estimating && !estimate}
            />
            <Row
              label="Profit"
              now={estimate?.current?.profit?.profit ?? null}
              next={typed ? (estimate?.next.profit?.profit ?? null) : null}
              currency={currency}
              locale={locale}
              loading={estimating}
              strong
            />
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-3 px-4 py-2 text-muted-foreground text-sm">
              <span>Margin</span>
              <span className="tabular text-end">
                {estimate?.current?.profit?.margin != null
                  ? `${estimate.current.profit.margin}%`
                  : "—"}
              </span>
              <span className="tabular text-end">
                {typed && estimate?.next.profit?.margin != null && !estimating
                  ? `${estimate.next.profit.margin}%`
                  : "—"}
              </span>
            </div>
          </div>

          {estimateError || estimate?.costNote || estimate?.next.feesError ? (
            <p className="text-muted-foreground text-xs">
              {estimateError ?? estimate?.next.feesError ?? estimate?.costNote}
            </p>
          ) : null}

          {large && typed ? (
            <div className="fade-in-0 flex animate-in items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="grid gap-2">
                <p>
                  That's {Math.abs(Number(change))}% {Number(change) < 0 ? "lower" : "higher"} than
                  now.
                </p>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={confirmed}
                    label="Yes, change it by this much"
                    onChange={() => setConfirmed((c) => !c)}
                  />
                  <span aria-hidden>Yes, change it by this much</span>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !typed || same || (large && !confirmed)}>
              {pending ? <Spinner /> : <Send />}
              Update on Amazon
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function negate(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

function Row({
  label,
  now,
  next,
  currency,
  locale,
  loading = false,
  strong = false,
}: {
  label: string;
  now: string | null;
  next: string | null;
  currency: string;
  locale: string;
  loading?: boolean;
  strong?: boolean;
}) {
  const cell = (value: string | null) =>
    loading ? (
      <Skeleton className="ms-auto h-4 w-16" />
    ) : (
      <Amount
        value={value}
        currency={currency}
        locale={locale}
        className={cn(
          strong && value && parseDecimal(value) < 0n && "text-destructive",
          strong && value && parseDecimal(value) > 0n && "text-success",
        )}
      />
    );
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-center gap-3 border-b px-4 py-2 text-sm",
        strong && "font-medium",
      )}
    >
      <span>{label}</span>
      <span className="text-end">{cell(now)}</span>
      <span className="text-end">{cell(next)}</span>
    </div>
  );
}
