import { env } from "@/server/env";
import { checkDueListingWatches } from "@/server/listing-watch";
import { jobStep, logInfo } from "@/server/log";

/**
 * The listing watch job, hourly (vercel.json). Vercel Cron calls it with
 * "Authorization: Bearer $CRON_SECRET"; anything else is refused. It checks products that are
 * due and emails owners and admins when something changed.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const started = Date.now();
  const listings = await jobStep("listings", "run", () => checkDueListingWatches(45_000));
  logInfo("job.listings", { ms: Date.now() - started, listings });
  return Response.json({ listings });
}
