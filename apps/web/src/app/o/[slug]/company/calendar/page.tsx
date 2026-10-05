import { addDaysIso } from "@bookalyze/core";
import { getEntityDetails, schema } from "@bookalyze/db";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getEntityContext, loadCalendar } from "@/server/compliance";
import { CalendarList } from "./calendar-list";

export const metadata: Metadata = { title: "Compliance calendar" };

export default async function CompliancePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getEntityContext(slug);
  const today = nowIn(ctx.profile.timezone).date;
  const { entries, details, custom } = await inOrg(ctx, async (tx) => ({
    // A quarter back, so anything overdue still shows; a year ahead.
    entries: await loadCalendar(tx, ctx.profile, {
      from: addDaysIso(today, -90),
      to: addDaysIso(today, 365),
    }),
    details: await getEntityDetails(tx),
    custom: await tx.select().from(schema.complianceItems),
  }));
  const missing =
    ctx.profile.countryCode === "CA" &&
    ctx.profile.entityType === "corporation" &&
    (!details.jurisdiction || !ctx.profile.incorporationDate);

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Company"
        title="Compliance calendar"
        description="Filings, payments and renewals coming up, worked out from the company's details. Owners and admins get an email 30 days, 7 days and 1 day before each one."
      />
      {missing ? (
        <Alert>
          Add where and when the company was incorporated on the{" "}
          <Link href={`/o/${slug}/company`} className="font-medium text-primary hover:underline">
            Profile
          </Link>{" "}
          page, so the annual return shows up here too.
        </Alert>
      ) : null}
      <CalendarList
        slug={slug}
        locale={ctx.profile.locale}
        today={today}
        entries={entries}
        custom={custom.map((c) => ({
          id: c.id,
          title: c.title,
          notes: c.notes,
          firstDue: c.firstDue,
          recurrence: c.recurrence,
        }))}
      />
    </div>
  );
}
