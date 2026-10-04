import { can, importSource } from "@bookalyze/core";
import { listImportBatches } from "@bookalyze/db";
import { FileUp, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { isOrgAdmin } from "@/server/org";
import { UndoImportButton } from "./undo-button";

export const metadata: Metadata = { title: "Import" };

export default async function ImportsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale } = ctx.profile;
  const admin = can(ctx.plan, ctx.enabledModules, "accounting.import") && isOrgAdmin(ctx);
  const batches = await inOrg(ctx, (tx) => listImportBatches(tx));

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Accounting"
        title="Import"
        description="Move your history from another accounting program. Each import can be undone as a whole."
        actions={
          admin ? (
            <Button asChild>
              <Link href={`/o/${slug}/accounting/import/new`}>
                <FileUp />
                Import from a file
              </Link>
            </Button>
          ) : null
        }
      />
      {batches.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border bg-card px-6 py-14 text-center shadow-xs">
          <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.06]" />
          <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
            <span className="zoom-in-75 flex size-14 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
              <History className="size-7" />
            </span>
            <div>
              <h2 className="font-semibold text-lg tracking-tight">Bring your books with you</h2>
              <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
                Export your transactions from Wave, QuickBooks, Xero, Zoho Books, Sage or any other
                program as CSV. You'll match the columns and accounts, check everything, then
                import. Nothing is saved until you confirm.
              </p>
            </div>
            {admin ? (
              <Button asChild>
                <Link href={`/o/${slug}/accounting/import/new`}>Start an import</Link>
              </Button>
            ) : (
              <p className="text-muted-foreground text-sm">Ask an owner or admin to import data.</p>
            )}
          </div>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
          {batches.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-sm">
                  {importSource(b.source).label}
                  <span className="truncate font-normal text-muted-foreground">{b.fileName}</span>
                  {b.status === "undone" ? (
                    <Badge variant="outline">Undone</Badge>
                  ) : b.status === "in_progress" ? (
                    <Badge variant="warning">Didn't finish</Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  {b.entryCount.toLocaleString(locale)} transactions
                  {b.firstDate && b.lastDate
                    ? ` from ${formatDate(b.firstDate, locale)} to ${formatDate(b.lastDate, locale)}`
                    : ""}
                  {b.skippedCount
                    ? ` · ${b.skippedCount.toLocaleString(locale)} already there`
                    : ""}
                  {b.accountCount ? ` · ${b.accountCount} new accounts` : ""}
                  {` · ${formatDate(b.createdAt.toISOString().slice(0, 10), locale)}`}
                </p>
              </div>
              {admin && b.status !== "undone" ? (
                <UndoImportButton slug={slug} batchId={b.id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
