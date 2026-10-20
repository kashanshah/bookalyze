/**
 * Paged lists: which page and how many a page, read from the address (`?page=3&per=100`), and
 * the page numbers to show: the first two, the last two, and the current page with one either
 * side, with gaps between.
 */

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type Paging = { page: number; perPage: number; offset: number };

export function readPaging(
  params: { page?: string | string[]; per?: string | string[] },
  fallback: number = DEFAULT_PAGE_SIZE,
): Paging {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const per = Number(one(params.per));
  const perPage = (PAGE_SIZES as readonly number[]).includes(per) ? per : fallback;
  const page = Math.min(100_000, Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1));
  return { page, perPage, offset: (page - 1) * perPage };
}

export const pageCount = (total: number, perPage: number) =>
  Math.max(1, Math.ceil(total / perPage));

/** Page numbers to show, in order, with "gap" where pages are skipped. */
export function pageNumbers(page: number, pages: number): (number | "gap")[] {
  const keep = new Set<number>();
  for (const n of [1, 2, page - 1, page, page + 1, pages - 1, pages]) {
    if (n >= 1 && n <= pages) keep.add(n);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    // A gap of one page is just that page.
    if (prev !== undefined && n - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && n - prev > 2) out.push("gap");
    out.push(n);
  });
  return out;
}
