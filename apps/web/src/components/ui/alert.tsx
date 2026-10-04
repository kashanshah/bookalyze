import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "fade-in-0 slide-in-from-top-1 relative w-full animate-in rounded-xl border px-4 py-3 text-sm duration-200",
  {
    variants: {
      variant: {
        default: "bg-muted/50 text-foreground",
        destructive: "border-destructive/40 bg-destructive/5 text-destructive",
        success: "border-success/40 bg-success/5 text-success",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
