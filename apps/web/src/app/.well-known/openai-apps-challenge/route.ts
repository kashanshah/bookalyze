import { env } from "@/server/env";

/**
 * OpenAI's domain check for publishing Bookalyze in ChatGPT's plugin directory: the exact
 * token from the OpenAI dashboard, as plain text. Set OPENAI_APPS_CHALLENGE; 404 until then.
 */
export function GET() {
  const token = env().OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response("Not found", { status: 404 });
  return new Response(token, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
