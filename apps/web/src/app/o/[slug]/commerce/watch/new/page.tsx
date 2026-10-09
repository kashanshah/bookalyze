import { listAmazonConnections } from "@bookalyze/db";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { WatchForm } from "../watch-form";

export const metadata: Metadata = { title: "Watch a product" };
/** The first look asks Amazon, which can take a few seconds. */
export const maxDuration = 60;

export default async function NewWatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  const channels = await inOrg(ctx, async (tx) => {
    const connections = (await listAmazonConnections(tx)).filter(
      (c) => c.status !== "disconnected",
    );
    return connections.flatMap((c) =>
      c.channels.filter((ch) => ch.isActive).map((ch) => ({ id: ch.id, name: ch.name })),
    );
  });
  if (!channels.length) {
    return (
      <div className="grid gap-6">
        <Link
          href={`/o/${slug}/commerce/watch`}
          className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          Listing watch
        </Link>
        <PageHeader
          title="Watch a product"
          description="Listing watch uses an Amazon marketplace that's already connected."
        />
        <Button asChild className="w-fit">
          <Link href={`/o/${slug}/commerce/channels`}>Go to Channels</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/watch`}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Listing watch
      </Link>
      <PageHeader
        title="Watch a product"
        description="We'll take a first look as soon as you save, then check again on the schedule you pick."
      />
      <WatchForm slug={slug} channels={channels} defaultEmail={ctx.session.user.email} />
    </div>
  );
}
