"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/site";

export type GuideSummary = { slug: string; title: string; summary: string; category: string };

/** Lower-case words, so "VAT" finds "vat" and "Wise's" finds "wise". */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Guides whose title, summary or category hold every word typed (the title counts most). */
export function searchGuides(guides: readonly GuideSummary[], query: string): GuideSummary[] {
  const terms = words(query);
  if (!terms.length) return [];
  return guides
    .map((g) => {
      const title = words(g.title).join(" ");
      const rest = words(`${g.summary} ${g.category}`).join(" ");
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 3;
        else if (rest.includes(t)) score += 1;
        else return null;
      }
      return { g, score };
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.g);
}

/**
 * A search box over the guides, with results as you type. The query is kept in `?q=` so a search
 * can be shared or bookmarked.
 */
export function GuideSearch({
  guides,
  autoFocus,
  className,
}: {
  guides: readonly GuideSummary[];
  autoFocus?: boolean;
  className?: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const results = useMemo(() => searchGuides(guides, query), [guides, query]);

  return (
    <div className={cn("grid gap-4", className)}>
      <search className="relative block">
        <label htmlFor="guide-search" className="sr-only">
          Search the guides
        </label>
        <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          id="guide-search"
          type="search"
          value={query}
          // biome-ignore lint/a11y/noAutofocus: the help page is for searching
          autoFocus={autoFocus}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            const p = new URLSearchParams(params.toString());
            if (next.trim()) p.set("q", next);
            else p.delete("q");
            router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
          }}
          placeholder="Search: settlements, Wise, VAT, review requests…"
          className="h-14 w-full rounded-2xl border bg-card ps-12 pe-4 text-base shadow-xs outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
        />
      </search>
      {query.trim() ? (
        <div aria-live="polite" className="grid gap-2">
          <p className="text-muted-foreground text-sm">
            {results.length === 0
              ? "No guide matches that yet. Try another word, or ask us on the contact page."
              : results.length === 1
                ? "1 guide"
                : `${results.length} guides`}
          </p>
          {results.length ? (
            <ul className="divide-y rounded-2xl border bg-card shadow-xs">
              {results.slice(0, 12).map((g) => (
                <li key={g.slug}>
                  <Link
                    href={`/guides/${g.slug}`}
                    className="grid gap-1 px-5 py-4 transition-colors hover:bg-accent/50"
                  >
                    <span className="font-medium">{g.title}</span>
                    <span className="line-clamp-2 text-muted-foreground text-sm">{g.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
