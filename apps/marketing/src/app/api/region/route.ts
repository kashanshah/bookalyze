import { needsConsent } from "@bookalyze/core";

export const dynamic = "force-dynamic";

/**
 * Whether this visitor is asked before the source cookie is set, from Vercel's geolocation
 * (no header, as in development: not asked). Only the answer leaves; the country isn't kept.
 */
export function GET(request: Request) {
  return Response.json(
    { consent: needsConsent(request.headers.get("x-vercel-ip-country")) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
