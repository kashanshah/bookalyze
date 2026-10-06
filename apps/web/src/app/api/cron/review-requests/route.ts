import { env } from "@/server/env";
import { runAllReviewRequests } from "@/server/reviews";

/**
 * The hourly job (scheduled in vercel.json), so requests go out at the hour each company chose.
 * Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET"; anything else is refused.
 * It plans automatic review requests for new orders, then sends the ones that are due.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const reviews = await runAllReviewRequests(240_000).catch((error: unknown) => ({
    error: (error as Error).message,
  }));
  return Response.json({ reviews });
}
