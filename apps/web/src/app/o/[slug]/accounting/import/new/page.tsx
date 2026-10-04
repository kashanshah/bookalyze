import { can } from "@bookalyze/core";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { getAccountingContext, listAccounts } from "@/server/accounting";
import { isOrgAdmin } from "@/server/org";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import your books" };

export default async function NewImportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const allowed = can(ctx.plan, ctx.enabledModules, "accounting.import") && isOrgAdmin(ctx);
  const accounts = allowed ? await listAccounts(ctx) : [];
  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/accounting/import`}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Imports
      </Link>
      <PageHeader
        title="Import your books"
        description="Bring your history over from Wave, QuickBooks, Xero or any program that exports transactions as CSV."
      />
      {allowed ? (
        <ImportWizard
          slug={slug}
          baseCurrency={ctx.profile.baseCurrency}
          locale={ctx.profile.locale}
          lockedThrough={ctx.profile.booksLockedThrough}
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            code: a.code,
            subtype: a.subtype,
            isArchived: a.isArchived,
          }))}
        />
      ) : (
        <Alert>Only owners and admins can import data.</Alert>
      )}
    </div>
  );
}
