import "server-only";
import {
  can,
  checkAgainAt,
  diffListing,
  EMPTY_OBSERVATION,
  getPlan,
  isAmazonRegion,
  isModuleKey,
  type ListingChange,
  type ListingCheck,
  type ListingObservation,
  type ModuleKey,
  parseCatalogItem,
  parseItemOffers,
  parseReviewTopics,
  reviewTopicsAvailable,
  reviewTopicsUnavailableNote,
} from "@bookalyze/core";
import {
  dueListingWatchIds,
  getDb,
  getListingWatchForCheck,
  ListingWatchError,
  markListingChangesNotified,
  saveListingCheck,
  saveListingCheckError,
  schema,
  unnotifiedListingChanges,
  VaultError,
  withOrg,
} from "@bookalyze/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ListingChanges } from "@/emails/listing-changes";
import { AmazonError, catalogItem, itemOffers, reviewTopics } from "./amazon";
import { openAmazonCredentials } from "./commerce";
import { sendEmail } from "./email";
import { env } from "./env";

/**
 * Looks up the products a company is watching and emails owners and admins when Amazon reports
 * a change. The hourly job calls `checkDueListingWatches`; "Check now" calls `checkListingWatch`.
 * Nothing here posts to the books.
 */

const REVIEW_NOTE =
  "Amazon isn't sharing review topics for this product. The app needs the Selling Partner Insights role, and Amazon only returns them for a child product of a brand you sell.";
const HOUR = 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type CheckContext = { orgId: string; userId: string | null };

const OFFER_CHECKS: readonly ListingCheck[] = ["price", "featured", "offers"];

export type ListingCheckResult =
  | { ok: true; changes: ListingChange[] }
  | { ok: false; message: string; throttled?: boolean };

function messageOf(error: unknown): string {
  if (
    error instanceof AmazonError ||
    error instanceof ListingWatchError ||
    error instanceof VaultError
  ) {
    return error.message;
  }
  return "Amazon couldn't be checked just now. We'll try again shortly.";
}

async function localeOf(orgId: string): Promise<string> {
  const [row] = await withOrg(getDb(), { orgId, userId: null }, (tx) =>
    tx
      .select({ locale: schema.organizationProfiles.locale })
      .from(schema.organizationProfiles)
      .limit(1),
  );
  return row?.locale || "en-CA";
}

function assemble(
  previous: ListingObservation | null,
  catalog: ReturnType<typeof parseCatalogItem>,
  offers: ReturnType<typeof parseItemOffers> | null,
  reviews: { topics: ListingObservation["reviewTopics"]; note: string | null } | null,
): ListingObservation {
  return {
    ...EMPTY_OBSERVATION,
    ...catalog,
    price: offers ? offers.price : (previous?.price ?? null),
    currency: offers ? offers.currency : (previous?.currency ?? null),
    featured: offers ? offers.featured : (previous?.featured ?? null),
    offerCount: offers ? offers.offerCount : (previous?.offerCount ?? null),
    reviewTopics: reviews ? reviews.topics : (previous?.reviewTopics ?? []),
    reviewNote: reviews ? reviews.note : (previous?.reviewNote ?? null),
  };
}

/** One product. A forced check runs even when the next look isn't due yet. */
export async function checkListingWatch(
  ctx: CheckContext,
  id: string,
  force: boolean,
): Promise<ListingCheckResult> {
  const db = getDb();
  const found = await withOrg(db, ctx, (tx) => getListingWatchForCheck(tx, id));
  if (!found) return { ok: false, message: "This product is no longer being watched." };
  if (found.watch.paused && !force) return { ok: true, changes: [] };
  if (!force && found.watch.nextCheckAt.getTime() > Date.now()) return { ok: true, changes: [] };

  const fail = async (message: string, waitMs = HOUR) => {
    await withOrg(db, ctx, (tx) =>
      saveListingCheckError(tx, {
        id,
        error: message,
        nextCheckAt: new Date(Date.now() + waitMs),
      }),
    );
    return { ok: false as const, message };
  };

  const region = String(found.settings?.region ?? "");
  if (
    !found.channelActive ||
    !found.marketplaceId ||
    found.provider !== "amazon_sp" ||
    found.connectionStatus === "disconnected" ||
    !found.secret ||
    !found.connectionId ||
    !isAmazonRegion(region)
  ) {
    return fail(
      found.channelActive
        ? "Connect this Amazon account again in Channels, then check the product."
        : "This marketplace is switched off. Switch it on in Channels to keep watching.",
      24 * HOUR,
    );
  }

  let creds: ReturnType<typeof openAmazonCredentials>;
  try {
    creds = openAmazonCredentials(ctx.orgId, found.connectionId, found.secret);
  } catch (error) {
    return fail(messageOf(error), 24 * HOUR);
  }

  const checks = found.watch.checks as ListingCheck[];
  const marketplaceId = found.marketplaceId;
  let catalog: ReturnType<typeof parseCatalogItem>;
  try {
    catalog = parseCatalogItem(
      await catalogItem(creds, region, found.watch.asin, marketplaceId),
      marketplaceId,
    );
  } catch (error) {
    if (error instanceof AmazonError && error.code === "throttled") {
      return { ok: false, message: error.message, throttled: true };
    }
    return fail(messageOf(error));
  }

  let offers: ReturnType<typeof parseItemOffers> | null = null;
  let offersError: string | null = null;
  if (checks.some((check) => OFFER_CHECKS.includes(check))) {
    try {
      offers = parseItemOffers(await itemOffers(creds, region, found.watch.asin, marketplaceId));
    } catch (error) {
      if (error instanceof AmazonError && error.code === "throttled") {
        return { ok: false, message: error.message, throttled: true };
      }
      offersError = messageOf(error);
    }
  }

  let reviews: { topics: ListingObservation["reviewTopics"]; note: string | null } | null = null;
  if (checks.includes("reviews") && !reviewTopicsAvailable(marketplaceId)) {
    reviews = {
      topics: [],
      note: reviewTopicsUnavailableNote(found.channelName),
    };
  } else if (checks.includes("reviews")) {
    try {
      const answer = await reviewTopics(creds, region, found.watch.asin, marketplaceId);
      reviews = answer.unavailable
        ? { topics: found.watch.observed?.reviewTopics ?? [], note: REVIEW_NOTE }
        : { topics: parseReviewTopics(answer.body), note: null };
    } catch (error) {
      if (error instanceof AmazonError && error.code === "throttled") {
        return { ok: false, message: error.message, throttled: true };
      }
      reviews = { topics: found.watch.observed?.reviewTopics ?? [], note: REVIEW_NOTE };
    }
  }

  const locale = await localeOf(ctx.orgId);
  const observed = assemble(found.watch.observed, catalog, offers, reviews);
  const checkedAt = new Date();
  const changes = await withOrg(db, ctx, async (tx) => {
    const current = await getListingWatchForCheck(tx, id);
    if (!current) return [];
    const foundChanges = diffListing(current.watch.observed, observed, checks, locale);
    await saveListingCheck(tx, {
      id,
      observed,
      changes: foundChanges,
      title: observed.title,
      checkedAt,
      nextCheckAt: checkAgainAt(current.watch.cadence, checkedAt),
      error: offersError,
    });
    return foundChanges;
  });
  return { ok: true, changes };
}

