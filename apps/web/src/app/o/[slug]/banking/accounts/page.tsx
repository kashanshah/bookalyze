import { isMoneyAccountSubtype, type StatementSettings } from "@bookalyze/core";
import { countOpenDuplicates, listConnections } from "@bookalyze/db";
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  Copy,
  FileUp,
  Landmark,
  Link2,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { getBankingContext, inOrg, listAccounts } from "@/server/accounting";
import { isOrgAdmin } from "@/server/org";
import { ConnectWiseDialog } from "./connect-wise-dialog";
import { ConnectionActions } from "./connection-actions";
import { StatementUploadButton } from "./statement-upload-button";
import type { StatementAccount } from "./statement-upload-dialog";

export const metadata: Metadata = { title: "Bank accounts" };

function syncedLabel(at: Date | null, locale: string, timeZone: string, verb = "Synced"): string {
  if (!at) return verb === "Synced" ? "Not synced yet" : "Nothing uploaded yet";
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return `${verb} just now`;
  if (minutes < 60) return `${verb} ${minutes} min ago`;
  if (minutes < 24 * 60) return `${verb} ${Math.round(minutes / 60)} h ago`;
  return `${verb} ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(at)}`;
}

export default async function BankAccountsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getBankingContext(slug);
  const { locale, timezone } = ctx.profile;
  const [allConnections, duplicates] = await inOrg(ctx, (tx) =>
    Promise.all([listConnections(tx), countOpenDuplicates(tx)]),
  );
  const connections = allConnections.filter((c) => c.status !== "disconnected");
  const admin = isOrgAdmin(ctx);
  // Accounts a statement can be uploaded into, with how each one's statements were read before.
  const saved = new Map<string, StatementSettings>();
  for (const c of allConnections) {
    const settings = c.settings.statement as StatementSettings | undefined;
    if (c.provider === "csv" && settings) {
      for (const f of c.feeds) saved.set(f.accountId, settings);
    }
  }
  const statementAccounts: StatementAccount[] = (await listAccounts(ctx))
    .filter((a) => isMoneyAccountSubtype(a.subtype) && !a.isArchived)
    .map((a) => ({
      id: a.id,
      label: a.code ? `${a.code} · ${a.name}` : a.name,
      currency: a.currency ?? ctx.profile.baseCurrency,
      isCard: a.subtype === "credit_card",
      ...(saved.get(a.id) ? { settings: saved.get(a.id) } : {}),
    }));

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Banking"
        title="Bank accounts"
        description="Connect your bank so transactions arrive on their own. They land on the Transactions screen as uncategorized, ready for you to sort."
        actions={
          connections.length ? (
            <div className="flex flex-wrap gap-2">
              <StatementUploadButton slug={slug} accounts={statementAccounts} locale={locale} />
              {admin ? <ConnectWiseDialog slug={slug} /> : null}
            </div>
          ) : null
        }
      />

      {duplicates ? (
        <Link
          href={`/o/${slug}/accounting/transactions?status=duplicates`}
          className="group fade-in-0 flex animate-in items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4 transition-colors hover:bg-warning/15 sm:px-6"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/20 text-warning">
            <Copy className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">
              {duplicates === 1 ? "1 possible duplicate" : `${duplicates} possible duplicates`}
            </span>
            <span className="block text-muted-foreground text-sm">
              Your bank sent{" "}
              {duplicates === 1 ? "a transaction that looks" : "transactions that look"} like{" "}
              {duplicates === 1 ? "one" : "ones"} already in your books. Check and merge them on the
              Transactions screen.
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
        </Link>
      ) : null}

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
          <div className="fade-in-0 slide-in-from-bottom-2 flex animate-in flex-col gap-4 rounded-2xl border bg-card fill-mode-both p-6 shadow-xs [animation-delay:60ms]">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileUp className="size-5" />
            </span>
            <div className="flex-1">
              <h2 className="font-semibold">Upload a bank statement</h2>
              <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                For any other bank or card: download a CSV from your online banking and upload it
                here. You match its columns once, and each upload after that is one click.
              </p>
            </div>
            <StatementUploadButton
              slug={slug}
              accounts={statementAccounts}
              locale={locale}
              variant="default"
            />
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
                    {c.provider === "csv" ? (
                      <FileUp className="size-5" />
                    ) : (
                      <Landmark className="size-5" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">
                      {c.name}
                      {c.provider === "csv" ? (
                        <span className="font-normal text-muted-foreground"> · Statements</span>
                      ) : null}
                    </h2>
                    <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
                      {c.status === "error" ? (
                        <AlertTriangle className="size-3.5 text-destructive" />
                      ) : (
                        <CircleCheck className="size-3.5 text-success" />
                      )}
                      {syncedLabel(
                        c.lastSyncedAt,
                        locale,
                        timezone,
                        c.provider === "csv" ? "Uploaded" : "Synced",
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {c.provider === "csv" ? (
                    <StatementUploadButton
                      slug={slug}
                      accounts={statementAccounts}
                      accountId={c.feeds[0]?.accountId}
                      locale={locale}
                      label="Upload statement"
                    />
                  ) : null}
                  <ConnectionActions
                    slug={slug}
                    connectionId={c.id}
                    name={c.name}
                    canDisconnect={admin}
                    uploads={c.provider === "csv"}
                  />
                </div>
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
                              {c.provider === "csv"
                                ? "Uploaded statements"
                                : `From ${formatDate(f.syncFrom, locale)}`}
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
