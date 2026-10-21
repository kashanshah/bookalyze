import {
  AMAZON_REGIONS,
  CONNECTION_AREA,
  defaultAmazonRegion,
  defaultEbayMarketplace,
  defaultNoonMarketplace,
  defaultWalmartMarketplace,
  type FulfilmentMode,
  isFulfilmentMode,
} from "@bookalyze/core";
import {
  getEbayConnection,
  getNoonConnection,
  getWalmartConnection,
  listAmazonConnections,
  listEbayChannels,
  listNoonChannels,
  listWalmartChannels,
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

/** Who ships a Walmart country's orders, short enough for a list row. */
const WALMART_SHIPPING: Record<FulfilmentMode, string> = {
  marketplace: "Walmart ships (WFS)",
  seller: "You ship",
  both: "Walmart and you ship",
};

export default async function ChannelsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Connection screens: a connection action re-renders this page in its own request, so it
  // passes the same area (Review requests only may use it).
  const ctx = await getCommerceContext(slug, CONNECTION_AREA);
  const { connections, ebay, noon, walmart, noonConnection, ebayConnection } = await inOrg(
    ctx,
    async (tx) => ({
      // Each Walmart country is its own seller account, with its own connection.
      walmart: await Promise.all(
        (await listWalmartChannels(tx)).map(async (ch) => ({
          ...ch,
          connection: await getWalmartConnection(tx, ch.marketplaceId ?? ""),
        })),
      ),
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
    ...walmart.map((ch) => ({
      id: ch.id,
      platform: "walmart" as const,
      name: ch.name,
      country: ch.country,
      currency: ch.currency,
      isActive: ch.isActive,
      shipping:
        ch.fulfilment && isFulfilmentMode(ch.fulfilment) ? WALMART_SHIPPING[ch.fulfilment] : null,
      account:
        ch.connection && ch.connection.status !== "disconnected"
          ? ch.connection.status === "error"
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
        description="Where the company sells: Amazon marketplaces, eBay sites, and Noon and Walmart countries. Each channel has its own page for its settings and its account."
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
          walmart: defaultWalmartMarketplace(ctx.profile.countryCode).id,
        }}
        existing={{ ebay: existing(ebay), noon: existing(noon), walmart: existing(walmart) }}
      />
    </div>
  );
}
