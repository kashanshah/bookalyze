import { can } from "@bookalyze/core";
import { channelCostCategories, schema } from "@bookalyze/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { CostsForm } from "./costs-form";

export const metadata: Metadata = { title: "Your own costs" };

const PLATFORMS: Record<string, string> = {
  amazon: "Amazon",
  noon: "Noon",
  ebay: "eBay",
  walmart: "Walmart",
};

export default async function ChannelCostsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { categories, channels } = await inOrg(ctx, async (tx) => ({
    categories: await channelCostCategories(tx),
    channels: await tx
      .select({
        id: schema.salesChannels.id,
        name: schema.salesChannels.name,
        kind: schema.salesChannels.kind,
        isActive: schema.salesChannels.isActive,
      })
      .from(schema.salesChannels)
      .orderBy(schema.salesChannels.kind, schema.salesChannels.name),
  }));

  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/profit`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Channel profit
      </Link>
      <PageHeader
        eyebrow="Commerce"
        title="Your own costs"
        description="Expense categories from your books that belong to selling: a channel's subscription, packaging for eBay orders, a shared warehouse. Choose the channel each one counts against, or Shared to show it under All channels only. Channel profit takes them off that channel's net."
      />
      <CostsForm
        slug={slug}
        categories={categories.map((c) => ({
          accountId: c.accountId,
          label: c.label,
          channel: c.channelId === undefined ? "" : (c.channelId ?? "shared"),
        }))}
        channels={channels.map((c) => ({
          value: c.id,
          label: c.isActive ? c.name : `${c.name} (switched off)`,
          group: PLATFORMS[c.kind] ?? "Other channels",
        }))}
        canManage={isOrgAdmin(ctx)}
      />
    </div>
  );
}
