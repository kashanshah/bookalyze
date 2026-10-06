import { REVIEW_STATUS_LABELS } from "@bookalyze/core";
import {
  getReviewSettings,
  hasOrders,
  listAmazonConnections,
  listReviewOrders,
  REVIEW_TABS,
  type ReviewTab,
} from "@bookalyze/db";
import { ArrowLeft, ArrowRight, MessageSquareHeart, Settings2, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { nowIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inOrg } from "@/server/accounting";
import { getReviewsContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { AskAllButton, type ReviewRow, ReviewRows } from "./review-rows";
import { scheduleSummary } from "./schedule";

export const metadata: Metadata = { title: "Review requests" };
/** Sending requests runs inside this page's server actions (Amazon allows about one a second). */
export const maxDuration = 60;

const PER_PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAB_LABELS: Record<ReviewTab, string> = {
  ask: "To ask",
  scheduled: "Scheduled",
  sent: "Requested",
  other: "Left out",
};
const EMPTY: Record<ReviewTab, { title: string; hint: string }> = {
  ask: {
    title: "Nothing to ask right now",
    hint: "Shipped orders show up here until Amazon's window closes, 30 days after delivery.",
  },
  scheduled: {
    title: "Nothing scheduled",
    hint: "Turn on automatic requests and each new order gets its time here.",
  },
  sent: { title: "No requests yet", hint: "Orders you've asked for a review show up here." },
  other: {
    title: "Nothing left out",
    hint: "Orders skipped (refunded, say) or that Amazon wouldn't take show up here.",
  },
};

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; channel?: string; page?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getReviewsContext(slug);
  const { locale, timezone } = ctx.profile;
  const today = nowIn(timezone).date;
  const tab = (REVIEW_TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as ReviewTab)
    : "ask";
  const channel = sp.channel && UUID.test(sp.channel) ? sp.channel : "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const data = await inOrg(ctx, async (tx) => {
    const channels = (await listAmazonConnections(tx))
      .filter((c) => c.status !== "disconnected")
      .flatMap((c) => c.channels.filter((ch) => ch.isActive));
    return {
      channels,
      settings: await getReviewSettings(tx),
      any: await hasOrders(tx),
      list: await listReviewOrders(tx, {
        tab,
        today,
        channelId: channel || null,
        limit: PER_PAGE,
        offset: (page - 1) * PER_PAGE,
      }),
    };
  });
  const { channels, settings, any, list } = data;
  const canSend = isOrgAdmin(ctx);
  const base = `/o/${slug}/reviews`;
  const href = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, channel, page: 1, ...over })) {
      if (v && !(k === "page" && v === 1) && !(k === "tab" && v === "ask")) p.set(k, String(v));
    }
    return `${base}${p.size ? `?${p}` : ""}`;
  };

  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone });
  const short = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const moment = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  const onDay = (iso: string) => short.format(new Date(`${iso}T00:00:00Z`));
  const sourceLabel = { auto: "Automatic", manual: "By hand", bulk: "In bulk" } as const;
  const rows: ReviewRow[] = list.rows.map((r) => {
    const open = r.opens <= today;
    let when: string;
    if (r.request?.status === "scheduled" && r.request.dueAt) {
      when = `Goes out ${moment.format(r.request.dueAt)}`;
    } else if (r.request?.status === "sent" && r.request.sentAt) {
      when = `Requested ${moment.format(r.request.sentAt)} · ${sourceLabel[r.request.source]}`;
    } else if (r.request) {
      when = REVIEW_STATUS_LABELS[r.request.status].label;
    } else {
      when = open ? `Can be asked until ${onDay(r.closes)}` : `Can be asked from ${onDay(r.opens)}`;
    }
    return {
      id: r.id,
      externalId: r.externalId,
      title: r.firstTitle ?? "Order",
      meta: [day.format(r.purchasedAt), channels.length > 1 ? r.channelName : null]
        .filter(Boolean)
        .join(" · "),
      when,
      reason: r.request?.reason ?? null,
      status: r.request?.status ?? null,
      open,
    };
  });

  const header = (
    <PageHeader
      eyebrow="Commerce"
      title="Review requests"
      description="Ask buyers for a product review and seller feedback with Amazon's own “Request a Review”, the same message as the button in Seller Central, in the buyer's language. Amazon allows one per order, from 5 to 30 days after delivery."
      actions={
        <Button asChild variant="outline">
          <Link href={`${base}/automatic`}>
            <Settings2 />
            Automatic requests
          </Link>
        </Button>
      }
    />
  );

  if (!any) {
    return (
      <div className="grid gap-8">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Star className="size-6" />
          </span>
          <p className="font-medium">Bring in your Amazon orders first</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            Review requests are sent for your Amazon orders, so they need to come in first.
          </p>
          <Button asChild variant="outline">
            <Link href={`/o/${slug}/commerce/orders`}>Go to Orders</Link>
          </Button>
        </div>
      </div>
    );
  }

  const cards = [
    {
      label: "Ready to ask now",
      value: list.counts.ready,
      hint: "Within Amazon's window, not asked yet",
    },
    { label: "Scheduled", value: list.counts.scheduled, hint: "Going out automatically" },
    {
      label: "Requested lately",
      value: list.counts.sentLast30,
      hint: `In the last 30 days · ${list.counts.sent} in all`,
    },
  ];

  return (
    <div className="grid gap-6">
      {header}

      <Link
        href={`${base}/automatic`}
        className={cn(
          "-mt-2 flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors",
          settings.enabled
            ? "bg-success/8 hover:bg-success/12"
            : "bg-primary/5 hover:bg-primary/10",
        )}
      >
        <MessageSquareHeart
          className={cn("size-4 shrink-0", settings.enabled ? "text-success" : "text-primary")}
        />
        <span className="min-w-0 flex-1">
          {settings.enabled ? (
            <>
              <span className="font-medium">Automatic requests are on:</span>{" "}
              {scheduleSummary(settings, locale)}.
            </>
          ) : (
            <>
              <span className="font-medium">Ask every buyer automatically.</span> Choose when, and
              which orders to leave out (refunded ones, say).
            </>
          )}
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
      </Link>

      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border bg-card px-5 py-4 shadow-xs">
            <p className="text-muted-foreground text-xs">{c.label}</p>
            <p className="tabular mt-1 font-semibold text-xl tracking-tight">{c.value}</p>
            <p className="mt-0.5 text-muted-foreground text-xs">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Requests"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          {REVIEW_TABS.map((t) => (
            <Link
              key={t}
              href={href({ tab: t })}
              scroll={false}
              aria-current={t === tab ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                t === tab
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {TAB_LABELS[t]}
              <span className="tabular text-xs opacity-70">{list.counts[t]}</span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {channels.length > 1 ? (
            <nav aria-label="Marketplace" className="flex flex-wrap gap-1">
              {[{ id: "", name: "All marketplaces" }, ...channels].map((c) => (
                <Link
                  key={c.id}
                  href={href({ channel: c.id })}
                  scroll={false}
                  aria-current={c.id === channel ? "true" : undefined}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    c.id === channel
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {c.name}
                </Link>
              ))}
            </nav>
          ) : null}
          {tab === "ask" && canSend && list.counts.ready ? (
            <AskAllButton slug={slug} count={list.counts.ready} channelId={channel || null} />
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Star className="size-6" />
          </span>
          <p className="font-medium">{EMPTY[tab].title}</p>
          <p className="max-w-sm text-muted-foreground text-sm">{EMPTY[tab].hint}</p>
        </div>
      ) : (
        <ReviewRows
          key={`${tab}:${channel}:${page}`}
          slug={slug}
          tab={tab}
          rows={rows}
          canSend={canSend}
          orderBase={`/o/${slug}/commerce/orders`}
        />
      )}

      {list.counts[tab] > PER_PAGE ? (
        <div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
          <span>
            {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, list.counts[tab])} of{" "}
            {list.counts[tab]}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: page - 1 })}>
                  <ArrowLeft className="rtl:rotate-180" />
                  Previous
                </Link>
              </Button>
            ) : null}
            {page * PER_PAGE < list.counts[tab] ? (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: page + 1 })}>
                  Next
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
