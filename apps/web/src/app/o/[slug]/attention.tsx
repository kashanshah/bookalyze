import "server-only";
import { can, planReorder } from "@bookalyze/core";
import {
  cogsMonthsToPost,
  countNeedsAccount,
  countOpenDuplicates,
  ebayPayoutsWithOneDeposit,
  ebayPostingMonths,
  getReorderSettings,
  getSettlementSettings,
  listTransactions,
  noonLedgerCheck,
  noonMonths,
  noonPayoutsWithOneDeposit,
  reorderProducts,
  schema,
  settlementsToPost,
  settlementsWithOneDeposit,
  suggestTransfers,
  type Transaction,
  unlinkedSkus,
} from "@bookalyze/db";
import { count, ne } from "drizzle-orm";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  BookCheck,
  CircleCheck,
  Copy,
  Inbox,
  Landmark,
  Link2,
  ListChecks,
  Package,
  Settings2,
  ShoppingCart,
  Tag,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { payoutPlatforms } from "@/components/commerce/payout-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { nowIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import type { OrgContext } from "@/server/org";

type Item = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  href: string;
  tone: "warning" | "primary" | "destructive";
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const BANK_PROVIDERS = new Set(["wise", "csv"]);
const PLATFORM_LABEL = { amazon_sp: "Amazon", noon: "Noon", ebay: "eBay" } as const;

