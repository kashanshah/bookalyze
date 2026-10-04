import { cn } from "@/lib/utils";

/**
 * Logo mark. The gradient is CSS (not an SVG <linearGradient>) so several marks on one page,
 * including ones inside hidden containers, never clash over gradient ids.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-[25%] bg-gradient-to-br from-[#606CDD] to-[#373BA7] shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]",
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className="size-full" aria-hidden="true">
        <title>Bookalyze</title>
        <path
          d="M10 8h7.5a4.5 4.5 0 0 1 2.9 7.94A5 5 0 0 1 18 25h-8V8Zm3 3v4h4.3a2 2 0 0 0 0-4H13Zm0 7v4h4.8a2 2 0 0 0 0-4H13Z"
          fill="white"
        />
      </svg>
    </span>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold text-lg tracking-tight",
        className,
      )}
    >
      <BrandMark />
      Bookalyze
    </span>
  );
}
