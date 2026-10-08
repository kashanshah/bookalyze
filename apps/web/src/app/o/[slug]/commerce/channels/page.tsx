import { defaultAmazonRegion, defaultNoonMarketplace, isFulfilmentMode } from "@bookalyze/core";
import { listAmazonConnections, listNoonChannels } from "@bookalyze/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { ChannelsScreen } from "./channels";
import { NoonChannels } from "./noon";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  const { connections, noon } = await inOrg(ctx, async (tx) => ({
    connections: await listAmazonConnections(tx),
    noon: await listNoonChannels(tx),
  }));
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Commerce"
        title="Channels"
        description="Where the company sells. Connect Amazon Seller Central and pick the marketplaces to bring orders in from, and add the countries you sell in on Noon."
      />
      <ChannelsScreen
        slug={slug}
        locale={ctx.profile.locale}
        canManage={isOrgAdmin(ctx)}
        defaultRegion={defaultAmazonRegion(ctx.profile.countryCode)}
        connections={connections.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          region: String(c.settings.region ?? ""),
          storeName: typeof c.settings.storeName === "string" ? c.settings.storeName : null,
          lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
          lastError: c.lastError,
          channels: c.channels.map((ch) => ({
            id: ch.id,
            name: ch.name,
            country: ch.country,
            currency: ch.currency,
            isActive: ch.isActive,
          })),
        }))}
      />
      <NoonChannels
        slug={slug}
        canManage={isOrgAdmin(ctx)}
        defaultMarketplace={defaultNoonMarketplace(ctx.profile.countryCode).id}
        channels={noon.map((ch) => ({
          id: ch.id,
          name: ch.name,
          marketplaceId: ch.marketplaceId ?? "",
          country: ch.country,
          currency: ch.currency,
          fulfilment: ch.fulfilment && isFulfilmentMode(ch.fulfilment) ? ch.fulfilment : null,
          isActive: ch.isActive,
        }))}
      />
    </div>
  );
}
