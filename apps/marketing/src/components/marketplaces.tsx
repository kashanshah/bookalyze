import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { MARKETPLACES, type Marketplace } from "@/content/marketplaces";
import { cn } from "@/lib/site";
import { Checklist } from "./section";

/**
 * The marketplace cards (Home, Features, the marketplaces index): where each one works, what
 * comes in and how it connects, each linking to its own page. The facts live in
 * `content/marketplaces.ts`.
 */
export function MarketplaceCards({
  items = MARKETPLACES,
  className,
}: {
  items?: readonly Marketplace[];
  className?: string;
}) {
  return (
    <div className={cn("grid gap-5 md:grid-cols-2", className)}>
      {items.map((m) => (
        <article
          key={m.slug}
          className="group relative flex flex-col gap-5 rounded-2xl border bg-card p-6 shadow-xs transition-shadow hover:shadow-md sm:p-7"
        >
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-2xl tracking-tight">
                <Link
                  href={`/marketplaces/${m.slug}`}
                  className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
                >
                  {m.name}
                </Link>
              </h3>
              <span className="inline-flex items-center gap-2 rounded-full bg-success/12 px-2.5 py-1 font-medium text-success text-xs">
                <span className="relative flex size-1.5">
                  <span className="anim-ping absolute inline-flex size-full rounded-full bg-success" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-success" />
                </span>
                Syncs daily
              </span>
            </div>
            <p className="text-muted-foreground text-sm leading-6">{m.where}</p>
          </div>
          <Checklist items={m.brings} />
          <p className="mt-auto rounded-xl bg-accent px-4 py-3 text-accent-foreground text-sm leading-6">
            {m.connect}
          </p>
          <span className="inline-flex items-center gap-1.5 font-medium text-primary text-sm">
            More about {m.name}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </span>
        </article>
      ))}
    </div>
  );
}
