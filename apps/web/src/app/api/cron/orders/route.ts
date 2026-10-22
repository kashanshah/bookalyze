import { runAmazonAdsJob } from "@/server/amazon-ads-sync";
import { syncAllOrders } from "@/server/amazon-orders";
import { env } from "@/server/env";
import { jobStep, logInfo } from "@/server/log";
import { runWalmartAdsJob } from "@/server/walmart-ads-sync";

/**
 * The order job, every half hour (vercel.json; on the hour and half past, with the hourly jobs,
 * so the database sleeps in between). Vercel Cron calls it with
 * "Authorization: Bearer $CRON_SECRET"; anything else is refused. It brings in new and changed
 * Amazon orders, then the items of orders still without them (Amazon allows about one order's
 * items every 2 seconds, so a large first sync carries on run after run). The budget ends each
 * run before the next one starts. Last, it collects the Amazon Ads and Walmart Connect reports
 * each has finished making (the daily job asks for them).
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const started = Date.now();
  const orders = await jobStep("orders", "run", () => syncAllOrders(220_000));
  const ads = await jobStep("orders", "amazon_ads", () =>
    runAmazonAdsJob(30_000, { requestNew: false }),
  );
  const walmartAds = await jobStep("orders", "walmart_ads", () =>
    runWalmartAdsJob(20_000, { requestNew: false }),
  );
  logInfo("job.orders", { ms: Date.now() - started, orders, ads, walmartAds });
  return Response.json({ orders, ads, walmartAds });
}
