import "server-only";
import { z } from "zod";
import { resourceMetadataUrl } from "../oauth";
import { ApiError, authenticate, type Operation, toApiError } from "./core";
import { execute } from "./execute";
import { OPERATIONS } from "./ops";

/**
 * The REST face of the API: /api/v1/… routes onto the operations. GET and DELETE take their
 * input from the query string, the others from a JSON body; path segments fill the rest.
 * Responses are `{ "data": … }` or `{ "error": { code, message, details } }`, never cached.
 */

const MAX_BODY_BYTES = 4_500_000;

type Route = { method: string; segments: string[]; op: Operation };

const ROUTES: Route[] = OPERATIONS.map((op) => {
  const [method = "GET", path = "/"] = op.http.split(" ");
  return { method, segments: path.split("/").filter(Boolean), op };
});

function match(method: string, segments: string[]) {
  let pathMatched = false;
  for (const route of ROUTES) {
    if (route.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = route.segments.every((part, i) => {
      const value = segments[i] ?? "";
      if (part.startsWith("{") && part.endsWith("}")) {
        params[part.slice(1, -1)] = decodeURIComponent(value);
        return value.length > 0;
      }
      return part === value;
    });
    if (!ok) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return pathMatched ? "method" : null;
}

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...HEADERS, ...extra },
  });
}

/**
 * An error as JSON. A 401 says how to authenticate (RFC 6750), and where to find the sign-in
 * (RFC 9728 `resource_metadata`), which is how MCP clients discover OAuth.
 */
export function errorResponse(error: ApiError, resourceMetadata?: string) {
  const challenge = [
    'Bearer realm="Bookalyze"',
    // RFC 6750 §3.1: no error code when the request carried no credentials at all.
    error.code === "missing_api_key" ? null : 'error="invalid_token"',
    resourceMetadata ? `resource_metadata="${resourceMetadata}"` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    },
    error.status,
    error.status === 401 ? { "WWW-Authenticate": challenge } : {},
  );
}

async function inputOf(request: Request, method: string): Promise<Record<string, unknown>> {
  if (method === "GET" || method === "DELETE") {
    return Object.fromEntries(new URL(request.url).searchParams);
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    throw new ApiError(413, "too_large", "The request body is over 4.5 MB.");
  }
  const text = await request.text();
  // Content-Length can be missing (chunked) or wrong, so check what actually arrived too.
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "too_large", "The request body is over 4.5 MB.");
  }
  if (!text.trim()) return {};
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Send JSON with Content-Type: application/json.",
    );
  }
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "The body isn't a JSON object.");
  }
}

export async function handleRest(request: Request, segments: string[]): Promise<Response> {
  const method = request.method.toUpperCase();
  if (segments.length === 1 && segments[0] === "openapi.json" && method === "GET") {
    return json(openApiDocument(new URL(request.url).origin));
  }
  try {
    const found = match(method, segments);
    if (!found)
      throw new ApiError(404, "route_not_found", "No such API route. See /api/v1/openapi.json.");
    if (found === "method")
      throw new ApiError(405, "method_not_allowed", `${method} isn't allowed here.`);
    const principal = await authenticate(request);
    const input = { ...(await inputOf(request, method)), ...found.params };
    const data = await execute(found.route.op, principal, input, new URL(request.url).origin);
    return json({ data: data ?? null });
  } catch (error) {
    return errorResponse(
      toApiError(error, { route: segments.join("/"), method }),
      resourceMetadataUrl(new URL(request.url).origin, "/api/v1"),
    );
  }
}

/** An OpenAPI 3.1 description of every route, built from the operations' own schemas. */
export function openApiDocument(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTES) {
    const { op } = route;
    const path = `/${route.segments.join("/")}`;
    const pathParams = route.segments.filter((s) => s.startsWith("{")).map((s) => s.slice(1, -1));
    const schema = z.toJSONSchema(op.input, { io: "input", unrepresentable: "any" }) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const inQuery = route.method === "GET" || route.method === "DELETE";
    const parameters = Object.entries(properties)
      .filter(([name]) => pathParams.includes(name) || inQuery)
      .map(([name, s]) => ({
        name,
        in: pathParams.includes(name) ? "path" : "query",
        required: pathParams.includes(name) || required.has(name),
        schema: s,
      }));
    const bodyProps = Object.fromEntries(
      Object.entries(properties).filter(([name]) => !pathParams.includes(name)),
    );
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = {
      operationId: op.name,
      summary: op.title,
      description: op.description,
      tags: [op.access === "read" ? "Read" : "Write"],
      parameters,
      ...(inQuery
        ? {}
        : {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: bodyProps,
                    required: [...required].filter((r) => !pathParams.includes(r)),
                  },
                },
              },
            },
          }),
      responses: {
        "200": { description: "`{ data }`" },
        "400": { description: "The input doesn't fit the schema." },
        "401": { description: "Missing, unknown, revoked or expired API key." },
        "403": { description: "Read-only key, or a module the company's plan keeps read-only." },
        "404": { description: "No such company or item for this key." },
        "422": { description: "Refused by Bookalyze's rules; `details.fields` says why." },
        "429": { description: "Over the rate limit." },
      },
      ...(op.access === "write" ? { "x-requires": "write" } : {}),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Bookalyze API",
      version: "1.0.0",
      description:
        "Read and write a company's books: transactions, journal entries, reconciliation, reports, bank statements, receipts and purchase orders. Every write goes through the same rules as the Bookalyze app. The same operations are MCP tools at /api/mcp.",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "bka_…" } },
    },
    paths,
  };
}
