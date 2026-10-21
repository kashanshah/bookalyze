import { supportTicketLabel } from "@bookalyze/core";
import { listSupportTickets } from "@bookalyze/db";
import { ArrowUpRight, BookOpen, Inbox, LifeBuoy, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { TicketStatus } from "@/components/support/ticket-parts";
import { Input } from "@/components/ui/input";
import { inOrg } from "@/server/accounting";
import { getOrgContext } from "@/server/org";
import { SupportForm } from "./support-form";

export const metadata: Metadata = { title: "Help & support" };

const GUIDES_URL = "https://bookalyze.com/guides";

/** The guides people need most, on the public site. */
const POPULAR = [
  { slug: "how-bookalyze-works", title: "How Bookalyze works: the path your money takes" },
  { slug: "connect-amazon", title: "Connect Amazon Seller Central" },
  { slug: "how-payouts-post", title: "How payouts post to your books" },
  { slug: "match-payouts", title: "Match each payout to your bank" },
  { slug: "connect-wise", title: "Connect Wise" },
  { slug: "month-end-for-sellers", title: "Month end for marketplace sellers" },
] as const;

export default async function HelpPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { slug } = await params;
  const { from } = await searchParams;
  const ctx = await getOrgContext(slug);
  const tickets = await inOrg(ctx, (tx) => listSupportTickets(tx, { limit: 50 }));
  const locale = ctx.profile?.locale ?? "en-CA";
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const fromPage = from?.startsWith(`/o/${slug}`) ? from : null;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Help & support"
        description="Search the guides, or ask us. Replies come here and to your email."
      />

      <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Find it in the guides</h2>
            <p className="text-muted-foreground text-sm">
              Step-by-step guides for every screen, with what you should see when it's right.
            </p>
          </div>
        </div>
        <form action={GUIDES_URL} method="get" target="_blank" className="relative" rel="noopener">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            type="search"
            aria-label="Search the guides"
            placeholder="Search the guides, e.g. match a payout"
            className="ps-9"
          />
        </form>
        <ul className="grid gap-1 sm:grid-cols-2">
          {POPULAR.map((g) => (
            <li key={g.slug}>
              <a
                href={`${GUIDES_URL}/${g.slug}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span className="min-w-0 flex-1">{g.title}</span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section
          id="contact"
          className="grid content-start gap-5 rounded-2xl border bg-card p-5 shadow-xs sm:p-6"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LifeBuoy className="size-4.5" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">Contact support</h2>
              <p className="text-muted-foreground text-sm">
                A person reads every message. Everyone in {ctx.org.name} can see the tickets opened
                for it.
              </p>
            </div>
          </div>
          <SupportForm slug={slug} from={fromPage} />
        </section>

        <section className="grid content-start gap-3">
          <h2 className="font-semibold">Your tickets</h2>
          {tickets.length ? (
            <ul className="grid gap-2">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/o/${slug}/help/${t.id}`}
                    className="grid gap-1.5 rounded-xl border bg-card p-3.5 shadow-xs transition-colors hover:border-primary/30"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs">
                        {supportTicketLabel(t.number)} · {day.format(t.lastMessageAt)}
                      </span>
                      <TicketStatus status={t.status} />
                    </span>
                    <span className="line-clamp-2 font-medium text-sm">{t.subject}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-6 text-center">
              <Inbox className="size-5 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">No tickets yet.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
