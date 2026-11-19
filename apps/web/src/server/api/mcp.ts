import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ApiError, authenticate, toApiError } from "./core";
import { execute } from "./execute";
import { errorResponse, json } from "./http";
import { OPERATIONS } from "./ops";

/**
 * The MCP server (Streamable HTTP, stateless: one server per request, no sessions kept, nothing
 * that keeps the database awake between calls). It's authenticated like the REST API, with the
 * API key as a Bearer token, and every tool is one operation run through `execute()`, so tools
 * and REST routes can never disagree.
 */

const INSTRUCTIONS = `Bookalyze is an accounting app. These tools read and write one person's companies' books, with the same rules as the app.

Start with list_companies; every other tool takes the company's slug as \`company\`.
- Look things up: list_accounts (chart of accounts and category IDs), list_bank_accounts, list_transactions, list_journal_entries, list_contacts.
- Bookkeeping: create_transaction (money in/out, transfers incl. between currencies, owner contributions and drawings), update_transaction (categorise), create_journal_entry, upload_bank_statement (CSV; try dryRun first), sync_bank_connection, upload_receipt.
- Reconcile: get_reconciliation → start_reconciliation → set_reconciliation_cleared → finish_reconciliation.
- Reports: profit_and_loss, balance_sheet, trial_balance, general_ledger, sales_tax_report.
- Anything else a screen can do: list_app_actions, then call_app_action.

Amounts are decimal strings in the account's currency ("1250.00"); dates are YYYY-MM-DD. Nothing on or before the company's booksLockedThrough date can change. When a write is refused, the error says which field and why: fix that and try again rather than working around it.`;

/** A tool result's text is capped so one call can't flood the conversation. */
const MAX_TEXT = 400_000;

function text(value: unknown): string {
  const body = JSON.stringify(value ?? null, null, 2);
  if (body.length <= MAX_TEXT) return body;
  return `${body.slice(0, MAX_TEXT)}\n… (cut at ${MAX_TEXT} characters: narrow the dates or page with limit/offset)`;
}

export async function handleMcp(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  // DNS-rebinding protection: a browser page from another site may not drive this endpoint.
  const from = request.headers.get("origin");
  if (from && from !== origin) {
    return errorResponse(
      new ApiError(403, "forbidden_origin", "Requests from other sites aren't allowed."),
    );
  }
  if (request.method !== "POST") {
    // Stateless server: no event stream to open and no session to end.
    return json(
      { error: { code: "method_not_allowed", message: "This MCP server takes POST requests." } },
      405,
      { Allow: "POST" },
    );
  }
  let principal: Awaited<ReturnType<typeof authenticate>>;
  try {
    principal = await authenticate(request);
  } catch (error) {
    return errorResponse(toApiError(error, { route: "mcp" }));
  }

  const server = new McpServer(
    { name: "bookalyze", title: "Bookalyze", version: "1.0.0" },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  );
  const writable = principal.key.access === "write";
  for (const op of OPERATIONS) {
    // A read-only key isn't offered tools it could never use.
    if (op.access === "write" && !writable) continue;
    server.registerTool(
      op.name,
      {
        title: op.title,
        description: op.description,
        inputSchema: op.input.shape,
        annotations: {
          title: op.title,
          readOnlyHint: op.access === "read" && op.name !== "call_app_action",
          destructiveHint: Boolean(op.destructive),
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const data = await execute(op, principal, args, origin);
          return { content: [{ type: "text" as const, text: text(data) }] };
        } catch (error) {
          const failure = toApiError(error, { tool: op.name });
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: text({
                  error: failure.code,
                  message: failure.message,
                  details: failure.details,
                }),
              },
            ],
          };
        }
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
