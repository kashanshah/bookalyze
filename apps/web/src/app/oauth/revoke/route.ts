import { getDb, revokeOAuthToken } from "@bookalyze/db";
import { CORS, clientCredentials, oauthError, preflight, readParams } from "@/server/oauth";

/** RFC 7009: an app signs out, revoking its connection. Always 200, as the RFC asks. */
export async function POST(request: Request) {
  const params = await readParams(request);
  const token = typeof params?.token === "string" ? params.token : "";
  const credentials = params ? clientCredentials(request, params) : null;
  if (!token || !credentials) {
    return oauthError("invalid_request", "token and client_id are required.");
  }
  // Revoking only ever takes access away, and only from the app the token was issued to, so
  // a wrong secret here can't do harm; the token itself is the proof.
  await revokeOAuthToken(getDb(), { token, clientId: credentials.clientId });
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store", ...CORS } });
}

export const OPTIONS = preflight;
