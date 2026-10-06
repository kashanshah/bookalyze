import { can, parseDecimal } from "@bookalyze/core";
import { listAmazonConnections, listSettlements } from "@bookalyze/db";
import { ArrowLeft, ArrowRight, ChevronRight, Landmark } from "lucide-react";
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
import { SyncSettlementsButton, UploadSettlements } from "./settlement-sync";

export const metadata: Metadata = { title: "Settlements" };
/** "Bring in settlements" runs inside this page's server actions. */
export const maxDuration = 60;

const PER_PAGE = 50;

export default async function SettlementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { locale, timezone } = ctx.profile;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { connections, list } = await inOrg(ctx, async (tx) => ({
    connections: (await listAmazonConnections(tx)).filter((c) => c.status !== "disconnected"),
    list: await listSettlements(tx, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
  }));
  const canManage = isOrgAdmin(ctx);
  const base = `/o/${slug}/commerce/settlements`;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone });

  const header = (
    <PageHeader
      eyebrow="Commerce"
      title="Settlements"
      description="Every Amazon payout: what sold, what was refunded, and the fees Amazon kept. Each settlement is paid into your bank as one deposit. They don't change your books yet."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? <UploadSettlements slug={slug} /> : null}
          {connections.length ? <SyncSettlementsButton slug={slug} /> : null}
        </div>
      }
    />
  );

  if (!list.count) {
    return (
      <div className="grid gap-8">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Landmark className="size-6" />
          </span>
          <p className="font-medium">No settlements yet</p>
          <p className="max-w-md text-muted-foreground text-sm">
            {connections.length
              ? "Bring in the last 90 days from Amazon. For older periods, download each statement's “Flat File V2” in Seller Central → Payments → All statements, and upload it here."
              : "Connect Amazon Seller Central on the Channels page, or upload settlement files (Seller Central → Payments → All statements → “Flat File V2”)."}
          </p>
          {connections.length ? null : (
            <Button asChild variant="outline">
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
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="hidden grid-cols-[minmax(0,1fr)_9rem_9rem_1.25rem] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
          <span>Period</span>
          <span>Paid out</span>
          <span className="text-end">Payout</span>
          <span />
        </div>
        <ul className="divide-y">
          {list.rows.map((s, i) => {
            const negative = parseDecimal(s.total) < 0n;
            return (
              <li
                key={s.id}
                className="fade-in-0 animate-in fill-mode-both"
                style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
              >
                <Link
                  href={`${base}/${s.id}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-5 md:grid-cols-[minmax(0,1fr)_9rem_9rem_1.25rem]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-sm">
                      {day.format(s.startAt)} – {day.format(s.endAt)}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
                      <span>{s.channelName ?? s.marketplace ?? "Amazon"}</span>
                      <span>·</span>
                      <span>{s.orderCount === 1 ? "1 order" : `${s.orderCount} orders`}</span>
                      {s.balanced ? null : (
                        <Badge variant="warning" title="The lines don't add up to the payout">
                          Check
                        </Badge>
                      )}
                    </span>
                  </span>
                  <span className="col-start-1 text-muted-foreground text-sm md:col-start-auto">
                    {negative
                      ? "No payout"
                      : s.depositDate
                        ? formatDate(s.depositDate, locale)
                        : "Not paid yet"}
                  </span>
                  <span className="col-start-2 row-span-2 row-start-1 text-end font-medium text-sm md:col-start-auto md:row-span-1 md:row-start-auto">
                    <Amount value={s.total} currency={s.currency} locale={locale} />
                  </span>
                  <ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block rtl:rotate-180" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {list.count > PER_PAGE ? (
        <div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
          <span>
            {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, list.count)} of {list.count}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`${base}?page=${page - 1}`}>
                  <ArrowLeft className="rtl:rotate-180" />
                  Newer
                </Link>
              </Button>
            ) : null}
            {page * PER_PAGE < list.count ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`${base}?page=${page + 1}`}>
                  Older
                  <ArrowRight className="rtl:rotate-180" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