/** Owners and admins, one email per company, covering every change not sent yet. */
export async function emailListingChanges(org: {
  id: string;
  name: string;
  slug: string;
}): Promise<number> {
  const db = getDb();
  const ctx = { orgId: org.id, userId: null };
  const items = await withOrg(db, ctx, (tx) => unnotifiedListingChanges(tx));
  if (!items.length) return 0;
  const recipients = await withOrg(db, ctx, (tx) =>
    tx
      .select({ email: schema.user.email })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(
        and(
          eq(schema.member.organizationId, org.id),
          inArray(schema.member.role, ["owner", "admin"]),
        ),
      ),
  );
  if (!recipients.length) return 0;
  const url = `${env().BETTER_AUTH_URL}/o/${org.slug}/commerce/watch`;
  const subject =
    items.length === 1
      ? `${items[0]?.title || items[0]?.asin} changed on ${items[0]?.channelName}`
      : `${items.length} products changed`;
  let sent = 0;
  for (const { email } of recipients) {
    try {
      await sendEmail({
        to: email,
        subject,
        react: ListingChanges({
          organizationName: org.name,
          url,
          items: items.map((item) => ({
            title: item.title || item.asin,
            channelName: item.channelName,
            summary: item.summary,
            href: `${url}/${item.watchId}`,
          })),
        }),
      });
      sent += 1;
    } catch (error) {
      // One bad address mustn't stop the others; the changes still show on the page.
      console.error("Listing changes email failed", error);
    }
  }
  // Nobody reached: keep them for the next run rather than dropping them.
  if (!sent) return 0;
  await withOrg(db, ctx, (tx) =>
    markListingChangesNotified(
      tx,
      items.flatMap((item) => item.changeIds),
    ),
  );
  return sent;
}

/** Every company with a product due for a look, within a time budget. */
export async function checkDueListingWatches(budgetMs: number): Promise<{
  checked: number;
  changes: number;
  emails: number;
}> {
  const started = Date.now();
  const db = getDb();
  const orgs = await db.execute<{ organization_id: string }>(
    sql`select organization_id from listing_watch_orgs()`,
  );
  let checked = 0;
  let changes = 0;
  let emails = 0;
  for (const org of orgs.rows) {
    if (Date.now() - started > budgetMs) break;
    const [company] = await db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
      })
      .from(schema.organization)
      .where(eq(schema.organization.id, org.organization_id));
    if (!company) continue;
    try {
      const ids = await withOrg(db, { orgId: company.id, userId: null }, async (tx) => {
        // Only companies that still have listing watch (Commerce on, and in their plan).
        const [profile] = await tx
          .select({ planKey: schema.organizationProfiles.planKey })
          .from(schema.organizationProfiles)
          .limit(1);
        const enabled = (await tx.select().from(schema.organizationModules))
          .filter((m) => m.enabled && isModuleKey(m.moduleKey))
          .map((m) => m.moduleKey as ModuleKey);
        if (!profile || !can(getPlan(profile.planKey), enabled, "commerce.listings")) return [];
        return dueListingWatchIds(tx, 20);
      });
      if (!ids.length) continue;
      for (const id of ids) {
        if (Date.now() - started > budgetMs) break;
        const result = await checkListingWatch({ orgId: company.id, userId: null }, id, false);
        checked += 1;
        if (result.ok) changes += result.changes.length;
        // Amazon throttles each seller account on its own: this company waits, the rest go on.
        if (!result.ok && result.throttled) break;
        await sleep(400);
      }
      emails += await emailListingChanges(company);
    } catch (error) {
      // One company's failure mustn't stop the others.
      console.error("Listing watch failed for a company", error);
    }
  }
  return { checked, changes, emails };
}
