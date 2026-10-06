import { getReviewSettings, listAmazonConnections, soldSkus } from "@bookalyze/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getReviewsContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { ReviewSettingsForm } from "./review-settings";

export const metadata: Metadata = { title: "Automatic review requests" };
/** Saving plans the requests straight away. */
export const maxDuration = 60;

export default async function AutomaticReviewsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getReviewsContext(slug);
  const { locale, timezone } = ctx.profile;
  const data = await inOrg(ctx, async (tx) => ({
    settings: await getReviewSettings(tx),
    channels: (await listAmazonConnections(tx))
      .filter((c) => c.status !== "disconnected")
      .flatMap((c) => c.channels.filter((ch) => ch.isActive))
      .map((c) => ({ id: c.id, name: c.name })),
    skus: await soldSkus(tx),
  }));

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <Link
          href={`/o/${slug}/reviews`}
          className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          Review requests
        </Link>
        <PageHeader
          title="Automatic review requests"
          description="Every eligible order gets Amazon's “Request a Review” at the time you choose, once. Change anything and the orders not asked yet are planned again."
        />
      </div>
      <ReviewSettingsForm
        slug={slug}
        initial={data.settings}
        channels={data.channels}
        skus={data.skus}
        locale={locale}
        timezone={timezone}
        today={nowIn(timezone).date}
        canManage={isOrgAdmin(ctx)}
      />
    </div>
  );
}
