import { authorizationServerMetadata, oauthJson, originOf, preflight } from "@/server/oauth";

/** RFC 8414: the OAuth endpoints (sign in with Bookalyze from Claude Code and other MCP clients). */
export function GET(request: Request) {
  return oauthJson(authorizationServerMetadata(originOf(request)), 200, {
    "Cache-Control": "public, max-age=3600",
  });
}

export const OPTIONS = preflight;
