import {
  can,
  NOON_POSTING_GROUP_KEYS,
  NOON_POSTING_GROUPS,
  type NoonMonthState,
  parseDecimal,
} from "@bookalyze/core";
import {
  type DepositCandidate,
  getNoonConnection,
  getNoonSettings,
  listNoonChannels,
  noonBalanceCheck,
  noonMonths,
  noonPayoutCandidates,
  noonPayouts,
  noonPayoutsWithOneDeposit,
  noonSyncState,
  noonTransactionTypes,
} from "@bookalyze/db";
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  PlugZap,
  ReceiptText,
  Settings2,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { SyncNoonButton, UploadNoonTransactions } from "./noon-sync";
import {
  MatchAllPayoutsButton,
  PayoutChoice,
  PostAllMonthsButton,
  PostMonthButton,
  UnmatchPayoutButton,
  UnpostMonthButton,
} from "./posting-buttons";

export const metadata: Metadata = { title: "Noon transactions" };
/** "Bring in from Noon" runs inside this page's server actions (about 25 s per call). */
export const maxDuration = 60;

const GROUP_HINTS: Partial<Record<string, string>> = {
  fees: "Referral, fulfilment & logistics and other order fees, and fees not tied to an order, VAT included",
  advertising: "Statement fees whose details say advertising, after any advertising subsidy",
  transfers: "Balance Noon moved to another of your contracts",
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

export default async function NoonTransactionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { locale } = ctx.profile;
  const today = nowIn(ctx.profile.timezone).date;
  const data = await inOrg(ctx, async (tx) => {
    const payouts = await noonPayouts(tx);
    const candidates = new Map<string, DepositCandidate>();
    for (const p of payouts.filter((p) => !p.before && !p.matched)) {
      const [first] = await noonPayoutCandidates(tx, p.id);
      if (first) candidates.set(p.id, first);
    }
    return {
      channels: await listNoonChannels(tx),
      connection: await getNoonConnection(tx),
      settings: await getNoonSettings(tx),
      months: await noonMonths(tx, today),
      types: await noonTransactionTypes(tx),
      payouts,
      candidates,
      oneDeposit: (await noonPayoutsWithOneDeposit(tx)).length,
      balance: await noonBalanceCheck(tx, today),
    };
  });
  const { channels, connection, settings, months, types, payouts, candidates, balance } = data;
  const canManage = isOrgAdmin(ctx);
  const live =
    connection && connection.status !== "disconnected" && connection.hasSecret ? connection : null;
  const canBringIn = Boolean(live?.settings.payoutsReport);
  const sync = live ? noonSyncState(live.settings) : null;
  const monthName = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const nameOf = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`));
  const base = `/o/${slug}`;
  const toPost = months.filter((m) => m.state === "ready" || m.state === "changed").length;

  const header = (
    <PageHeader
      eyebrow="Commerce"
      title="Noon transactions"
      description="Every sale, fee, refund and subsidy on Noon, month by month. Each month goes into your books as one entry, the net to your Noon balance; each payout comes out of it when matched to its bank deposit."
      actions={
        canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <UploadNoonTransactions slug={slug} variant="ghost" />
            <Button asChild variant="ghost">
              <Link href={`${base}/commerce/noon/accounts`}>
                <Settings2 />
                How Noon posts
              </Link>
            </Button>
            {canBringIn ? <SyncNoonButton slug={slug} locale={locale} /> : null}
            {settings.postFrom && data.oneDeposit ? (
              <MatchAllPayoutsButton slug={slug} count={data.oneDeposit} />
            ) : null}
            {settings.postFrom && toPost ? (
              <PostAllMonthsButton slug={slug} count={toPost} />
            ) : null}
          </div>
        ) : null
      }
    />
  );
  const status = canBringIn ? (
    <p className="-mt-2 flex items-start gap-2 text-muted-foreground text-sm">
      <CalendarClock className="mt-0.5 size-4 shrink-0" />
      <span>
        {sync?.through
          ? `In through ${formatDate(sync.through, locale)}. Bringing in again adds new days and reads the last three weeks again, for Noon's late fees and updates.`
          : "Bringing in starts a year back and goes a month at a time. Noon makes each month's report in the background, so a full year takes a few minutes."}
      </span>
    </p>
  ) : live ? (
    <p className="-mt-2 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      This key can't download Noon's transaction view. Give the service account a role that can see
      finance, then test the connection on the Channels page.
    </p>
  ) : (
    <Link
      href={`/o/${slug}/commerce/channels`}
      className="-mt-2 flex items-center gap-3 rounded-xl bg-primary/5 px-4 py-3 text-sm transition-colors hover:bg-primary/10"
    >
      <PlugZap className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">Connect Noon's API on the Channels page</span> to bring the
        past year in by itself. Until then, upload the transaction view from Noon's seller portal
        (Finance → Transaction view).
      </span>
    </Link>
  );

  const shown = channels.filter((c) => months.some((m) => m.channelId === c.id));

  if (!shown.length) {
    return (
      <div className="grid gap-8">
        {header}
        {status}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ReceiptText className="size-6" />
          </span>
          <p className="font-medium">No Noon transactions yet</p>
          <p className="max-w-md text-muted-foreground text-sm">
            {canBringIn
              ? "Bring in the past year from Noon, or upload the transaction view you downloaded from Noon's seller portal."
              : "Upload the transaction view from Noon's seller portal (Finance → Transaction view, as CSV). Each row goes to the Noon country of its currency."}
          </p>
          {canManage ? null : (
            <p className="text-muted-foreground text-xs">
              Only owners and admins can bring transactions in.
            </p>
          )}
          {!canManage || canBringIn ? null : (
            <Button asChild variant="ghost">
              <Link href={`/o/${slug}/commerce/channels`}>Go to Channels</Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {header}
      {status}
      {settings.postFrom ? null : (
        <Link
          href={`${base}/commerce/noon/accounts`}
          className="flex items-center gap-3 rounded-xl bg-primary/5 px-4 py-3 text-sm transition-colors hover:bg-primary/10"
        >
          <Settings2 className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Put Noon in your books.</span> Choose the accounts for
            sales, fees, advertising and your Noon balance, and the month posting starts.
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
        </Link>
      )}
      {balance.map((b) => {
        const unexplained = parseDecimal(b.unexplained);
        return (
          <section
            key={b.currency}
            aria-label={`Noon balance in ${b.currency}`}
            className="fade-in-0 grid animate-in gap-3 rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs">Noon balance in your books</p>
                <p className="font-semibold text-lg">
                  <Amount value={b.books} currency={b.currency} locale={locale} />
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">What Noon's rows say it owes you</p>
                <p className="font-semibold text-lg">
                  <Amount value={b.noon} currency={b.currency} locale={locale} />
                </p>
              </div>
            </div>
            <ul className="grid gap-1 text-sm">
              {b.monthsNotPosted ? (
                <li className="text-muted-foreground">
                  <Amount value={b.notPosted} currency={b.currency} locale={locale} /> from{" "}
                  {plural(b.monthsNotPosted, "month")} not in the books yet (a month posts once it's
                  over).
                </li>
              ) : null}
              {b.payoutsNotMatched ? (
                <li className="text-muted-foreground">
                  <Amount value={b.notMatched} currency={b.currency} locale={locale} /> paid out in{" "}
                  {plural(b.payoutsNotMatched, "payout")} not matched to a bank deposit yet.
                </li>
              ) : null}
              <li className="flex items-start gap-2">
                {unexplained === 0n ? (
                  <>
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
                    <span>
                      {b.monthsNotPosted || b.payoutsNotMatched
                        ? "Everything else agrees with Noon."
                        : "Your books agree with Noon."}{" "}
                      Check it against the closing balance on Noon's statement of account.
                    </span>
                  </>
                ) : (
                  <>
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>
                      <Amount value={b.unexplained} currency={b.currency} locale={locale} /> doesn't
                      match: something else in your books uses the Noon balance account.
                    </span>
                  </>
                )}
              </li>
            </ul>
          </section>
        );
      })}
      {shown.map((channel) => {
        const list = months.filter((m) => m.channelId === channel.id);
        const kinds = types.filter((t) => t.channelId === channel.id);
        const paid = payouts.filter((p) => p.channelId === channel.id);
        const rows = list.reduce((t, m) => t + m.rows, 0);
        return (
          <section
            key={channel.id}
            aria-labelledby={`noon-${channel.id}`}
            className="fade-in-0 grid animate-in gap-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id={`noon-${channel.id}`} className="font-semibold">
                {channel.name}
              </h2>
              <p className="text-muted-foreground text-sm">
                {plural(rows, "transaction")} · {channel.currency}
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
              <ul className="divide-y">
                {list.map((m, i) => {
                  const label = nameOf(m.month);
                  const badge = STATE_BADGES[m.state];
                  const parts = NOON_POSTING_GROUP_KEYS.filter(
                    (g) => parseDecimal(m.groups[g]) !== 0n,
                  );
                  return (
                    <li
                      key={m.month}
                      aria-label={label}
                      className="fade-in-0 grid animate-in gap-2 fill-mode-both px-4 py-3.5 sm:px-5"
                      style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-medium text-sm">{label}</span>
                        <span className="text-muted-foreground text-xs">
                          {plural(m.rows, "transaction")}
                        </span>
                        {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
                        {m.unbalanced ? (
                          <Badge
                            variant="warning"
                            title="Some rows' columns don't add up to their total. Check them in Noon's file."
                          >
                            {plural(m.unbalanced, "row")} to check
                          </Badge>
                        ) : null}
                        <span className="ms-auto text-end font-medium text-sm">
                          <span className="sr-only">Earned </span>
                          <Amount value={m.earned} currency={channel.currency} locale={locale} />
                        </span>
                      </div>
                      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                        <dl className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-1 text-xs">
                          {parts.map((g) => (
                            <div key={g} className="flex gap-1.5" title={GROUP_HINTS[g]}>
                              <dt className="text-muted-foreground">{NOON_POSTING_GROUPS[g]}</dt>
                              <dd>
                                <Amount
                                  value={m.groups[g]}
                                  currency={channel.currency}
                                  locale={locale}
                                />
                              </dd>
                            </div>
                          ))}
                          {parseDecimal(m.paidOut) !== 0n ? (
                            <div className="flex gap-1.5 text-muted-foreground">
                              <dt>Paid out to your bank</dt>
                              <dd>
                                <Amount
                                  value={m.paidOut}
                                  currency={channel.currency}
                                  locale={locale}
                                />
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                        {m.state === "posted" || m.state === "changed" || m.state === "ready" ? (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs sm:ms-auto">
                            {m.posted ? (
                              <Link
                                href={`${base}/accounting/journal/${m.posted.entryId}`}
                                className="text-primary underline-offset-4 hover:underline"
                              >
                                {m.state === "changed" ? (
                                  <>
                                    Posted as {m.posted.entryLabel} with{" "}
                                    <Amount
                                      value={m.posted.earned}
                                      currency={channel.currency}
                                      locale={locale}
                                    />
                                  </>
                                ) : (
                                  `Posted as ${m.posted.entryLabel}`
                                )}
                              </Link>
                            ) : null}
                            {canManage ? (
                              <span className="ms-auto flex flex-wrap gap-2">
                                {m.state === "posted" ? (
                                  <UnpostMonthButton
                                    slug={slug}
                                    channelId={channel.id}
                                    month={m.month}
                                    label={label}
                                  />
                                ) : (
                                  <PostMonthButton
                                    slug={slug}
                                    channelId={channel.id}
                                    month={m.month}
                                    label={label}
                                    again={m.state === "changed"}
                                  />
                                )}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            {paid.length ? (
              <div className="grid gap-2">
                <h3 className="font-medium text-sm">Payouts to your bank</h3>
                <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
                  <ul className="divide-y">
                    {paid.map((p) => {
                      const found = candidates.get(p.id);
                      return (
                        <li
                          key={p.id}
                          aria-label={`Payout of ${p.amount} on ${p.date}`}
                          className="grid gap-2 px-4 py-3 sm:px-5"
                        >
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="font-medium text-sm">
                              {formatDate(p.date, locale)}
                            </span>
                            <span className="text-muted-foreground text-xs">{p.referenceNr}</span>
                            {p.matched ? (
                              <Badge variant="success">Deposit matched</Badge>
                            ) : p.before ? (
                              <Badge variant="outline">Before posting starts</Badge>
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
                                Deposit of {formatDate(p.matched.date, locale)} ·{" "}
                                {p.matched.entryLabel}
                              </Link>
                              {canManage ? (
                                <span className="ms-auto">
                                  <UnmatchPayoutButton slug={slug} transactionId={p.id} />
                                </span>
                              ) : null}
                            </div>
                          ) : p.before || !settings.postFrom ? null : found ? (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-muted/40 px-3 py-2 text-xs">
                              <span className="min-w-0 flex-1">
                                Deposit of{" "}
                                <Amount
                                  value={found.amount}
                                  currency={found.currency}
                                  locale={locale}
                                />{" "}
                                into {found.accountName} on {formatDate(found.date, locale)}
                                {found.categories.length
                                  ? `, now in ${found.categories.join(", ")}`
                                  : ""}
                                . Matching moves it to your Noon balance.
                              </span>
                              {canManage ? (
                                <PayoutChoice
                                  slug={slug}
                                  transactionId={p.id}
                                  entryId={found.entryId}
                                  converted={found.fit.kind === "converted"}
                                />
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-muted-foreground text-xs">
                              No bank deposit of this amount found around{" "}
                              {formatDate(p.date, locale)}. Add the bank transaction, or bring in
                              the bank statement.
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ) : null}
            {kinds.length ? (
              <details className="group rounded-2xl border bg-card px-4 py-3 shadow-xs sm:px-5">
                <summary className="cursor-pointer font-medium text-sm">
                  Transaction types Noon uses ({kinds.length})
                  <span className="block font-normal text-muted-foreground text-xs">
                    How often each appears, and what they come to.
                  </span>
                </summary>
                <ul className="mt-3 divide-y text-sm">
                  {kinds.map((k) => (
                    <li key={k.transactionType} className="flex items-baseline gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{k.transactionType}</span>
                      <span className="text-muted-foreground text-xs">{plural(k.rows, "row")}</span>
                      <Amount
                        value={k.total}
                        currency={channel.currency}
                        locale={locale}
                        className="w-28 text-end"
                      />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
