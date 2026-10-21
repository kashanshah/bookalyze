import { can, formatDecimal, WALMART_GROUPS, type WalmartGroup } from "@bookalyze/core";
import {
  type DepositCandidate,
  getWalmartSettings,
  listWalmartChannels,
  type WalmartSettlementState,
  walmartPayoutCandidates,
  walmartPayoutsWithOneDeposit,
  walmartPostingList,
} from "@bookalyze/db";
import { ArrowRight, ReceiptText, Settings2, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PayoutTabs, payoutPlatforms } from "@/components/commerce/payout-tabs";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import {
  MatchAllPayoutsButton,
  PayoutChoice,
  PostAllSettlementsButton,
  PostSettlementButton,
  UnmatchPayoutButton,
  UnpostSettlementButton,
} from "./posting-buttons";

export const metadata: Metadata = { title: "Walmart money" };

/** The columns of a settlement, in order; the payout comes after them. */
const COLUMNS: WalmartGroup[] = [
  "sales",
  "refunds",
  "fees",
  "fulfilment",
  "advertising",
  "shipping",
  "other",
];
const HINTS: Partial<Record<WalmartGroup | "payout", string>> = {
  sales: "What customers paid for your items, shipping and gift wrap, before Walmart's fees",
  fees: "Walmart's commission (referral fees) and other selling fees, less fees given back on refunds",
  fulfilment: "Walmart Fulfillment Services: fulfilment, storage and inbound fees",
  payout: "What Walmart pays to your bank for the settlement",
};

const STATE_BADGES: Partial<
  Record<
    WalmartSettlementState,
    { label: string; variant: "success" | "secondary" | "warning" | "outline" }
  >
> = {
  posted: { label: "In books", variant: "success" },
  changed: { label: "Changed since posted", variant: "warning" },
  ready: { label: "Ready to post", variant: "secondary" },
  problem: { label: "Needs a look", variant: "warning" },
  empty: { label: "Nothing to post", variant: "outline" },
  before: { label: "Before posting starts", variant: "outline" },
};

