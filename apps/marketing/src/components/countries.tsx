import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { COUNTRIES } from "@/content/countries";
import { marketplace } from "@/content/marketplaces";
import { cn } from "@/lib/site";

/** The six countries we serve: flag, name, the marketplaces there, each linking to its page. */
export function CountryCards({ className }: { className?: string }) {
  return (
    <ul className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {COUNTRIES.map((c) => (
        <li
          key={c.slug}
          className="group relative flex items-start gap-4 rounded-2xl border bg-card p-5 shadow-xs transition-shadow hover:shadow-md"
        >
          <span aria-hidden="true" className="text-3xl leading-none">
            {c.flag}
          </span>
          <div className="grid min-w-0 gap-1">
            <h3 className="font-semibold">
              <Link
                href={`/sellers/${c.slug}`}
                className="after:absolute after:inset-0 after:rounded-2xl"
              >
                {c.name}
              </Link>
            </h3>
            <p className="text-muted-foreground text-sm leading-6">
              {c.marketplaces.map((m) => marketplace(m.slug)?.name ?? m.slug).join(", ")} ·{" "}
              {c.currency}
            </p>
          </div>
          <ArrowRight className="ms-auto mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
        </li>
      ))}
    </ul>
  );
}
