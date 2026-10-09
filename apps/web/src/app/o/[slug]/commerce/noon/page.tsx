import { can, formatDecimal, parseDecimal } from "@bookalyze/core";
import {
  getNoonConnection,
  listNoonChannels,
  type NoonMonth,
  noonSyncState,
  noonTransactionMonths,
  noonTransactionTypes,
} from "@bookalyze/db";
import { CalendarClock, CircleAlert, PlugZap, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { SyncNoonButton, UploadNoonTransactions } from "./noon-sync";

export const metadata: Metadata = { title: "Noon transactions" };
/** "Bring in from Noon" runs inside this page's server actions (about 25 s per call). */
export const maxDuration = 60;

const sum = (...values: string[]) =>
  formatDecimal(values.reduce((t, v) => t + parseDecimal(v), 0n));

/** What a month's columns come to, grouped the way a seller reads them. */
function monthParts(m: NoonMonth) {
  return [
    { label: "Sales", value: m.netProceeds },
    {
      label: "Fees",
      value: sum(m.referralFee, m.fulfilmentFee, m.otherOrderFees, m.nonOrderFees),
      hint: "Referral, fulfilment & logistics, other order fees and fees not tied to an order (storage, for example), VAT included",
    },
    { label: "Shipping credits", value: m.shippingCredits },
    { label: "Subsidies", value: sum(m.orderSubsidies, m.nonOrderSubsidies) },
    { label: "Others", value: m.others },
  ];
}

export default async function NoonTransactionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { locale } = ctx.profile;
  const { channels, connection, months, types } = await inOrg(ctx, async (tx) => ({
    channels: await listNoonChannels(tx),
    connection: await getNoonConnection(tx),
    months: await noonTransactionMonths(tx),
    types: await noonTransactionTypes(tx),
  }));
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

  const header = (
    <PageHeader
      eyebrow="Commerce"
      title="Noon transactions"
      description="Every sale, fee, refund and subsidy on Noon, as Noon's transaction view lists them, month by month. Nothing is posted to your books from here yet."
      actions={
        canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <UploadNoonTransactions slug={slug} variant={canBringIn ? "ghost" : "outline"} />
            {canBringIn ? <SyncNoonButton slug={slug} locale={locale} /> : null}
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
      {shown.map((channel) => {
        const list = months.filter((m) => m.channelId === channel.id);
        const kinds = types.filter((t) => t.channelId === channel.id);
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
                {list.map((m, i) => (
                  <li
                    key={m.month}
                    className="fade-in-0 grid animate-in gap-2 fill-mode-both px-4 py-3.5 sm:px-5"
                    style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium text-sm">
                        {monthName.format(new Date(`${m.month}-01T00:00:00Z`))}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {plural(m.rows, "transaction")}
                      </span>
                      {m.unbalanced ? (
                        <Badge
                          variant="warning"
                          title="Some rows' columns don't add up to their total. Check them in Noon's file."
                        >
                          {plural(m.unbalanced, "row")} to check
                        </Badge>
                      ) : null}
                      <span className="ms-auto font-medium text-sm">
                        <span className="sr-only">Total </span>
                        <Amount value={m.total} currency={channel.currency} locale={locale} />
                      </span>
                    </div>
                    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                      {monthParts(m).map((part) => (
                        <div key={part.label} className="flex gap-1.5" title={part.hint}>
                          <dt className="text-muted-foreground">{part.label}</dt>
                          <dd>
                            <Amount
                              value={part.value}
                              currency={channel.currency}
                              locale={locale}
                              muteZero
                            />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
            {kinds.length ? (
              <details className="group rounded-2xl border bg-card px-4 py-3 shadow-xs sm:px-5">
                <summary className="cursor-pointer font-medium text-sm">
                  Transaction types Noon uses ({kinds.length})
                  <span className="block font-normal text-muted-foreground text-xs">
                    How often each appears, and what they come to. They decide how Noon's payouts
                    will post to your books.
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
