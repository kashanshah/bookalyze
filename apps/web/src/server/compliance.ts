import "server-only";
import {
  addDaysIso,
  COMPLIANCE_LEAD_DAYS,
  type ComplianceItem,
  can,
  complianceCalendar,
  daysBetween,
  isModuleKey,
  occurrenceKey,
  reminderDue,
} from "@bookalyze/core";
import {
  completedOccurrences,
  complianceInput,
  getDb,
  recordReminder,
  schema,
  sentReminders,
  type Transaction,
  withOrg,
} from "@bookalyze/db";
import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ComplianceReminder } from "@/emails/compliance-reminder";
import { formatDate, nowIn } from "@/lib/dates";
import { sendEmail } from "./email";
import { env } from "./env";
import { logError } from "./log";
import { getOrgContext, type OrgContext, type OrgProfile } from "./org";

export type EntityContext = OrgContext & { profile: OrgProfile };

/** The context for Company pages and actions: the Entity & compliance module must be on. */
export async function getEntityContext(slug: string): Promise<EntityContext> {
  const ctx = await getOrgContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "entity.profile") || !ctx.profile) notFound();
  return ctx as EntityContext;
}

/** A calendar item with whether it was ticked as done. */
export type CalendarEntry = ComplianceItem & { occurrence: string; done: boolean };

/** The company's compliance calendar from `from` to `to`, done items included. */
export async function loadCalendar(
  tx: Transaction,
  profile: OrgProfile,
  range: { from: string; to: string },
): Promise<CalendarEntry[]> {
  const input = await complianceInput(tx, {
    country: profile.countryCode,
    entityType: profile.entityType,
    incorporationDate: profile.incorporationDate,
    fiscal: {
      endMonth: profile.fiscalYearEndMonth,
      endDay: profile.fiscalYearEndDay,
      firstFiscalYearStart: profile.firstFiscalYearStart,
    },
  });
  const done = await completedOccurrences(tx);
  return complianceCalendar(input, range.from, range.to).map((item) => ({
    ...item,
    occurrence: occurrenceKey(item),
    done: done.has(occurrenceKey(item)),
  }));
}

/** "today", "tomorrow", "in 7 days". */
export function dueIn(today: string, dueDate: string): string {
  const days = daysBetween(today, dueDate);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * The daily reminder run: for every company with Entity & compliance on, emails its owners and
 * admins one digest of what's due in 30, 7 and 1 days, and today. Each lead time goes out once
 * per item (a missed run sends the latest one); items ticked done are skipped.
 */
export async function sendComplianceReminders(): Promise<{
  companies: number;
  emails: number;
  failed: number;
}> {
  const db = getDb();
  const orgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
    })
    .from(schema.organization);
  let companies = 0;
  let emails = 0;
  let failed = 0;
  for (const org of orgs) {
    try {
      const due = await withOrg(db, { orgId: org.id, userId: null }, async (tx) => {
        const [profile] = await tx.select().from(schema.organizationProfiles).limit(1);
        const modules = await tx.select().from(schema.organizationModules);
        const enabled = modules
          .filter((m) => m.enabled && isModuleKey(m.moduleKey))
          .map((m) => m.moduleKey);
        if (!profile || !enabled.includes("entity")) return null;
        const today = nowIn(profile.timezone).date;
        const items = (
          await loadCalendar(tx, profile, {
            from: today,
            to: addDaysIso(today, Math.max(...COMPLIANCE_LEAD_DAYS)),
          })
        ).filter((i) => !i.done);
        const sent = await sentReminders(
          tx,
          items.map((i) => i.key),
        );
        const picked = items.flatMap((item) => {
          const lead = reminderDue(
            item.dueDate,
            today,
            COMPLIANCE_LEAD_DAYS,
            sent.get(item.occurrence) ?? new Set(),
          );
          return lead === null ? [] : [{ item, lead }];
        });
        return picked.length ? { profile, today, picked } : null;
      });
      if (!due) continue;
      companies++;
      const recipients = await db
        .select({ email: schema.user.email })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(
          and(
            eq(schema.member.organizationId, org.id),
            inArray(schema.member.role, ["owner", "admin"]),
          ),
        );
      const props = {
        organizationName: org.name,
        url: `${env().BETTER_AUTH_URL}/o/${org.slug}/company/calendar`,
        items: due.picked.map(({ item }) => ({
          title: item.title,
          due: formatDate(item.dueDate, due.profile.locale, "long"),
          when: dueIn(due.today, item.dueDate),
          ...(item.hint ? { hint: item.hint } : {}),
        })),
      };
      const subject =
        due.picked.length === 1
          ? `${due.picked[0]?.item.title}: due ${props.items[0]?.when}`
          : `${due.picked.length} deadlines coming up for ${org.name}`;
      for (const { email } of recipients) {
        await sendEmail({ to: email, subject, react: ComplianceReminder(props) });
        emails++;
      }
      // Recorded after sending, so a failed send is retried on the next run.
      await withOrg(db, { orgId: org.id, userId: null }, async (tx) => {
        for (const { item, lead } of due.picked) {
          await recordReminder(tx, {
            orgId: org.id,
            itemKey: item.key,
            dueDate: item.dueDate,
            leadDays: lead,
          });
        }
      });
    } catch (error) {
      // One company's failure mustn't stop the others' reminders; it's retried on the next run.
      failed++;
      logError("compliance.reminders_failed", error, { orgId: org.id });
    }
  }
  return { companies, emails, failed };
}