export default async function WalmartMoneyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { locale } = ctx.profile;
  const { settlements, settings, channels, candidates, oneDeposit, platforms } = await inOrg(
    ctx,
    async (tx) => {
      const settings = await getWalmartSettings(tx);
      const settlements = await walmartPostingList(tx);
      const candidates = new Map<string, DepositCandidate>();
      for (const s of settlements.filter((s) => s.posted && s.payout && !s.deposit)) {
        const [first] = await walmartPayoutCandidates(tx, s.id);
        if (first) candidates.set(s.id, first);
      }
      return {
        settlements,
        settings,
        channels: await listWalmartChannels(tx),
        candidates,
        oneDeposit: settings.postFrom ? (await walmartPayoutsWithOneDeposit(tx)).length : 0,
        platforms: await payoutPlatforms(tx),
      };
    },
  );
  const canManage = isOrgAdmin(ctx);
  const base = `/o/${slug}`;
  const toPost = settlements.filter((s) => s.state === "ready" || s.state === "changed").length;
  const problems = settlements.filter((s) => s.state === "problem").length;
  const period = (s: (typeof settlements)[number]) =>
    s.periodFrom && s.periodTo
      ? `${formatDate(s.periodFrom, locale)} – ${formatDate(s.periodTo, locale)}`
      : formatDate(s.reportDate, locale);
  const payouts = settlements.filter((s) => s.posted && s.payout);
  const groups = [...new Map(settlements.map((s) => [`${s.channelId}:${s.currency}`, s])).values()];

  return (
    <div className="grid gap-6">
      <PayoutTabs slug={slug} current="walmart" platforms={platforms} />
      <PageHeader
        eyebrow="Commerce"
        title="Walmart money"
        description="Every Walmart settlement: what customers paid, Walmart's fees, WFS fees and advertising, and what Walmart paid you, for each Walmart channel. Each settlement goes into your books as one entry, the net to your Walmart balance; its payout comes out of it when matched to the bank deposit."
        actions={
          canManage && settlements.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost">
                <Link href={`${base}/commerce/walmart/accounts`}>
                  <Settings2 />
                  How Walmart posts
                </Link>
              </Button>
              {oneDeposit ? <MatchAllPayoutsButton slug={slug} count={oneDeposit} /> : null}
              {settings.postFrom && toPost ? (
                <PostAllSettlementsButton slug={slug} count={toPost} />
              ) : null}
            </div>
          ) : null
        }
      />

      {settlements.length && !settings.postFrom ? (
        <Link
          href={`${base}/commerce/walmart/accounts`}
          className="flex items-center gap-3 rounded-xl bg-primary/5 px-4 py-3 text-sm transition-colors hover:bg-primary/10"
        >
          <Settings2 className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Put Walmart in your books.</span> Choose the accounts for
            sales, fees, WFS fees and your Walmart balance, and the day posting starts.
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
        </Link>
      ) : null}
      {problems ? (
        <div
          role="status"
          className="fade-in-0 flex animate-in items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm sm:px-5"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">
              {problems === 1
                ? "1 settlement needs a look."
                : `${problems} settlements need a look.`}
            </span>
            <span className="text-muted-foreground">
              {" "}
              Their rows don't add up to what Walmart paid out, so they stay out of your books. Each
              one says why below.
            </span>
          </span>
        </div>
      ) : null}

      {!settlements.length ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ReceiptText className="size-6" />
          </span>
          <p className="font-medium">No settlements brought in yet</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            {channels.length
              ? "On a connected Walmart channel's page, choose Bring in from Walmart. Its settlements then show here."
              : "Add a Walmart channel and connect it, and its settlements can come in here."}
          </p>
          <Button asChild variant="outline">
            <Link href={`${base}/commerce/channels`}>Go to Channels</Link>
          </Button>
        </div>
      ) : (
        groups.map((g) => {
          const rows = settlements.filter(
            (s) => s.channelId === g.channelId && s.currency === g.currency,
          );
          return (
            <section
              key={`${g.channelId}:${g.currency}`}
              aria-label={`${g.channelName} settlements`}
              className="fade-in-0 animate-in overflow-hidden rounded-2xl border bg-card shadow-xs"
            >
              <h2 className="border-b px-5 py-3 font-medium">
                <Link
                  href={`${base}/commerce/channels/${g.channelId}`}
                  className="underline-offset-4 hover:underline"
                >
                  {g.channelName}
                </Link>{" "}
                <span className="font-normal text-muted-foreground text-sm">
                  · paid in {g.currency}
                </span>
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[68rem] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                      <th className="px-5 py-2.5 text-start font-medium">Settlement</th>
                      {COLUMNS.map((c) => (
                        <th key={c} className="px-3 py-2.5 text-end font-medium" title={HINTS[c]}>
                          {WALMART_GROUPS[c]}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-end font-medium" title={HINTS.payout}>
                        Payout
                      </th>
                      <th className="px-5 py-2.5 text-start font-medium">In your books</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const label = `${g.channelName}, ${period(s)}`;
                      const badge = STATE_BADGES[s.state];
                      const tax = s.totals?.groups.tax ?? 0n;
                      return (
                        <tr key={s.id} aria-label={label} className="border-b last:border-b-0">
                          <th scope="row" className="px-5 py-2.5 text-start font-medium">
                            {period(s)}
                            <span className="block font-normal text-muted-foreground text-xs">
                              {s.rows.toLocaleString(locale)} {s.rows === 1 ? "row" : "rows"}
                              {tax ? (
                                <>
                                  {" · "}
                                  <Amount
                                    value={formatDecimal(tax)}
                                    currency={s.currency}
                                    locale={locale}
                                  />{" "}
                                  sales tax
                                </>
                              ) : null}
                            </span>
                          </th>
                          {COLUMNS.map((c) => {
                            const v = s.totals?.groups[c] ?? 0n;
                            return (
                              <td
                                key={c}
                                className={cn(
                                  "tabular px-3 py-2.5 text-end",
                                  !v && "text-muted-foreground",
                                )}
                              >
                                {s.totals ? (
                                  <Amount
                                    value={formatDecimal(v)}
                                    currency={s.currency}
                                    locale={locale}
                                  />
                                ) : (
                                  "—"
                                )}
                              </td>
                            );
                          })}
                          <td className="tabular px-3 py-2.5 text-end font-medium">
                            {s.payout ? (
                              <Amount value={s.payout} currency={s.currency} locale={locale} />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
                              {s.posted ? (
                                <Link
                                  href={`${base}/accounting/journal/${s.posted.entryId}`}
                                  className="text-primary text-xs underline-offset-4 hover:underline"
                                >
                                  {s.posted.entryLabel}
                                </Link>
                              ) : null}
                              {canManage && s.state === "posted" ? (
                                <UnpostSettlementButton
                                  slug={slug}
                                  settlementId={s.id}
                                  label={label}
                                />
                              ) : canManage && (s.state === "ready" || s.state === "changed") ? (
                                <PostSettlementButton
                                  slug={slug}
                                  settlementId={s.id}
                                  label={label}
                                  again={s.state === "changed"}
                                />
                              ) : null}
                            </div>
                            {s.problem && s.state !== "posted" && s.state !== "before" ? (
                              <p className="mt-1 max-w-xs text-muted-foreground text-xs">
                                {s.problem}
                              </p>
                            ) : null}
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
        <section aria-labelledby="walmart-payouts" className="fade-in-0 grid animate-in gap-2">
          <h2 id="walmart-payouts" className="font-semibold">
            Payouts to your bank
          </h2>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
            <ul className="divide-y">
              {payouts.map((s) => {
                const found = candidates.get(s.id);
                return (
                  <li
                    key={s.id}
                    aria-label={`Payout of ${s.payout} on ${s.reportDate}`}
                    className="grid gap-2 px-4 py-3 sm:px-5"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium text-sm">
                        {formatDate(s.reportDate, locale)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {s.channelName} · {period(s)}
                      </span>
                      {s.deposit ? <Badge variant="success">Deposit matched</Badge> : null}
                      <span className="ms-auto font-medium text-sm">
                        {s.payout ? (
                          <Amount value={s.payout} currency={s.currency} locale={locale} />
                        ) : null}
                      </span>
                    </div>
                    {s.deposit ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                        <Link
                          href={`${base}/accounting/journal/${s.deposit.entryId}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          Deposit of {formatDate(s.deposit.date, locale)} · {s.deposit.entryLabel}
                        </Link>
                        {canManage ? (
                          <span className="ms-auto">
                            <UnmatchPayoutButton slug={slug} settlementId={s.id} />
                          </span>
                        ) : null}
                      </div>
                    ) : found ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-muted/40 px-3 py-2 text-xs">
                        <span className="min-w-0 flex-1">
                          Deposit of{" "}
                          <Amount value={found.amount} currency={found.currency} locale={locale} />{" "}
                          into {found.accountName} on {formatDate(found.date, locale)}
                          {found.categories.length ? `, now in ${found.categories.join(", ")}` : ""}
                          . Matching moves it to your Walmart balance.
                        </span>
                        {canManage ? (
                          <PayoutChoice
                            slug={slug}
                            settlementId={s.id}
                            entryId={found.entryId}
                            converted={found.fit.kind === "converted"}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        No bank deposit of this amount found around{" "}
                        {formatDate(s.reportDate, locale)}. Add the bank transaction, or bring in
                        the bank statement.
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
        Each settlement is read from Walmart's report, row by row: a row's amount type (product
        price, commission, WFS fee…) says which column it counts in. A settlement whose rows don't
        add up to Walmart's payout stays out of your books until it does.
      </p>
    </div>
  );
}
