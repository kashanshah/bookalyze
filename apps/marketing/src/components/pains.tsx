import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { PAINS } from "@/content/pains";
import { cn } from "@/lib/site";

/** Each pain sellers have in one line, Bookalyze's answer in one line, and the guide that shows it. */
export function PainsGrid({ className }: { className?: string }) {
  return (
    <ul className={cn("grid gap-4 md:grid-cols-2", className)}>
      {PAINS.map((p) => (
        <li
          key={p.guide}
          className="group relative grid content-start gap-3 rounded-2xl border bg-card p-5 shadow-xs transition-shadow hover:shadow-md sm:p-6"
        >
          <p className="flex gap-2.5 text-muted-foreground text-sm leading-6">
            <span
              aria-hidden="true"
              className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive/70"
            />
            <span>
              <span className="sr-only">The pain: </span>
              {p.pain}
            </span>
          </p>
          <p className="flex gap-2.5 font-medium text-sm leading-6">
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 fill-none stroke-2 stroke-success"
            >
              <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              <span className="sr-only">What Bookalyze does: </span>
              {p.answer}
            </span>
          </p>
          <Link
            href={`/guides/${p.guide}`}
            className="inline-flex items-center gap-1.5 justify-self-start ps-6.5 font-medium text-primary text-sm after:absolute after:inset-0 after:rounded-2xl"
          >
            See how
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
