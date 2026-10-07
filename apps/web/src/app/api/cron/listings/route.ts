import { env } from "@/server/env";
import { checkDueListingWatches } from "@/server/listing-watch";

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
  const listings = await checkDueListingWatches(45_000).catch((error: unknown) => ({
    error: (error as Error).message,
  }));
  return Response.json({ listings });
}
