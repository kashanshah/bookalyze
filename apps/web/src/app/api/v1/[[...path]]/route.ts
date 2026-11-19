import { handleRest } from "@/server/api/http";

/** The public REST API. See docs/API.md and /api/v1/openapi.json. */
export const maxDuration = 60;

type Context = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, { params }: Context) {
  const { path = [] } = await params;
  return handleRest(request, path);
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
