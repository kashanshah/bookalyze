// biome-ignore-all lint/performance/noImgElement: tiny static SVG logos; next/image would not optimise them
import { cn } from "@/lib/utils";

/*
 * Bookalyze logo (source files: docs/brand/logo). Rendered as <img> so each SVG keeps its own
 * gradient definitions. The light/dark pair follows the app theme (`.dark` on <html>).
 * Logo aspect ratio is ~4.78:1, the mark alone ~1.72:1.
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

/** The mark on its own (no wordmark). Size it by height, e.g. className="h-6". */
export function BrandMark({
  className,
  tone = "auto",
}: {
  className?: string;
  tone?: "auto" | "white";
}) {
  if (tone === "white") {
    return (
      <img
        src="/brand/mark-white.svg"
        alt=""
        aria-hidden="true"
        className={cn("h-6 w-auto", className)}
      />
    );
  }
  return (
    <span aria-hidden="true" className={cn("inline-flex h-6 shrink-0", className)}>
      <img src="/brand/mark-light.svg" alt="" className="h-full w-auto dark:hidden" />
      <img src="/brand/mark-dark.svg" alt="" className="hidden h-full w-auto dark:block" />
    </span>
  );
}