/** Everything waiting on someone, across the books, the marketplaces and the stock. */
async function attentionItems(tx: Transaction, ctx: OrgContext, today: string): Promise<Item[]> {
  const base = `/o/${ctx.org.slug}`;
  const on = (m: string) => ctx.activeModules.includes(m as never);
  const items: Item[] = [];

  // Syncs that stopped working.
  const broken = await tx
    .select({
      id: schema.connections.id,
      provider: schema.connections.provider,
      name: schema.connections.name,
      status: schema.connections.status,
      lastError: schema.connections.lastError,
    })
    .from(schema.connections)
    .where(ne(schema.connections.status, "disconnected"));
  for (const c of broken) {
    if (c.status !== "error" && !c.lastError) continue;
    const bank = BANK_PROVIDERS.has(c.provider);
    if (bank ? !on("banking") : !on("commerce")) continue;
    items.push({
      key: `connection-${c.id}`,
      icon: AlertTriangle,
      title: `${c.name} didn't sync`,
      hint: c.lastError ?? "The last sync didn't finish. Try it again, or reconnect.",
      href: bank ? `${base}/banking/accounts` : `${base}/commerce/channels`,
      tone: "destructive",
    });
  }

  if (on("accounting")) {
    const unreviewed = (await listTransactions(tx, { reviewed: false, limit: 1, offset: 0 })).total;
    const noAccount = await countNeedsAccount(tx);
    const duplicates = await countOpenDuplicates(tx);
    const transfers = (await suggestTransfers(tx)).length;
    const tx_ = `${base}/accounting/transactions`;
    if (noAccount) {
      items.push({
        key: "no-account",
        icon: Tag,
        title: `${noAccount} ${plural(noAccount, "transaction needs", "transactions need")} a category`,
        hint: "They sit in Uncategorized until you say what they were for.",
        href: `${tx_}?status=no_account`,
        tone: "warning",
      });
    }
    if (duplicates) {
      items.push({
        key: "duplicates",
        icon: Copy,
        title: `${duplicates} possible ${plural(duplicates, "duplicate", "duplicates")}`,
        hint: "The same money may have come in twice. Keep one or both.",
        href: `${tx_}?status=duplicates`,
        tone: "warning",
      });
    }
    if (transfers) {
      items.push({
        key: "transfers",
        icon: ArrowLeftRight,
        title: `${transfers} ${plural(transfers, "transfer", "transfers")} between your accounts`,
        hint: "Money that left one account and arrived in another. Link them so it isn't counted twice.",
        href: `${tx_}?status=transfers`,
        tone: "primary",
      });
    }
    if (unreviewed) {
      items.push({
        key: "unreviewed",
        icon: Inbox,
        title: `${unreviewed} ${plural(unreviewed, "transaction", "transactions")} to review`,
        hint: "Check each one is right, then mark it reviewed.",
        href: `${tx_}?status=unreviewed`,
        tone: "primary",
      });
    }
  }

  if (on("commerce") && can(ctx.plan, ctx.enabledModules, "commerce.settlements")) {
    const platforms = await payoutPlatforms(tx);

    if (platforms.includes("amazon")) {
      const href = `${base}/commerce/settlements`;
      const { postFrom } = await getSettlementSettings(tx);
      if (postFrom) {
        const ready = (await settlementsToPost(tx, { from: postFrom, limit: 100 })).length;
        const found = (await settlementsWithOneDeposit(tx, 100)).length;
        if (ready) {
          items.push({
            key: "amazon-post",
            icon: BookCheck,
            title: `${ready} Amazon ${plural(ready, "settlement", "settlements")} ready to post`,
            hint: "Each one becomes one entry in your books.",
            href,
            tone: "primary",
          });
        }
        if (found) {
          items.push({
            key: "amazon-match",
            icon: Landmark,
            title: `${found} Amazon ${plural(found, "payout's", "payouts'")} bank deposit found`,
            hint: "We found the deposit for each one. Match them in one click.",
            href,
            tone: "primary",
          });
        }
      } else {
        const [any] = await tx.select({ n: count() }).from(schema.settlements);
        if (any?.n) {
          items.push({
            key: "amazon-setup",
            icon: Settings2,
            title: "Choose how Amazon settlements post",
            hint: "Pick the accounts once, and every payout can go into your books.",
            href: `${href}/accounts`,
            tone: "warning",
          });
        }
      }
    }

    for (const platform of ["noon", "ebay"] as const) {
      if (!platforms.includes(platform)) continue;
      const label = platform === "noon" ? PLATFORM_LABEL.noon : PLATFORM_LABEL.ebay;
      const href = `${base}/commerce/${platform}`;
      const months =
        platform === "noon" ? await noonMonths(tx, today) : await ebayPostingMonths(tx, today);
      if (months.some((m) => m.state === "notSetUp")) {
        items.push({
          key: `${platform}-setup`,
          icon: Settings2,
          title: `Choose how ${label} posts`,
          hint: "Pick the accounts once, and each month's sales and fees can go into your books.",
          href: `${href}/accounts`,
          tone: "warning",
        });
        continue;
      }
      const ready = months.filter((m) => m.state === "ready" || m.state === "changed").length;
      const found = (
        platform === "noon"
          ? await noonPayoutsWithOneDeposit(tx, 100)
          : await ebayPayoutsWithOneDeposit(tx, 100)
      ).length;
      if (ready) {
        items.push({
          key: `${platform}-post`,
          icon: BookCheck,
          title: `${ready} ${label} ${plural(ready, "month", "months")} ready to post`,
          hint: "One entry per month: what sold, what was refunded and the fees.",
          href,
          tone: "primary",
        });
      }
      if (found) {
        items.push({
          key: `${platform}-match`,
          icon: Landmark,
          title: `${found} ${label} ${plural(found, "payout's", "payouts'")} bank deposit found`,
          hint: "We found the deposit for each one. Match them in one click.",
          href,
          tone: "primary",
        });
      }
    }
  }

  if (on("inventory")) {
    if (can(ctx.plan, ctx.enabledModules, "inventory.products")) {
      const unlinked = (await unlinkedSkus(tx, { limit: 1 })).total;
      if (unlinked) {
        items.push({
          key: "unlinked-skus",
          icon: Link2,
          title: `${unlinked} marketplace ${plural(unlinked, "SKU isn't", "SKUs aren't")} linked to a product`,
          hint: "Link each one to what it sells, so its sales come out of your stock and are costed.",
          href: `${base}/inventory/products#unlinked-title`,
          tone: "warning",
        });
      }
    }
    if (can(ctx.plan, ctx.enabledModules, "inventory.reorder")) {
      const [settings, products] = [
        await getReorderSettings(tx),
        await reorderProducts(tx, { timezone: ctx.profile?.timezone ?? "UTC", today }),
      ];
      const due = products.filter(
        (p) =>
          planReorder({
            today,
            dailyUnits: p.dailyUnits,
            inStock: p.inStock,
            onOrder: p.onOrder,
            leadTimeDays: p.leadTimeDays ?? settings.leadTimeDays,
            coverDays: settings.coverDays,
          }).status === "order_now",
      ).length;
      if (due) {
        items.push({
          key: "reorder",
          icon: ShoppingCart,
          title: `${due} ${plural(due, "product", "products")} to reorder now`,
          hint: "At the pace they're selling, they'll run low before a new order could arrive.",
          href: `${base}/inventory/reorder`,
          tone: "warning",
        });
      }
    }
    if (can(ctx.plan, ctx.enabledModules, "inventory.cogs")) {
      const months = await cogsMonthsToPost(tx, {
        timezone: ctx.profile?.timezone ?? "UTC",
        currentMonth: today.slice(0, 7),
      });
      // A month on two marketplaces is still one month to the reader.
      const n = new Set(months.map((m) => m.month)).size;
      if (n) {
        items.push({
          key: "cogs",
          icon: Package,
          title: `${n} ${plural(n, "month", "months")} of cost of goods sold to post`,
          hint: "What you shipped each month, costed from your oldest stock first. They post in order.",
          href: `${base}/inventory/cogs`,
          tone: "primary",
        });
      }
      // Noon's ledger summary against its detailed ledger, on the days both cover.
      const off = (await noonLedgerCheck(tx)).mismatches.length;
      if (off) {
        items.push({
          key: "noon-stock-check",
          icon: TriangleAlert,
          title: `Noon's stock reports disagree on ${off} ${plural(off, "day", "days")}`,
          hint: "A movement is missing from one of Noon's reports. See which SKUs, then ask Noon's seller support.",
          href: `${base}/inventory/movements#noon-check-title`,
          tone: "warning",
        });
      }
    }
  }

  return items;
}

