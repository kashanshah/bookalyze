import {
  oauthError,
  oauthJson,
  originOf,
  PROTECTED_PATHS,
  preflight,
  protectedResourceMetadata,
} from "@/server/oauth";

/** RFC 9728: which authorization server issues tokens for the API and the MCP server. */
export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  if (suffix && !PROTECTED_PATHS.some((p) => p === suffix)) {
    return oauthError("not_found", "No such protected resource.", 404);
  }
  return oauthJson(protectedResourceMetadata(originOf(request), suffix), 200, {
    "Cache-Control": "public, max-age=3600",
  });
}

export const OPTIONS = preflight;
