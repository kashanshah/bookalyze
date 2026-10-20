// biome-ignore-all lint/performance/noImgElement: tiny static SVG logos; next/image would not optimise them
import { cn } from "@/lib/site";

/*
 * Bookalyze logo (source files: docs/brand/logo). Rendered as <img> so each SVG keeps its own
 * gradient definitions. The light/dark pair follows the visitor's device.
 */

/** Full logo: mark + "Bookalyze" wordmark. Size it by height, e.g. className="h-7". */
export function Brand({
  className,
  tone = "auto",
}: {
  className?: string;
  tone?: "auto" | "white";
}) {
  if (tone === "white") {
    return (
      <img src="/brand/logo-white.svg" alt="Bookalyze" className={cn("h-7 w-auto", className)} />
    );
  }
  return (
    <span className={cn("inline-flex h-7 shrink-0", className)}>
      <img src="/brand/logo-light.svg" alt="Bookalyze" className="h-full w-auto dark:hidden" />
      <img src="/brand/logo-dark.svg" alt="Bookalyze" className="hidden h-full w-auto dark:block" />
    </span>
  );
}

/** The mark on its own, white, for the indigo panels. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/mark-white.svg"
      alt=""
      aria-hidden="true"
      className={cn("h-6 w-auto", className)}
    />
  );
}
