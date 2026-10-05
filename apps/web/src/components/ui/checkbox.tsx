"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** A tick box: a real checkbox for keyboards and screen readers, drawn to match the design. */
export function Checkbox({
  checked,
  label,
  onChange,
  className,
}: {
  checked: boolean;
  /** Read out instead of a visible label. */
  label: string;
  onChange: () => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors duration-150 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background hover:border-primary/60",
        className,
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={onChange}
        aria-label={label}
      />
      {checked ? <Check className="zoom-in-50 size-3.5 animate-in" strokeWidth={3} /> : null}
    </label>
  );
}
