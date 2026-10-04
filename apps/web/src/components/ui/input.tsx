import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 text-base shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/15 sm:text-sm [&::-webkit-calendar-picker-indicator]:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
