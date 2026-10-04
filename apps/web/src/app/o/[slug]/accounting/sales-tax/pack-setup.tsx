"use client";

import type { TaxPack } from "@bookalyze/core";
import { Check, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { applyTaxPackAction } from "./actions";

/** Checkbox cards for a country's standard rates, with the region's usual ones ticked. */
export function PackPicker({
  slug,
  pack,
  suggested,
  existing,
  onDone,
}: {
  slug: string;
  pack: TaxPack;
  suggested: string[];
  /** Names of rates the company already has (shown as added). */
  existing: string[];
  onDone?: () => void;
}) {
  const have = new Set(existing.map((n) => n.toLowerCase()));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(suggested.filter((k) => !have.has(nameOf(pack, k).toLowerCase()))),
  );
  const [pending, startTransition] = useTransition();
  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {pack.rates.map((rate) => {
          const added = have.has(rate.name.toLowerCase());
          const on = added || selected.has(rate.key);
          return (
            <label
              key={rate.key}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border bg-card p-3.5 text-start shadow-xs transition-all duration-150 hover:border-primary/40 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
                on && !added && "border-primary bg-primary/[0.03] ring-1 ring-primary",
                added && "cursor-default opacity-60 hover:border-border",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                disabled={added || pending}
                onChange={() => toggle(rate.key)}
              />
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "bg-background",
                )}
              >
                {on ? <Check className="zoom-in-50 size-3.5 animate-in" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-sm">{rate.name}</span>
                <span className="block text-muted-foreground text-xs">
                  {added
                    ? "Already set up."
                    : (rate.hint ??
                      (rate.isRecoverable
                        ? "Tax you pay can be claimed back."
                        : "Tax you pay can't be claimed back."))}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          Adds a “{pack.accounts[0]?.name}” account to your chart of accounts. You can rename or
          change any rate later.
        </p>
        <Button
          type="button"
          disabled={pending || selected.size === 0}
          onClick={() =>
            startTransition(async () => {
              const result = await applyTaxPackAction(slug, pack.key, [...selected]);
              if (result.ok) {
                toast.success(result.message ?? "Sales tax set up");
                onDone?.();
              } else toast.error(result.message ?? "Something went wrong");
            })
          }
        >
          {pending ? <Spinner /> : <Sparkles />}
          {selected.size === 0
            ? "Choose rates to add"
            : `Add ${selected.size} ${selected.size === 1 ? "rate" : "rates"}`}
        </Button>
      </div>
    </div>
  );
}

function nameOf(pack: TaxPack, key: string): string {
  return pack.rates.find((r) => r.key === key)?.name ?? key;
}
