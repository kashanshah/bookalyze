import { can, previousFiscalYear } from "@bookalyze/core";
import { getDb, schema, withOrg } from "@bookalyze/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { nowIn } from "@/lib/dates";
import { referenceOptions } from "@/lib/reference-options";
import { fiscalConfigOf, getOrgContext, isOrgAdmin } from "@/server/org";
import { BooksLock } from "./books-lock";
import { GeneralSettingsForm } from "./general-form";

function lastDayOfPreviousMonth(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}

export const metadata: Metadata = { title: "Company settings" };

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  const profile = ctx.profile;
  const hasEntries = profile
    ? await withOrg(getDb(), { orgId: ctx.org.id, userId: ctx.session.user.id }, async (tx) =>
        Boolean(
          (
            await tx.select({ id: schema.journalEntries.id }).from(schema.journalEntries).limit(1)
          )[0],
        ),
      )
    : false;
  const showBooksLock = Boolean(profile) && can(ctx.plan, ctx.enabledModules, "accounting.core");
  const today = profile ? nowIn(profile.timezone).date : "";
  const lastYear = profile ? previousFiscalYear(today, fiscalConfigOf(profile)) : null;
  const suggestions = lastYear
    ? [
        { label: `End of ${lastYear.label}`, date: lastYear.end },
        { label: "End of last month", date: lastDayOfPreviousMonth(today) },
      ]
    : [];
  return (
    <div className="grid gap-8">
      <PageHeader
        title="Company settings"
        description="Legal details, location, currency and financial year for this company."
      />
      {/* Bottom padding keeps the unsaved-changes bar clear of the last section. */}
      <div className="pb-24">
        <GeneralSettingsForm
          slug={slug}
          name={ctx.org.name}
          profile={ctx.profile ?? {}}
          canEdit={isOrgAdmin(ctx)}
          // Every base amount in the ledger is in the main currency, so it locks once there are entries.
          currencyLocked={hasEntries}
          {...referenceOptions()}
        />
        {showBooksLock && profile ? (
          <BooksLock
            slug={slug}
            lockedThrough={profile.booksLockedThrough}
            suggestions={suggestions}
            locale={profile.locale}
            canEdit={isOrgAdmin(ctx)}
          />
        ) : null}
      </div>
    </div>
  );
}
