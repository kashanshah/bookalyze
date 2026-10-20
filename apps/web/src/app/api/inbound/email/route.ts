import { env } from "@/server/env";
import { handleReceivedEmail, verifyWebhook } from "@/server/inbound-email";
import { logError } from "@/server/log";

/**
 * Resend's webhook for received emails (forwarded invoice requests). Signed with
 * RESEND_WEBHOOK_SECRET; anything unsigned is refused. Answers 200 once handled, so Resend
 * doesn't retry an email that simply wasn't for us.
 */
export async function POST(request: Request) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });
  const body = await request.text();
  const signed = verifyWebhook(
    secret,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    body,
  );
  if (!signed) return new Response("Unauthorized", { status: 401 });
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const result = await handleReceivedEmail(event);
    return Response.json({ result });
  } catch (error) {
    // A database hiccup: 500 lets Resend retry later.
    logError("inbound.failed", error);
    return new Response("Error", { status: 500 });
  }
}
