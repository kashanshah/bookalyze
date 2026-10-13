import { can, EBAY_GROUPS, type EbayGroup, ebayGroupTotals, formatDecimal } from "@bookalyze/core";
import { ebayMonths, ebaySyncState, getEbayConnection } from "@bookalyze/db";
import { PlugZap, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { SyncEbayMoneyButton } from "./ebay-sync";

export const metadata: Metadata = { title: "eBay money" };
/** "Bring in from eBay" runs inside this page's server actions (about 25 s per call). */
export const maxDuration = 60;

/** The columns of a month, in order; the net comes after them. */
const COLUMNS: EbayGroup[] = [
  "sales",
  "refunds",
  "fees",
  "advertising",
  "shipping",
  "credits",
  "other",
];
const HINTS: Partial<Record<EbayGroup | "earned", string>> = {
  sales: "What buyers paid you, before eBay's fees (eBay's collected sales tax isn't yours)",
  fees: "Final value and other selling fees, less fees eBay gave back on refunds",
  advertising: "Promoted Listings and other ad fees",
  earned: "What the month added to your eBay balance, before money moved out",
};

export default async function EbayMoneyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { locale } = ctx.profile;
  const { months, connection } = await inOrg(ctx, async (tx) => ({
    months: await ebayMonths(tx),
    connection: await getEbayConnection(tx),
  }));
  const canManage = isOrgAdmin(ctx);
  const live =
    connection && connection.status !== "disconnected" && connection.hasSecret ? connection : null;
  const sync = live ? ebaySyncState(live.settings) : null;
  const monthName = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const nameOf = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`));
  const sites = [...new Map(months.map((m) => [`${m.channelId}:${m.currency}`, m])).values()];

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Commerce"
        title="eBay money"
        description="Every sale, refund, fee, shipping label and credit on your eBay account, month by month for each eBay site, in the currency eBay pays you in. Nothing here is in your books yet."
        actions={canManage && live ? <SyncEbayMoneyButton slug={slug} locale={locale} /> : null}
      />
      {sync?.through ? (
        <p className="-mt-2 text-muted-foreground text-sm">
          In through {formatDate(sync.through, locale)}
          {connection?.lastError ? ` · Last try: ${connection.lastError}` : ""}
        </p>
      ) : null}

      {!live && !months.length ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <PlugZap className="size-6" />
          </span>
          <p className="font-medium">Connect eBay first</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            Connect your eBay seller account on one of your eBay sites, and its money can come in
            here.
          </p>
          <Button asChild variant="outline">
            <Link href={`/o/${slug}/commerce/channels`}>Go to Channels</Link>
          </Button>
        </div>
      ) : !months.length ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ReceiptText className="size-6" />
          </span>
          <p className="font-medium">Nothing brought in yet</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            {canManage
              ? "Bring in from eBay to read the past year, a month at a time. After that, new rows come in every day."
              : "An owner or admin can bring eBay's money in."}
          </p>
        </div>
      ) : (
        sites.map((site) => {
          const rows = months.filter(
            (m) => m.channelId === site.channelId && m.currency === site.currency,
          );
          return (
            <section
              key={`${site.channelId}:${site.currency}`}
              aria-label={`${site.channelName} money`}
              className="overflow-hidden rounded-2xl border bg-card shadow-xs"
            >
              <h2 className="border-b px-5 py-3 font-medium">
                {site.channelName}{" "}
                <span className="font-normal text-muted-foreground text-sm">
                  · paid in {site.currency}
                </span>
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                      <th className="px-5 py-2.5 text-start font-medium">Month</th>
                      {COLUMNS.map((g) => (
                        <th key={g} className="px-3 py-2.5 text-end font-medium" title={HINTS[g]}>
                          {EBAY_GROUPS[g]}
                        </th>
                      ))}
                      <th className="px-5 py-2.5 text-end font-medium" title={HINTS.earned}>
                        Earned
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => {
                      const { groups, earned } = ebayGroupTotals(m.sums);
                      return (
                        <tr
                          key={m.month}
                          aria-label={`${nameOf(m.month)} on ${site.channelName}`}
                          className="border-b last:border-b-0"
                        >
                          <th scope="row" className="px-5 py-2.5 text-start font-medium">
                            {nameOf(m.month)}
                            <span className="block font-normal text-muted-foreground text-xs">
                              {m.rows.toLocaleString(locale)} {m.rows === 1 ? "row" : "rows"}
                              {groups.transfers ? (
                                <>
                                  {" · "}
                                  <Amount
                                    value={formatDecimal(groups.transfers)}
                                    currency={site.currency}
                                    locale={locale}
                                  />{" "}
                                  moved
                                </>
                              ) : null}
                            </span>
                          </th>
                          {COLUMNS.map((g) => (
                            <td
                              key={g}
                              className={cn(
                                "tabular px-3 py-2.5 text-end",
                                !groups[g] && "text-muted-foreground",
                              )}
                            >
                              <Amount
                                value={formatDecimal(groups[g])}
                                currency={site.currency}
                                locale={locale}
                              />
                            </td>
                          ))}
                          <td className="tabular px-5 py-2.5 text-end font-medium">
                            <Amount
                              value={formatDecimal(earned)}
                              currency={site.currency}
                              locale={locale}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
      <p className="text-muted-foreground text-xs">
        Each row counts on the eBay site of its order, or the site in its currency when it has no
        order. Money eBay moved in or out of your balance (transfers, withdrawals) isn't earnings.
        Payouts to your bank, and posting to your books, come next.
      </p>
    </div>
  );
}
