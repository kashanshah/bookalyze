import "server-only";
import { schema, type Transaction } from "@bookalyze/db";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Where each marketplace's money lives: Amazon's settlements, Noon's transactions, eBay's money,
 * Walmart's settlements.
 * One tab per platform the company sells on, so its "bring in" button is one click away.
 */

export type PayoutPlatform = "amazon" | "noon" | "ebay" | "walmart";

const TABS: { key: PayoutPlatform; label: string; path: string }[] = [
  { key: "amazon", label: "Amazon", path: "/commerce/settlements" },
  { key: "noon", label: "Noon", path: "/commerce/noon" },
  { key: "ebay", label: "eBay", path: "/commerce/ebay" },
  { key: "walmart", label: "Walmart", path: "/commerce/walmart" },
];

/** The platforms the company has channels on (switched off ones too: their money still shows). */
export async function payoutPlatforms(tx: Transaction): Promise<PayoutPlatform[]> {
  const rows = await tx
    .selectDistinct({ kind: schema.salesChannels.kind })
    .from(schema.salesChannels);
  const kinds = new Set(rows.map((r) => r.kind));
  return TABS.map((t) => t.key).filter((k) => kinds.has(k));
}

/** The page for a platform's money. */
export const payoutPath = (slug: string, platform: PayoutPlatform) =>
  `/o/${slug}${TABS.find((t) => t.key === platform)?.path ?? "/commerce/settlements"}`;

export function PayoutTabs({
  slug,
  current,
  platforms,
}: {
  slug: string;
  current: PayoutPlatform;
  platforms: readonly PayoutPlatform[];
}) {
  const shown = TABS.filter((t) => t.key === current || platforms.includes(t.key));
  if (shown.length < 2) return null;
  return (
    <nav aria-label="Marketplace money" className="-mb-2 overflow-x-auto">
      <ul className="inline-flex gap-1 rounded-xl bg-muted/60 p-1">
        {shown.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key}>
              <Link
                href={payoutPath(slug, t.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-lg px-4 py-1.5 font-medium text-sm transition-colors",
                  active
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
