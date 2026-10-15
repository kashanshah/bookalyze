import {
  can,
  EBAY_GROUPS,
  type EbayGroup,
  ebayGroupTotals,
  formatDecimal,
  type NoonMonthState,
} from "@bookalyze/core";
import {
  type DepositCandidate,
  ebayPayoutCandidates,
  ebayPayoutList,
  ebayPayoutsWithOneDeposit,
  ebayPostingMonths,
  ebaySyncState,
  getEbayConnection,
  getEbaySettings,
} from "@bookalyze/db";
import { ArrowRight, PlugZap, ReceiptText, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PayoutTabs, payoutPlatforms } from "@/components/commerce/payout-tabs";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, nowIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { SyncEbayMoneyButton, UploadEbayReport } from "./ebay-sync";
import {
  MatchAllPayoutsButton,
  PayoutChoice,
  PostAllMonthsButton,
  PostMonthButton,
  UnmatchPayoutButton,
  UnpostMonthButton,
} from "./posting-buttons";

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

const STATE_BADGES: Partial<
  Record<
    NoonMonthState,
    { label: string; variant: "success" | "secondary" | "warning" | "outline" }
  >
> = {
  posted: { label: "In books", variant: "success" },
  changed: { label: "Changed since posted", variant: "warning" },
  ready: { label: "Ready to post", variant: "secondary" },
  inProgress: { label: "In progress", variant: "outline" },
  before: { label: "Before posting starts", variant: "outline" },
};

/** eBay's payout statuses in plain words (sent ones need no badge). */
const PAYOUT_STATUS: Record<string, string> = {
  INITIATED: "On its way",
  RETRYABLE_FAILED: "Failed, eBay will retry",
  TERMINAL_FAILED: "Failed",
  REVERSED: "Reversed",
};

