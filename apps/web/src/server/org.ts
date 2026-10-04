import "server-only";
import {
  activeModules,
  type FiscalYearConfig,
  getPlan,
  isModuleKey,
  type ModuleKey,
  type Plan,
} from "@bookalyze/core";
import { getDb, schema, withOrg } from "@bookalyze/db";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireSession } from "./session";

export type OrgRole = "owner" | "admin" | "member";

export type OrgProfile = typeof schema.organizationProfiles.$inferSelect;

export type OrgContext = {
  session: Awaited<ReturnType<typeof requireSession>>;
  org: { id: string; name: string; slug: string };
  role: OrgRole;
  profile: OrgProfile | null;
  plan: Plan;
  enabledModules: ModuleKey[];
  activeModules: ModuleKey[];
};

export async function listUserOrgs(userId: string) {
  return getDb()
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.organization.name));
}

/**
 * Resolves the organization in the URL for the signed-in user. 404s unless the user is a
 * member, so one organization's slug can never be used to reach another's data.
 */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const session = await requireSession(`/o/${slug}`);
  const [row] = await getDb()
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      role: schema.member.role,
    })
    .from(schema.organization)
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.organizationId, schema.organization.id),
        eq(schema.member.userId, session.user.id),
      ),
    )
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  if (!row) notFound();

  const { profile, modules } = await withOrg(
    getDb(),
    { orgId: row.id, userId: session.user.id },
    async (tx) => ({
      profile: (await tx.select().from(schema.organizationProfiles).limit(1))[0] ?? null,
      modules: await tx.select().from(schema.organizationModules),
    }),
  );

  const enabledModules = modules
    .filter((m) => m.enabled && isModuleKey(m.moduleKey))
    .map((m) => m.moduleKey as ModuleKey);
  const plan = getPlan(profile?.planKey);
  return {
    session,
    org: { id: row.id, name: row.name, slug: row.slug },
    role: row.role as OrgRole,
    profile,
    plan,
    enabledModules,
    activeModules: activeModules(plan, enabledModules),
  };
});

export function isOrgAdmin(ctx: Pick<OrgContext, "role">): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

export function fiscalConfigOf(profile: OrgProfile): FiscalYearConfig {
  return {
    endMonth: profile.fiscalYearEndMonth,
    endDay: profile.fiscalYearEndDay,
    firstFiscalYearStart: profile.firstFiscalYearStart,
  };
}
