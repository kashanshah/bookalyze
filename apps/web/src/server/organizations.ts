import "server-only";
import { DEFAULT_ENABLED_MODULES, MODULE_KEYS } from "@bookalyze/core";
import { createDefaultChart, getDb, schema, withOrg } from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { OrgProfileInput } from "@/lib/validation/org-profile";
import { audit } from "./audit";
import { getAuth } from "./auth";

function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "org"
  );
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const [taken] = await getDb()
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export function profileValues(input: OrgProfileInput) {
  return {
    legalName: input.legalName,
    tradeName: input.tradeName ?? null,
    entityType: input.entityType as (typeof schema.ENTITY_TYPES)[number],
    countryCode: input.countryCode,
    subdivisionCode: input.subdivisionCode ?? null,
    baseCurrency: input.baseCurrency,
    timezone: input.timezone,
    locale: input.locale,
    fiscalYearEndMonth: input.fiscalYearEndMonth,
    fiscalYearEndDay: input.fiscalYearEndDay,
    incorporationDate: input.incorporationDate ?? null,
    firstFiscalYearStart: input.firstFiscalYearStart ?? input.incorporationDate ?? null,
  };
}

/**
 * Creates an organization (Better Auth adds the creator as owner), then its profile and default
 * modules. If the profile can't be saved, the organization is removed again.
 */
export async function createOrganization(userId: string, name: string, input: OrgProfileInput) {
  const auth = getAuth();
  const requestHeaders = await headers();
  const slug = await uniqueSlug(name);
  const org = await auth.api.createOrganization({ body: { name, slug }, headers: requestHeaders });
  if (!org) throw new Error("Could not create the organization");

  try {
    await withOrg(getDb(), { orgId: org.id, userId }, async (tx) => {
      const values = { organizationId: org.id, ...profileValues(input) };
      await tx.insert(schema.organizationProfiles).values(values);
      await tx.insert(schema.organizationModules).values(
        MODULE_KEYS.map((moduleKey) => ({
          organizationId: org.id,
          moduleKey,
          enabled: DEFAULT_ENABLED_MODULES.includes(moduleKey),
          updatedBy: userId,
        })),
      );
      await createDefaultChart(tx, { orgId: org.id, baseCurrency: input.baseCurrency, userId });
      await audit(tx, {
        orgId: org.id,
        actorUserId: userId,
        action: "organization.created",
        entityType: "organization",
        entityId: org.id,
        after: { name, slug, ...values },
      });
    });
  } catch (error) {
    await auth.api.deleteOrganization({
      body: { organizationId: org.id },
      headers: requestHeaders,
    });
    throw error;
  }

  await auth.api.setActiveOrganization({
    body: { organizationId: org.id },
    headers: requestHeaders,
  });
  return { id: org.id, slug };
}
