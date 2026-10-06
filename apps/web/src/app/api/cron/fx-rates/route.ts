import { syncAllConnections } from "@/server/banking";
import { sendComplianceReminders } from "@/server/compliance";
import { env } from "@/server/env";
import { syncBankOfCanada } from "@/server/fx";

/**
 * The daily job (scheduled in vercel.json). Vercel Cron calls this with
 * "Authorization: Bearer $CRON_SECRET"; anything else is refused. It re-fetches the last ten
 * days of exchange rates (late corrections, missed runs), then syncs every bank connection, so
 * foreign-currency bank lines find their rate. Last, it emails compliance reminders. Amazon
 * orders have their own job (/api/cron/orders).
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
  const compliance = await sendComplianceReminders().catch((error: unknown) => ({
    error: (error as Error).message,
  }));
  return Response.json({ stored, banking, compliance });
}
