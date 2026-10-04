import { listConnections } from "@bookalyze/db";
import { AlertTriangle, ArrowRight, CircleCheck, FileUp, Landmark, Link2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { getBankingContext, inOrg } from "@/server/accounting";
import { isOrgAdmin } from "@/server/org";
import { ConnectWiseDialog } from "./connect-wise-dialog";
import { ConnectionActions } from "./connection-actions";

export const metadata: Metadata = { title: "Bank accounts" };

function syncedLabel(at: Date | null, locale: string, timeZone: string): string {
  if (!at) return "Not synced yet";
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  if (minutes < 24 * 60) return `Synced ${Math.round(minutes / 60)} h ago`;
  return `Synced ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(at)}`;
}

export default async function BankAccountsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getBankingContext(slug);
  const { locale, timezone } = ctx.profile;
  const connections = (await inOrg(ctx, (tx) => listConnections(tx))).filter(
    (c) => c.status !== "disconnected",
  );
  const admin = isOrgAdmin(ctx);

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Banking"
        title="Bank accounts"
        description="Connect your bank so transactions arrive on their own. They land on the Transactions screen as uncategorized, ready for you to sort."
        actions={admin && connections.length ? <ConnectWiseDialog slug={slug} /> : null}
      />

      {connections.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="fade-in-0 slide-in-from-bottom-2 flex animate-in flex-col gap-4 rounded-2xl border bg-card p-6 shadow-xs">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Link2 className="size-5" />
            </span>
            <div className="flex-1">
              <h2 className="font-semibold">Connect Wise</h2>
              <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                Bring in every Wise balance with a read-only API token. New transactions sync each
                day, and conversions between your balances are recorded as transfers.
              </p>
            </div>
            {admin ? (
              <ConnectWiseDialog slug={slug} />
            ) : (
              <p className="text-muted-foreground text-sm">Ask an owner or admin to connect it.</p>
            )}
          </div>
          <div className="flex flex-col gap-4 rounded-2xl border border-dashed p-6">
            <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <FileUp className="size-5" />
            </span>
            <div className="flex-1">
              <h2 className="flex flex-wrap items-center gap-2 font-semibold">
                Upload a bank statement
                <Badge variant="outline">Soon</Badge>
              </h2>
              <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                For any other bank or card: download a CSV from your online banking and upload it
                here. You match its columns once, and each upload after that is one click.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {connections.map((c, i) => (
            <section
              key={c.id}
              className="fade-in-0 slide-in-from-bottom-2 animate-in overflow-hidden rounded-2xl border bg-card fill-mode-both shadow-xs"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Landmark className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{c.name}</h2>
                    <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
                      {c.status === "error" ? (
                        <AlertTriangle className="size-3.5 text-destructive" />
                      ) : (
                        <CircleCheck className="size-3.5 text-success" />
                      )}
                      {syncedLabel(c.lastSyncedAt, locale, timezone)}
                    </p>
                  </div>
                </div>
                <ConnectionActions
                  slug={slug}
                  connectionId={c.id}
                  name={c.name}
                  canDisconnect={admin}
                />
              </div>
              {c.lastError ? (
                <p className="flex gap-2 border-b bg-destructive/5 px-5 py-3 text-destructive text-sm sm:px-6">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {c.lastError}
                </p>
              ) : null}
              <ul className="divide-y">
                {c.feeds
                  .filter((f) => f.isActive)
                  .map((f) => (
                    <li key={f.id}>
                      <Link
                        href={`/o/${slug}/accounting/transactions?account=${f.accountId}`}
                        className="group flex items-center justify-between gap-4 px-5 py-3 text-sm transition-colors hover:bg-muted/40 sm:px-6"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <Badge variant="outline" className="font-mono">
                            {f.currency}
                          </Badge>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {f.accountCode ? `${f.accountCode} · ` : ""}
                              {f.accountName}
                            </span>
                            <span className="block text-muted-foreground text-xs">
                              From {formatDate(f.syncFrom, locale)}
                            </span>
                          </span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-primary">
                          Transactions
                          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
