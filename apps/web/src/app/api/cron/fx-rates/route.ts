import { runAmazonAdsJob } from "@/server/amazon-ads-sync";
import { syncAllLedgers } from "@/server/amazon-ledger";
import { syncAllSettlements } from "@/server/amazon-settlements";
import { syncAllConnections } from "@/server/banking";
import { sendComplianceReminders } from "@/server/compliance";
import { runEbayDaily } from "@/server/ebay-finances";
import { env } from "@/server/env";
import { syncBankOfCanada } from "@/server/fx";
import { jobStep, logInfo } from "@/server/log";
import { runNoonDaily } from "@/server/noon-daily";
import { autoPostSettlements } from "@/server/settlement-posting";
import { runWalmartDaily } from "@/server/walmart-daily";

/**
 * The daily job (scheduled in vercel.json). Vercel Cron calls this with
 * "Authorization: Bearer $CRON_SECRET"; anything else is refused. It re-fetches the last ten
 * days of exchange rates (late corrections, missed runs), then syncs every bank connection, so
 * foreign-currency bank lines find their rate. Then it brings in new Amazon settlement reports and
 * posts them (with their deposits) where automatic posting is on, brings in each marketplace's FBA
 * inventory ledger (returns, losses), brings in Noon's transactions and posts its finished months
 * (with their payouts) where that's switched on, does the same for eBay and Walmart, asks Amazon
 * Ads for each channel's latest ad spend (collected by the order job once ready), and last it
 * emails compliance reminders. Amazon orders have their own job (/api/cron/orders).
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const end = new Date().toISOString().slice(0, 10);
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 10);
  const started = Date.now();
  const stored = await jobStep("daily", "fx_rates", () =>
    syncBankOfCanada(startDate.toISOString().slice(0, 10), end),
  );
  const banking = await jobStep("daily", "banking", () => syncAllConnections());
  const settlements = await jobStep("daily", "settlements", () => syncAllSettlements(90_000));
  const ledgers = await jobStep("daily", "ledgers", () => syncAllLedgers(60_000));
  const posting = await jobStep("daily", "posting", () => autoPostSettlements());
  const noon = await jobStep("daily", "noon", () => runNoonDaily(60_000));
  const ebay = await jobStep("daily", "ebay", () => runEbayDaily(40_000));
  const walmart = await jobStep("daily", "walmart", () => runWalmartDaily(30_000));
  const ads = await jobStep("daily", "amazon_ads", () =>
    runAmazonAdsJob(30_000, { requestNew: true }),
  );
  const compliance = await jobStep("daily", "compliance", () => sendComplianceReminders());
  logInfo("job.daily", {
    ms: Date.now() - started,
    stored,
    banking,
    settlements,
    ledgers,
    posting,
    noon,
    ebay,
    walmart,
    ads,
    compliance,
  });
  return Response.json({
    stored,
    banking,
    settlements,
    ledgers,
    posting,
    noon,
    ebay,
    walmart,
    ads,
    compliance,
  });
}
