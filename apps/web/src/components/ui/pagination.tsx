"use client";

import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageCount, pageNumbers } from "@bookalyze/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

/**
 * Traditional pagination for a list: which rows are shown, how many a page, previous / next and
 * page numbers (the first two, the last two, and around this one). The page and page size live
 * in the address (`?page=` and `?per=`) beside the list's own filters (`query`).
 */
export function Pagination({
  page,
  perPage,
  total,
  noun,
  query = {},
  locale,
  defaultPerPage = DEFAULT_PAGE_SIZE,
  className,
}: {
  page: number;
  perPage: number;
  total: number;
  /** What a row is, one and many: ["order", "orders"]. */
  noun: readonly [string, string];
  /** The list's other search parameters (filters), kept on every link. */
  query?: Record<string, string | undefined>;
  locale?: string;
  /** The size used when `per` isn't in the address (left out of links when chosen). */
  defaultPerPage?: number;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  if (total <= 0) return null;
  const pages = pageCount(total, perPage);
  const n = new Intl.NumberFormat(locale);
  const first = Math.min(total, (page - 1) * perPage + 1);
  const last = Math.min(total, page * perPage);

  const href = (to: { page?: number; per?: number }) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
    const per = to.per ?? perPage;
    if (per !== defaultPerPage) params.set("per", String(per));
    const p = to.page ?? page;
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
        <span className="tabular-nums">
          {pages > 1 ? `${n.format(first)}–${n.format(last)} of ` : ""}
          {n.format(total)} {total === 1 ? noun[0] : noun[1]}
        </span>
        {total > 0 ? (
          <span className="flex items-center gap-2">
            <span>Show</span>
            <Combobox
              aria-label={`${noun[1][0]?.toUpperCase()}${noun[1].slice(1)} per page`}
              value={String(perPage)}
              onChange={(v) => router.push(href({ per: Number(v), page: 1 }), { scroll: false })}
              options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
              className="h-8 w-20"
            />
            <span>per page</span>
          </span>
        ) : null}
      </div>

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center gap-1">
          <PageLink
            href={page > 1 ? href({ page: page - 1 }) : null}
            label="Previous page"
            className="ps-2 pe-3"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
            <span className="hidden sm:inline">Previous</span>
          </PageLink>
          <span className="px-2 text-muted-foreground tabular-nums sm:hidden">
            {n.format(page)} / {n.format(pages)}
          </span>
          <ul className="hidden items-center gap-1 sm:flex">
            {pageNumbers(page, pages).map((p, i) =>
              p === "gap" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: gaps have no identity of their own
                <li key={`gap-${i}`} aria-hidden className="w-8 text-center text-muted-foreground">
                  …
                </li>
              ) : (
                <li key={p}>
                  <PageLink
                    href={href({ page: p })}
                    label={`Page ${p}`}
                    current={p === page}
                    className="min-w-8 justify-center px-2 tabular-nums"
                  >
                    {n.format(p)}
                  </PageLink>
                </li>
              ),
            )}
          </ul>
          <PageLink
            href={page < pages ? href({ page: page + 1 }) : null}
            label="Next page"
            className="ps-3 pe-2"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </PageLink>
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({
  href,
  label,
  current,
  className,
  children,
}: {
  href: string | null;
  label: string;
  current?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const base = cn(
    "inline-flex h-8 items-center gap-1 rounded-md font-medium text-sm transition-colors",
    className,
  );
  if (!href) {
    return (
      <span aria-disabled="true" className={cn(base, "text-muted-foreground opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      className={cn(
        base,
        current
          ? "bg-primary text-primary-foreground shadow-xs"
          : "text-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </Link>
  );
}
