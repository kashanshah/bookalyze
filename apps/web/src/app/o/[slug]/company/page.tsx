import { identifierKindsFor } from "@bookalyze/core";
import { getEntityDetails, listIdentifiers, listPeople } from "@bookalyze/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { ENTITY_TYPE_OPTIONS } from "@/lib/validation/org-profile";
import { inOrg } from "@/server/accounting";
import { getEntityContext } from "@/server/compliance";
import { isOrgAdmin } from "@/server/org";
import { ProfileScreen } from "./profile";

export const metadata: Metadata = { title: "Company profile" };

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getEntityContext(slug);
  const { profile } = ctx;
  const { details, identifiers, people } = await inOrg(ctx, async (tx) => ({
    details: await getEntityDetails(tx),
    identifiers: await listIdentifiers(tx),
    people: await listPeople(tx),
  }));
  const fiscalYearEnd = new Intl.DateTimeFormat(profile.locale, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2001, profile.fiscalYearEndMonth - 1, profile.fiscalYearEndDay)));

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Company"
        title="Profile"
        description="The company's legal details, registration numbers and the people behind it, all in one place."
      />
      <ProfileScreen
        view={{
          slug,
          locale: profile.locale,
          canEditDetails: isOrgAdmin(ctx),
          country: profile.countryCode,
          legalName: profile.legalName,
          tradeName: profile.tradeName,
          entityTypeLabel:
            ENTITY_TYPE_OPTIONS.find((o) => o.value === profile.entityType)?.label ??
            profile.entityType,
          fiscalYearEnd,
          incorporationDate: profile.incorporationDate,
          jurisdiction: details.jurisdiction,
          registeredAddress: details.registeredAddress,
          identifierKinds: identifierKindsFor(profile.countryCode),
          identifiers: identifiers.map((i) => ({
            id: i.id,
            kind: i.kind,
            label: i.label,
            value: i.value,
            expiresOn: i.expiresOn,
            notes: i.notes,
          })),
          people: people.map((p) => ({
            id: p.id,
            name: p.name,
            roles: p.roles,
            title: p.title,
            ownershipPercent: p.ownershipPercent,
            email: p.email,
            startDate: p.startDate,
            endDate: p.endDate,
            notes: p.notes,
          })),
        }}
      />
    </div>
  );
}
