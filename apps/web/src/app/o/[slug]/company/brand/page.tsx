import { getBranding } from "@bookalyze/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { inOrg } from "@/server/accounting";
import { getEntityContext } from "@/server/compliance";
import { isOrgAdmin } from "@/server/org";
import { BrandScreen } from "./brand";

export const metadata: Metadata = { title: "Brand" };

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getEntityContext(slug);
  const brand = await inOrg(ctx, (tx) => getBranding(tx));
  const file = (asset: typeof brand.logo) =>
    asset
      ? {
          id: asset.id,
          fileName: asset.fileName,
          contentType: asset.contentType,
          url: `/api/o/${slug}/attachments/${asset.id}`,
        }
      : null;

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Company"
        title="Brand"
        description="How your invoices and other documents look: your logo or letterhead, colour, Arabic name and footer."
      />
      <BrandScreen
        view={{
          slug,
          canEdit: isOrgAdmin(ctx),
          legalName: ctx.profile.legalName,
          accentColor: brand.accentColor,
          footer: brand.footer,
          nameArabic: brand.nameArabic,
          logo: file(brand.logo),
          logoHeight: brand.logoHeight,
          letterhead: file(brand.letterhead),
          letterheadTop: brand.letterheadTop,
          letterheadBottom: brand.letterheadBottom,
          letterheadPages: brand.letterheadPages,
        }}
      />
    </div>
  );
}
