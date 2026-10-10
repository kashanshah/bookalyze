import {
  AMAZON_REGIONS,
  defaultAmazonRegion,
  defaultEbayMarketplace,
  defaultNoonMarketplace,
  type FulfilmentMode,
  isFulfilmentMode,
} from "@bookalyze/core";
import {
  getEbayConnection,
  getNoonConnection,
  listAmazonConnections,
  listEbayChannels,
  listNoonChannels,
} from "@bookalyze/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { ChannelList, type ChannelRowView } from "./channel-list";

export const metadata: Metadata = { title: "Channels" };

/** Who ships a Noon country's orders, short enough for a list row. */
const NOON_SHIPPING: Record<FulfilmentMode, string> = {
  marketplace: "Noon ships (FBN)",
  seller: "You ship (FBP)",
  both: "Noon and you ship",
};

export default async function ChannelsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  const { connections, ebay, noon, noonConnection, ebayConnection } = await inOrg(
    ctx,
    async (tx) => ({
      ebayConnection: await getEbayConnection(tx),
      connections: await listAmazonConnections(tx),
      ebay: await listEbayChannels(tx),
      noon: await listNoonChannels(tx),
      noonConnection: await getNoonConnection(tx),
    }),
  );
  const ebayLive =
    ebayConnection && ebayConnection.status !== "disconnected" ? ebayConnection : null;
  const noonLive =
    noonConnection && noonConnection.status !== "disconnected" ? noonConnection : null;
  const rows: ChannelRowView[] = [
    // A disconnected Amazon account's marketplaces are hidden with its orders.
    ...connections
      .filter((c) => c.status !== "disconnected")
      .flatMap((c) =>
        c.channels.map((ch) => ({
          id: ch.id,
          platform: "amazon" as const,
          name: ch.name,
          country: ch.country,
          currency: ch.currency,
          isActive: ch.isActive,
          shipping: null,
          account: c.status === "error" ? ("attention" as const) : ("connected" as const),
        })),
      ),
    ...ebay.map((ch) => ({
      id: ch.id,
      platform: "ebay" as const,
      name: ch.name,
      country: ch.country,
      currency: ch.currency,
      isActive: ch.isActive,
      shipping: "You ship",
      account: ebayLive
        ? ebayLive.status === "error"
          ? ("attention" as const)
          : ("connected" as const)
        : ("none" as const),
    })),
    ...noon.map((ch) => ({
      id: ch.id,
      platform: "noon" as const,
      name: ch.name,
      country: ch.country,
      currency: ch.currency,
      isActive: ch.isActive,
      shipping:
        ch.fulfilment && isFulfilmentMode(ch.fulfilment) ? NOON_SHIPPING[ch.fulfilment] : null,
      account: noonLive
        ? noonLive.status === "error"
          ? ("attention" as const)
          : ("connected" as const)
        : ("none" as const),
    })),
  ];
  const existing = (list: typeof ebay) =>
    list.map((ch) => ({ marketplaceId: ch.marketplaceId ?? "", isActive: ch.isActive }));
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Commerce"
        title="Channels"
        description="Where the company sells: Amazon marketplaces, eBay sites and Noon countries. Each channel has its own page for its settings and its account."
      />
      <ChannelList
        slug={slug}
        canManage={isOrgAdmin(ctx)}
        rows={rows}
        defaults={{
          // The company's own region first; once connected, the next region not connected yet.
          amazonRegion:
            [
              defaultAmazonRegion(ctx.profile.countryCode),
              ...AMAZON_REGIONS.map((r) => r.key),
            ].find(
              (r) =>
                !connections.some((c) => c.status !== "disconnected" && c.settings.region === r),
            ) ?? defaultAmazonRegion(ctx.profile.countryCode),
          ebay: defaultEbayMarketplace(ctx.profile.countryCode).id,
          noon: defaultNoonMarketplace(ctx.profile.countryCode).id,
        }}
        existing={{ ebay: existing(ebay), noon: existing(noon) }}
      />
    </div>
  );
}
