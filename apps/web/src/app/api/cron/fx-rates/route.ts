import { syncAllLedgers } from "@/server/amazon-ledger";
import { syncAllSettlements } from "@/server/amazon-settlements";
import { syncAllConnections } from "@/server/banking";
import { sendComplianceReminders } from "@/server/compliance";
import { env } from "@/server/env";
import { syncBankOfCanada } from "@/server/fx";
import { autoPostSettlements } from "@/server/settlement-posting";

/**
 * The daily job (scheduled in vercel.json). Vercel Cron calls this with
 * "Authorization: Bearer $CRON_SECRET"; anything else is refused. It re-fetches the last ten
 * days of exchange rates (late corrections, missed runs), then syncs every bank connection, so
 * foreign-currency bank lines find their rate. Then it brings in new Amazon settlement reports and
 * posts them (with their deposits) where automatic posting is on, brings in each marketplace's FBA
 * inventory ledger (returns, losses), and last it emails compliance
 * reminders. Amazon orders have their own job (/api/cron/orders).
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
  const stored = await syncBankOfCanada(startDate.toISOString().slice(0, 10), end).catch(() => 0);
  const banking = await syncAllConnections();
  const settlements = await syncAllSettlements(90_000).catch((error: unknown) => ({
    error: (error as Error).message,
  }));
  const ledgers = await syncAllLedgers(60_000).catch((error: unknown) => ({
    error: (error as Error).message,
  }));
  const posting = await autoPostSettlements().catch((error: unknown) => ({
    error: (error as Error).message,
  }));
  const compliance = await sendComplianceReminders().catch((error: unknown) => ({
    error: (error as Error).message,
  }));
  return Response.json({ stored, banking, settlements, ledgers, posting, compliance });
}
