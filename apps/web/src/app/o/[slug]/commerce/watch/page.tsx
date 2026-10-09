import {
  amazonProductUrl,
  LISTING_CADENCES,
  type ListingCheck,
  type ListingObservation,
  listingCheck,
  listingValues,
} from "@bookalyze/core";
import { listAmazonConnections, listListingWatches } from "@bookalyze/db";
import { Binoculars, ExternalLink, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAgo } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { ProductImage } from "./product-image";

export const metadata: Metadata = { title: "Listing watch" };

export default async function ListingWatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getCommerceContext(slug);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const { channels, watches } = await inOrg(ctx, async (tx) => {
    const connections = (await listAmazonConnections(tx)).filter(
      (c) => c.status !== "disconnected",
    );
    return {
      channels: connections.flatMap((c) => c.channels.filter((ch) => ch.isActive)),
      watches: await listListingWatches(tx, q || null),
    };
  });
  const base = `/o/${slug}/commerce/watch`;
  const now = new Date();
  const { locale } = ctx.profile;

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Commerce"
        title="Listing watch"
        description="Pick the products you care about. We check Amazon and email you when the price, photos, words, or sales rank change."
        actions={
          channels.length ? (
            <Button asChild>
              <Link href={`${base}/new`}>
                <Plus />
                Watch a product
              </Link>
            </Button>
          ) : null
        }
      />

      {!channels.length ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Binoculars className="size-6" />
          </span>
          <p className="font-medium">Connect Amazon first</p>
          <p className="max-w-sm text-muted-foreground text-sm">
            Listing watch uses the Amazon account already connected in Channels.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/o/${slug}/commerce/channels`}>Go to Channels</Link>
          </Button>
        </div>
      ) : (
        <>
          <Form action={base} className="relative max-w-md">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search by name or ASIN"
              aria-label="Search watched products"
              className="h-9 ps-9"
            />
          </Form>
          {watches.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Binoculars className="size-6" />
              </span>
              <p className="font-medium">
                {q ? "No products match" : "Nothing is being watched yet"}
              </p>
              <p className="max-w-sm text-muted-foreground text-sm">
                {q
                  ? "Try another name or ASIN."
                  : "Add a product by its ASIN. The first look becomes the baseline, and later checks tell you what changed."}
              </p>
              {!q ? (
                <Button asChild>
                  <Link href={`${base}/new`}>
                    <Plus />
                    Watch a product
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
              {watches.map((watch) => {
                const cadence = LISTING_CADENCES.find((c) => c.key === watch.cadence)?.label;
                const observed = watch.observed as ListingObservation | null;
                const values = observed ? listingValues(observed, locale, { content: true }) : [];
                const watching = (watch.checks as ListingCheck[]).flatMap((key) => {
                  const label = listingCheck(key)?.label;
                  return label ? [label] : [];
                });
                const productUrl = amazonProductUrl(watch.channelName, watch.asin);
                return (
                  <li key={watch.id} className="relative">
                    <Link
                      href={`${base}/${watch.id}`}
                      className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-3 py-3.5 ps-4 pe-12 transition-colors hover:bg-muted/40 sm:ps-5 sm:pe-14"
                    >
                      <ProductImage src={watch.imageUrl} alt="" className="size-14" />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-sm">
                            {watch.title || watch.asin}
                          </span>
                          {watch.paused ? <Badge variant="secondary">Paused</Badge> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-muted-foreground text-xs">
                          <span className="tabular">{watch.asin}</span>
                          {` · ${watch.channelName}`}
                          {cadence ? ` · ${cadence}` : ""}
                          {watch.notify && watch.notifyEmails.length ? "" : " · Email off"}
                        </span>
                        <span className="mt-1 block truncate text-xs">
                          {watch.lastChangeSummary ? (
                            <span>
                              {watch.lastChangeSummary}{" "}
                              {watch.lastChangeAt ? (
                                <span className="text-muted-foreground">
                                  {formatAgo(watch.lastChangeAt, now, locale)}
                                </span>
                              ) : null}
                            </span>
                          ) : watch.lastError ? (
                            <span className="text-destructive">{watch.lastError}</span>
                          ) : watch.lastCheckedAt ? (
                            <span className="text-muted-foreground">
                              No changes · checked {formatAgo(watch.lastCheckedAt, now, locale)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Not checked yet</span>
                          )}
                        </span>
                        {values.length ? (
                          <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                            {values.map((fact) => (
                              <span key={`${fact.label}-${fact.value}`} className="text-xs">
                                <span className="text-muted-foreground">{fact.label}</span>{" "}
                                <span className="font-medium">{fact.value}</span>
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="mt-1 block truncate text-muted-foreground text-xs">
                            {watching.join(" · ")}
                          </span>
                        )}
                      </span>
                    </Link>
                    {productUrl ? (
                      <a
                        href={productUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open on ${watch.channelName}`}
                        title={`Open on ${watch.channelName}`}
                        className="absolute end-2 top-2 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:end-3 sm:top-3"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