export default async function EbayMoneyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { locale } = ctx.profile;
  const today = nowIn(ctx.profile.timezone).date;
  const { months, connection, settings, payouts, candidates, oneDeposit, platforms } = await inOrg(
    ctx,
    async (tx) => {
      const settings = await getEbaySettings(tx);
      const payouts = await ebayPayoutList(tx);
      const candidates = new Map<string, DepositCandidate>();
      if (settings.postFrom) {
        for (const p of payouts.filter((p) => p.sent && !p.before && !p.matched)) {
          const [first] = await ebayPayoutCandidates(tx, p.id);
          if (first) candidates.set(p.id, first);
        }
      }
      return {
        months: await ebayPostingMonths(tx, today),
        connection: await getEbayConnection(tx),
        settings,
        payouts,
        candidates,
        oneDeposit: settings.postFrom ? (await ebayPayoutsWithOneDeposit(tx)).length : 0,
        platforms: await payoutPlatforms(tx),
      };
    },
  );
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
  const base = `/o/${slug}`;
  const hasSite = platforms.includes("ebay");
  const toPost = months.filter((m) => m.state === "ready" || m.state === "changed").length;

  return (
    <div className="grid gap-6">
      <PayoutTabs slug={slug} current="ebay" platforms={platforms} />
      <PageHeader
        eyebrow="Commerce"
        title="eBay money"
        description="Every sale, refund, fee, shipping label and credit on your eBay account, month by month for each eBay site, in the currency eBay pays you in. Each month goes into your books as one entry, the net to your eBay balance; each payout comes out of it when matched to its bank deposit."
        actions={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              {months.length ? (
                <Button asChild variant="ghost">
                  <Link href={`${base}/commerce/ebay/accounts`}>
                    <Settings2 />
                    How eBay posts
                  </Link>
                </Button>
              ) : null}
              {hasSite ? <UploadEbayReport slug={slug} /> : null}
              {live ? <SyncEbayMoneyButton slug={slug} locale={locale} /> : null}
              {oneDeposit ? <MatchAllPayoutsButton slug={slug} count={oneDeposit} /> : null}
              {settings.postFrom && toPost ? (
                <PostAllMonthsButton slug={slug} count={toPost} />
              ) : null}
            </div>
          ) : null
        }
      />
      {sync?.through ? (
        <p className="-mt-2 text-muted-foreground text-sm">
          In through {formatDate(sync.through, locale)}
          {connection?.lastError ? ` · Last try: ${connection.lastError}` : ""}
        </p>
      ) : null}

      {months.length && !settings.postFrom ? (
        <Link
          href={`${base}/commerce/ebay/accounts`}
          className="flex items-center gap-3 rounded-xl bg-primary/5 px-4 py-3 text-sm transition-colors hover:bg-primary/10"
        >
          <Settings2 className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Put eBay in your books.</span> Choose the accounts for
            sales, fees, advertising and your eBay balance, and the month posting starts.
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
        </Link>
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
            {hasSite && canManage
              ? " Or upload the transaction report from Seller Hub (Payments → Reports)."
              : ""}
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
                <table className="w-full min-w-[68rem] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                      <th className="px-5 py-2.5 text-start font-medium">Month</th>
                      {COLUMNS.map((g) => (
                        <th key={g} className="px-3 py-2.5 text-end font-medium" title={HINTS[g]}>
                          {EBAY_GROUPS[g]}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-end font-medium" title={HINTS.earned}>
                        Earned
                      </th>
                      <th className="px-5 py-2.5 text-start font-medium">In your books</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => {
                      const { groups, earned } = ebayGroupTotals(m.sums);
                      const label = `${nameOf(m.month)} on ${site.channelName}`;
                      const badge = STATE_BADGES[m.state];
                      return (
                        <tr key={m.month} aria-label={label} className="border-b last:border-b-0">
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
                          <td className="tabular px-3 py-2.5 text-end font-medium">
                            <Amount
                              value={formatDecimal(earned)}
                              currency={site.currency}
                              locale={locale}
                            />
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
                              {m.posted ? (
                                <Link
                                  href={`${base}/accounting/journal/${m.posted.entryId}`}
                                  className="text-primary text-xs underline-offset-4 hover:underline"
                                >
                                  {m.posted.entryLabel}
                                </Link>
                              ) : null}
                              {canManage && m.state === "posted" ? (
                                <UnpostMonthButton
                                  slug={slug}
                                  channelId={m.channelId}
                                  month={m.month}
                                  label={label}
                                />
                              ) : canManage && (m.state === "ready" || m.state === "changed") ? (
                                <PostMonthButton
                                  slug={slug}
                                  channelId={m.channelId}
                                  month={m.month}
                                  label={label}
                                  again={m.state === "changed"}
                                />
                              ) : null}
                            </div>
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
      {payouts.length ? (
        <section aria-labelledby="ebay-payouts" className="fade-in-0 grid animate-in gap-2">
          <h2 id="ebay-payouts" className="font-semibold">
            Payouts to your bank
          </h2>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
            <ul className="divide-y">
              {payouts.map((p) => {
                const found = candidates.get(p.id);
                const status = PAYOUT_STATUS[p.status];
                return (
                  <li
                    key={p.id}
                    aria-label={`Payout of ${p.amount} on ${p.date}`}
                    className="grid gap-2 px-4 py-3 sm:px-5"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium text-sm">{formatDate(p.date, locale)}</span>
                      <span className="text-muted-foreground text-xs">
                        {p.payoutId}
                        {p.accountLast4 ? ` · to the account ending ${p.accountLast4}` : ""}
                      </span>
                      {p.matched ? (
                        <Badge variant="success">Deposit matched</Badge>
                      ) : !p.sent ? (
                        <Badge variant="warning">{status ?? p.status}</Badge>
                      ) : p.before && settings.postFrom ? (
                        <Badge variant="outline">Before posting starts</Badge>
                      ) : status ? (
                        <Badge variant="outline">{status}</Badge>
                      ) : null}
                      <span className="ms-auto font-medium text-sm">
                        <Amount value={p.amount} currency={p.currency} locale={locale} />
                      </span>
                    </div>
                    {p.matched ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                        <Link
                          href={`${base}/accounting/journal/${p.matched.entryId}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          Deposit of {formatDate(p.matched.date, locale)} · {p.matched.entryLabel}
                        </Link>
                        {canManage ? (
                          <span className="ms-auto">
                            <UnmatchPayoutButton slug={slug} payoutId={p.id} />
                          </span>
                        ) : null}
                      </div>
                    ) : !p.sent || p.before || !settings.postFrom ? null : found ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-muted/40 px-3 py-2 text-xs">
                        <span className="min-w-0 flex-1">
                          Deposit of{" "}
                          <Amount value={found.amount} currency={found.currency} locale={locale} />{" "}
                          into {found.accountName} on {formatDate(found.date, locale)}
                          {found.categories.length ? `, now in ${found.categories.join(", ")}` : ""}
                          . Matching moves it to your eBay balance.
                        </span>
                        {canManage ? (
                          <PayoutChoice
                            slug={slug}
                            payoutId={p.id}
                            entryId={found.entryId}
                            converted={found.fit.kind === "converted"}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        No bank deposit of this amount found around {formatDate(p.date, locale)}.
                        Add the bank transaction, or bring in the bank statement.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}
      <p className="text-muted-foreground text-xs">
        Each row counts on the eBay site of its order, or the site in its currency when it has no
        order. Money eBay moved in or out of your balance (transfers, withdrawals) isn't earnings,
        but it goes into the books with the month, to the account you choose for it.
      </p>
    </div>
  );
}
