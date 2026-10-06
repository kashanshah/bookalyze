import { syncAllOrders } from "@/server/amazon-orders";
import { env } from "@/server/env";

/**
 * The order job, every 5 minutes (vercel.json). Vercel Cron calls it with
 * "Authorization: Bearer $CRON_SECRET"; anything else is refused. It brings in new and changed
 * Amazon orders, then the items of orders still without them (Amazon allows about one order's
 * items every 2 seconds, so a large first sync carries on run after run). The budget ends each
 * run before the next one starts.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const orders = await syncAllOrders(240_000).catch((error: unknown) => ({
    error: (error as Error).message,
  }));
  return Response.json({ orders });
}
