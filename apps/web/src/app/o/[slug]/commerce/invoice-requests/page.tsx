import { listInvoiceRequests } from "@bookalyze/db";
import { ArrowRight, Inbox, MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyAddress } from "@/components/copy-address";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { loadInvoiceInbox } from "@/server/invoice-requests";
import { isOrgAdmin } from "@/server/org";
import { RequestActions } from "./request-rows";

export const metadata: Metadata = { title: "Invoice requests" };

const STATUS = {
  open: { label: "Waiting", variant: "warning" },
  done: { label: "Answered", variant: "success" },
  dismissed: { label: "Set aside", variant: "secondary" },
} as const;

export default async function InvoiceRequestsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  const [inbox, requests] = await Promise.all([
    loadInvoiceInbox(ctx),
    inOrg(ctx, (tx) => listInvoiceRequests(tx, { limit: 100 })),
  ]);
  const { locale } = ctx.profile;
  const day = (date: Date) => formatDate(date.toISOString().slice(0, 10), locale);
  const admin = isOrgAdmin(ctx);

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Commerce"
        title="Invoice requests"
        description="Buyers who asked for an invoice. Create it on the order and send it through Amazon from there."
      />

      <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MailCheck className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Forward Amazon's request emails here</h2>
            <p className="text-muted-foreground text-sm">
              Amazon can't share buyer messages with apps, but it emails you each invoice request.
              Forward those emails to this company's address and they show up here and on Home.
            </p>
          </div>
        </div>
        <div className="grid gap-4 px-5 py-5 text-sm">
          {inbox.address ? (
            <>
              <CopyAddress address={inbox.address} />
              <ol className="grid list-decimal gap-2 ps-5 text-muted-foreground">
                <li>
                  In Gmail: Settings →{" "}
                  <span className="text-foreground">Forwarding and POP/IMAP</span> → Add a
                  forwarding address, and paste the address above.
                </li>
                <li>
                  Gmail sends a confirmation code to it. It appears below within a minute. Enter it
                  in Gmail.
                </li>
                <li>
                  Create a filter: <span className="text-foreground">Subject</span>{" "}
                  <code className="rounded bg-muted px-1">
                    "Invoice request from Amazon customer"
                  </code>{" "}
                  → Forward it to the address above. Choose "Also apply to matching conversations"
                  to bring in requests you already have.
                </li>
              </ol>
              {inbox.lastOtherSubject ? (
                <p className="rounded-xl border bg-muted/40 px-3 py-2">
                  <span className="text-muted-foreground">Latest other email</span>
                  {inbox.lastOtherAt ? ` (${day(new Date(inbox.lastOtherAt))})` : ""}:{" "}
                  <span className="font-medium">{inbox.lastOtherSubject}</span>
                </p>
              ) : null}
              <p className="text-muted-foreground">
                {inbox.lastRequestAt
                  ? `Last request received ${day(new Date(inbox.lastRequestAt))}.`
                  : "No request has come in yet."}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Receiving emails isn't switched on for this Bookalyze yet (it needs a receiving domain
              and its webhook). Until then, answer requests from the order page.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="font-semibold">Requests</h2>
        {requests.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed px-5 py-8 text-muted-foreground text-sm">
            <Inbox className="size-5" />
            No invoice requests yet.
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
            {requests.map((r) => {
              const status = STATUS[r.status];
              const next = r.invoiceId
                ? r.sentAt
                  ? `${r.invoiceNumber ?? "Invoice"} sent ${day(r.sentAt)}`
                  : `${r.invoiceNumber ?? "Invoice"} created, not sent`
                : "No invoice yet";
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-sm">
                      <span className="tabular">{r.externalOrderId}</span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {r.buyerName ?? "A buyer"} · asked {day(r.requestedAt)} · {next}
                      {r.orderId ? "" : " · order not synced yet"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {admin ? (
                      <RequestActions slug={slug} requestId={r.id} status={r.status} />
                    ) : null}
                    {r.orderId ? (
                      <Link
                        href={`/o/${slug}/commerce/orders/${r.orderId}`}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium text-primary text-sm hover:bg-primary/5"
                      >
                        Open order
                        <ArrowRight className="size-3.5" />
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
