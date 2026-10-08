import { env } from "@/server/env";
import { jobStep, logInfo } from "@/server/log";
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
  const started = Date.now();
  const reviews = await jobStep("review_requests", "run", () => runAllReviewRequests(240_000));
  logInfo("job.review_requests", { ms: Date.now() - started, reviews });
  return Response.json({ reviews });
}
