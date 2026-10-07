import type { ListingCadence, ListingCheck } from "@bookalyze/core";
import { LISTING_CHECK_KEYS } from "@bookalyze/core";
import { getListingWatch, listAmazonConnections } from "@bookalyze/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { WatchForm } from "../../watch-form";

export const metadata: Metadata = { title: "Edit watch" };
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditWatchPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getCommerceContext(slug);
  const data = await inOrg(ctx, async (tx) => {
    const watch = await getListingWatch(tx, id);
    const connections = (await listAmazonConnections(tx)).filter(
      (c) => c.status !== "disconnected",
    );
    return {
      watch,
      channels: connections.flatMap((c) =>
        c.channels.filter((ch) => ch.isActive).map((ch) => ({ id: ch.id, name: ch.name })),
      ),
    };
  });
  if (!data.watch) notFound();
  const channels = data.channels.some((channel) => channel.id === data.watch?.channelId)
    ? data.channels
    : [{ id: data.watch.channelId, name: data.watch.channelName }, ...data.channels];
  const checks = data.watch.checks.filter((key): key is ListingCheck =>
    (LISTING_CHECK_KEYS as readonly string[]).includes(key),
  );
  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/watch/${id}`}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {data.watch.title || data.watch.asin}
      </Link>
      <PageHeader
        title="Change this watch"
        description="What we compare, how often, and whether owners and admins get an email."
      />
      <WatchForm
        slug={slug}
        channels={channels}
        initial={{
          id,
          channelId: data.watch.channelId,
          asin: data.watch.asin,
          checks,
          cadence: data.watch.cadence as ListingCadence,
          notify: data.watch.notify,
        }}
      />
    </div>
  );
}
