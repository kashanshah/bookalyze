import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { referenceOptions } from "@/lib/reference-options";
import { getOrgContext, isOrgAdmin } from "@/server/org";
import { GeneralSettingsForm } from "./general-form";

export const metadata: Metadata = { title: "Company settings" };

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Company settings"
        description="Legal details, location, currency and financial year for this company."
      />
      <GeneralSettingsForm
        slug={slug}
        name={ctx.org.name}
        profile={ctx.profile ?? {}}
        canEdit={isOrgAdmin(ctx)}
        // The main currency locks once the ledger has transactions (phase 1).
        currencyLocked={false}
        {...referenceOptions()}
      />
    </div>
  );
}
