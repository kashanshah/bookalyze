import {
  can,
  formatDecimal,
  parseDecimal,
  SETTLEMENT_GROUPS,
  type SettlementGroup,
  settlementGroup,
  settlementLineLabel,
} from "@bookalyze/core";
import { getSettlement } from "@bookalyze/db";
import { AlertTriangle, ArrowLeft, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";

export const metadata: Metadata = { title: "Settlement" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER = Object.keys(SETTLEMENT_GROUPS) as SettlementGroup[];

export default async function SettlementPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const s = await inOrg(ctx, (tx) => getSettlement(tx, id));
  if (!s) notFound();
  const { locale, timezone } = ctx.profile;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone });
  const negative = parseDecimal(s.total) < 0n;

  // Lines by group, each group with its subtotal, in a fixed order.
  const groups = ORDER.map((key) => {
    const lines = s.lines
      .filter((l) => settlementGroup(l) === key)
      .map((l) => ({ ...l, label: settlementLineLabel(l) }));
    // Same plain name twice (an order's and a refund's tax, say): keep them apart by type.
    const labels = new Map<string, number>();
    for (const l of lines) labels.set(l.label, (labels.get(l.label) ?? 0) + 1);
    const subtotal = formatDecimal(lines.reduce((t, l) => t + parseDecimal(l.amount), 0n));
    return {
      key,
      label: SETTLEMENT_GROUPS[key],
      subtotal,
      lines: lines.map((l) => ({
        ...l,
        label: (labels.get(l.label) ?? 0) > 1 ? `${l.label} (${l.transactionType})` : l.label,
      })),
    };
  }).filter((g) => g.lines.length);

  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/settlements`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Settlements
      </Link>
      <PageHeader
        title={`${day.format(s.startAt)} – ${day.format(s.endAt)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{s.channelName ?? s.marketplace ?? "Amazon"}</span>
            <span>·</span>
            <span className="tabular">Settlement {s.externalId}</span>
            {s.source === "upload" ? <Badge variant="secondary">Uploaded</Badge> : null}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <h2 className="border-b px-5 py-3 font-medium text-sm">What makes up the payout</h2>
          {groups.map((g) => (
            <div key={g.key} className="border-b last:border-b-0">
              <div className="flex items-center justify-between gap-4 bg-muted/20 px-5 py-2.5 font-medium text-sm">
                <span>{g.label}</span>
                <Amount value={g.subtotal} currency={s.currency} locale={locale} />
              </div>
              <ul className="divide-y">
                {g.lines.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-start justify-between gap-4 px-5 py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block">{l.label}</span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {[l.transactionType, l.amountType, l.amountDescription].join(" · ")}
                        {l.count > 1 ? ` · ${l.count} lines` : ""}
                      </span>
                    </span>
                    <Amount value={l.amount} currency={s.currency} locale={locale} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t bg-muted/20 px-5 py-4 font-semibold text-sm">
            <span>{negative ? "Owed to Amazon" : "Paid to you"}</span>
            <Amount value={s.total} currency={s.currency} locale={locale} />
          </div>
        </section>

        <aside className="grid h-fit gap-4">
          <div className="rounded-2xl border bg-card p-5 shadow-xs">
            <p className="text-muted-foreground text-xs">
              {negative ? "Owed to Amazon" : "Payout"}
            </p>
            <p className="mt-1 font-semibold text-2xl tracking-tight">
              <Amount value={s.total} currency={s.currency} locale={locale} />
            </p>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Paid into your bank</dt>
                <dd className="mt-0.5">
                  {negative
                    ? "Nothing: Amazon carries the balance to the next period or charges your card"
                    : s.depositDate
                      ? formatDate(s.depositDate, locale)
                      : "Not paid yet"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Orders</dt>
                <dd className="mt-0.5">{s.orderCount}</dd>
              </div>
            </dl>
          </div>
          {s.balanced ? null : (
            <p className="flex gap-2 rounded-xl bg-warning/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              The lines don't add up to the payout. Download the statement again from Seller Central
              and upload it.
            </p>
          )}
          <p className="flex gap-2 rounded-xl bg-primary/5 px-4 py-3 text-muted-foreground text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            Not in your books yet. Next, each settlement will post as one entry (sales, refunds and
            fees to their own accounts) and be matched to its deposit.
          </p>
        </aside>
      </div>
    </div>
  );
}