export async function Attention({ ctx }: { ctx: OrgContext }) {
  if (!ctx.profile) return null;
  const today = nowIn(ctx.profile.timezone).date;
  const items = await inOrg(ctx, (tx) => attentionItems(tx, ctx, today));

  return (
    <section
      aria-labelledby="attention-heading"
      className="fade-in-0 animate-in rounded-2xl border bg-card shadow-xs duration-300"
    >
      <div className="flex items-center gap-3 border-b px-5 py-4 sm:px-6">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ListChecks className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="attention-heading" className="font-semibold">
            Needs your attention
          </h2>
          <p className="text-muted-foreground text-sm">
            {items.length
              ? "What's waiting in your books, marketplaces and stock. Each one opens where it's done."
              : "Nothing is waiting on you."}
          </p>
        </div>
      </div>
      {items.length ? (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/40 sm:px-6"
              >
                <item.icon
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground",
                    item.tone === "warning" && "text-warning",
                    item.tone === "destructive" && "text-destructive",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-sm">{item.title}</span>
                  <span className="block text-muted-foreground text-xs">{item.hint}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-5 py-5 text-muted-foreground text-sm sm:px-6">
          <CircleCheck className="size-4 text-success" />
          You're all caught up.
        </p>
      )}
    </section>
  );
}

export function AttentionSkeleton() {
  return (
    <div className="rounded-2xl border bg-card shadow-xs">
      <div className="flex items-center gap-3 border-b px-5 py-4 sm:px-6">
        <Skeleton className="size-9 rounded-xl" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>
      <div className="grid gap-3 px-5 py-4 sm:px-6">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}
