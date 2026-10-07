import {
  amazonProductUrl,
  formatMoney,
  LISTING_CADENCES,
  type ListingCheck,
  type ListingObservation,
  listingCheck,
} from "@bookalyze/core";
import { getListingWatch, listListingChanges } from "@bookalyze/db";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAgo } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { ProductImage } from "../product-image";
import { CheckNowButton, PauseWatchButton, StopWatchButton } from "../watch-controls";

export const metadata: Metadata = { title: "Watched product" };
/** "Check now" asks Amazon from this page. */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WatchPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getCommerceContext(slug);
  const found = await inOrg(ctx, async (tx) => {
    const watch = await getListingWatch(tx, id);
    if (!watch) return null;
    return { watch, changes: await listListingChanges(tx, id) };
  });
  if (!found) notFound();
  const { watch, changes } = found;
  const observed = watch.observed as ListingObservation | null;
  const { locale, timezone } = ctx.profile;
  const now = new Date();
  const moment = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  const cadence = LISTING_CADENCES.find((c) => c.key === watch.cadence);
  const checks = (watch.checks as ListingCheck[]).flatMap((key) => {
    const label = listingCheck(key)?.label;
    return label ? [label] : [];
  });
  const productUrl = amazonProductUrl(watch.channelName, watch.asin);
  const base = `/o/${slug}/commerce/watch`;
  const price =
    observed?.price && observed.currency
      ? formatMoney(observed.price, observed.currency, locale)
      : null;

  return (
    <div className="grid gap-6">
      <Link
        href={base}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Listing watch
      </Link>
      <PageHeader
        title={watch.title || watch.asin}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{watch.asin}</span>
            <span>· {watch.channelName}</span>
            {watch.paused ? <Badge variant="secondary">Paused</Badge> : null}
            {cadence ? <Badge variant="outline">{cadence.label}</Badge> : null}
            <Badge variant="outline">{watch.notify ? "Email on" : "Email off"}</Badge>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <CheckNowButton slug={slug} id={watch.id} />
            <Button asChild variant="outline">
              <Link href={`${base}/${watch.id}/edit`}>
                <Pencil />
                Edit
              </Link>
            </Button>
            <PauseWatchButton slug={slug} id={watch.id} paused={watch.paused} />
            <StopWatchButton slug={slug} id={watch.id} name={watch.title || watch.asin} />
          </div>
        }
      />

      {watch.lastError ? <Alert variant="destructive">{watch.lastError}</Alert> : null}
      {watch.paused ? (
        <Alert>Checks are paused. Resume them when you want Amazon looked at again.</Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
            <h2 className="font-medium text-sm">Latest look</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              {watch.lastCheckedAt
                ? `Last checked ${formatAgo(watch.lastCheckedAt, now, locale)}`
                : "Not checked yet"}
              {watch.paused ? "" : ` · Next check ${formatAgo(watch.nextCheckAt, now, locale)}`}
            </p>
            {observed ? (
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs">Price</dt>
                  <dd className="tabular mt-0.5 font-medium">{price ?? "Not listed"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Featured offer</dt>
                  <dd className="mt-0.5">
                    {observed.featured
                      ? observed.featured.prime
                        ? "Listed · Prime"
                        : "Listed"
                      : "None right now"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Other sellers</dt>
                  <dd className="mt-0.5">
                    {observed.offerCount === null
                      ? "Not reported"
                      : observed.offerCount === 1
                        ? "1 seller"
                        : `${observed.offerCount} sellers`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Watching</dt>
                  <dd className="mt-0.5 text-sm">{checks.join(", ")}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-muted-foreground text-sm">
                The first look hasn't come back yet. Use Check now, or wait for the next scheduled
                check.
              </p>
            )}
            {observed?.ranks.length ? (
              <div className="mt-5 border-t pt-4">
                <h3 className="text-muted-foreground text-xs">Best seller rank</h3>
                <ul className="mt-2 grid gap-1 text-sm">
                  {observed.ranks.map((rank) => (
                    <li key={rank.category} className="flex justify-between gap-4">
                      <span className="min-w-0 truncate">{rank.category}</span>
                      <span className="tabular">
                        {new Intl.NumberFormat(locale).format(rank.rank)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {productUrl ? (
              <a
                href={productUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-primary text-sm underline-offset-4 hover:underline"
              >
                <ExternalLink className="size-4" />
                View on {watch.channelName}
              </a>
            ) : null}
          </section>

          {observed?.images.length ? (
            <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
              <h2 className="font-medium text-sm">Photos</h2>
              <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {observed.images.map((image) => (
                  <li key={image.variant} className="shrink-0">
                    <ProductImage
                      src={image.url}
                      alt={image.variant === "MAIN" ? "Main photo" : "Photo"}
                      className="size-24"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {observed?.title || observed?.bullets.length || observed?.description ? (
            <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
              <h2 className="font-medium text-sm">Words on the page</h2>
              {observed.title ? <p className="mt-3 font-medium">{observed.title}</p> : null}
              {observed.bullets.length ? (
                <ul className="mt-3 list-disc space-y-1 ps-5 text-sm">
                  {observed.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
              {observed.description ? (
                <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
                  {observed.description}
                </p>
              ) : null}
            </section>
          ) : null}

          {(watch.checks as string[]).includes("reviews") ? (
            <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
              <h2 className="font-medium text-sm">Review topics</h2>
              {observed?.reviewNote ? (
                <p className="mt-2 text-muted-foreground text-sm">{observed.reviewNote}</p>
              ) : observed?.reviewTopics.length ? (
                <ul className="mt-3 grid gap-2">
                  {observed.reviewTopics.map((topic) => (
                    <li
                      key={`${topic.sentiment}-${topic.topic}`}
                      className="flex items-baseline justify-between gap-4 text-sm"
                    >
                      <span>
                        {topic.topic}
                        <span className="ms-2 text-muted-foreground text-xs">
                          {topic.sentiment === "negative" ? "Complaint" : "Praise"}
                        </span>
                      </span>
                      {topic.share ? (
                        <span className="tabular text-muted-foreground text-xs">
                          {topic.share}%
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground text-sm">
                  No topics yet. Amazon only shares these for a brand you own.
                </p>
              )}
            </section>
          ) : null}
        </div>

        <section className="h-fit rounded-2xl border bg-card p-5 shadow-xs">
          <h2 className="font-medium text-sm">What changed</h2>
          {changes.length === 0 ? (
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
              Nothing yet. The first look is the baseline. Later checks show up here, and in email
              when that's on.
            </p>
          ) : (
            <ol className="mt-4 grid gap-4">
              {changes.map((change) => (
                <li key={change.id} className="border-primary/30 border-s-2 ps-3">
                  <p className="text-sm">{change.summary}</p>
                  {change.before && change.after ? (
                    <p className="mt-1 text-muted-foreground text-xs">Was: {change.before}</p>
                  ) : null}
                  <p className="mt-1 text-muted-foreground text-xs">
                    {moment.format(change.checkedAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
