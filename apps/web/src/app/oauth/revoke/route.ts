import { getDb, revokeOAuthToken } from "@bookalyze/db";
import { CORS, oauthError, preflight, readParams } from "@/server/oauth";

/** RFC 7009: an app signs out, revoking its connection. Always 200, as the RFC asks. */
export async function POST(request: Request) {
  const params = await readParams(request);
  const token = typeof params?.token === "string" ? params.token : "";
  const clientId = typeof params?.client_id === "string" ? params.client_id : "";
  if (!token || !clientId)
    return oauthError("invalid_request", "token and client_id are required.");
  await revokeOAuthToken(getDb(), { token, clientId });
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store", ...CORS } });
}

export const OPTIONS = preflight;
