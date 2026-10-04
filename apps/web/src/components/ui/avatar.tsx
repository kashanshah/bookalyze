import { cn } from "@/lib/utils";

const TONES = [
  "bg-[oklch(0.93_0.05_275)] text-[oklch(0.42_0.15_275)]",
  "bg-[oklch(0.93_0.05_160)] text-[oklch(0.42_0.11_160)]",
  "bg-[oklch(0.94_0.05_60)] text-[oklch(0.48_0.12_55)]",
  "bg-[oklch(0.93_0.05_340)] text-[oklch(0.45_0.15_345)]",
  "bg-[oklch(0.93_0.05_220)] text-[oklch(0.42_0.12_230)]",
  "bg-[oklch(0.94_0.05_110)] text-[oklch(0.45_0.11_120)]",
];

function hash(value: string) {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

/** Initials avatar with a stable colour derived from the name. */
export function Avatar({
  name,
  className,
  shape = "circle",
}: {
  name: string;
  className?: string;
  shape?: "circle" | "square";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center font-semibold text-xs",
        shape === "circle" ? "rounded-full" : "rounded-lg",
        TONES[hash(name) % TONES.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
