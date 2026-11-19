import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resourceMetadataUrl } from "../oauth";
import { ACTION_CATALOG } from "./action-catalog.generated";
import { type Access, ApiError, authenticate, type Operation, toApiError } from "./core";
import { execute } from "./execute";
import { errorResponse, json } from "./http";
import { OPERATIONS } from "./ops";
import { actionAccess } from "./ops/app-actions";

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
- Anything else a screen can do: list_app_actions, then read_app_action (for actions whose access is read) or call_app_action (for actions that change something).

Amounts are decimal strings in the account's currency ("1250.00"); dates are YYYY-MM-DD. Nothing on or before the company's booksLockedThrough date can change. When a write is refused, the error says which field and why: fix that and try again rather than working around it.`;

/** One MCP tool: an operation, or one half of the app-action operation. */
type Tool = {
  op: Operation;
  name: string;
  title: string;
  description: string;
  access: Access;
  destructive: boolean;
  /** For the app-action tools: only actions with this access. */
  actions?: Access;
};

/**
 * Tools from operations. Running a screen's action is one REST route, but two tools: app
 * directories (Claude, ChatGPT, Gemini) require every tool to be clearly read-only or not, so
 * reads and changes can't share a tool.
 */
function toolsFor(op: Operation): Tool[] {
  if (op.name !== "call_app_action") {
    return [
      {
        op,
        name: op.name,
        title: op.title,
        description: op.description,
        access: op.access,
        destructive: Boolean(op.destructive),
      },
    ];
  }
  const how =
    "`args` are its arguments after the company, in order, as JSON (objects as the screen's form sends them). Validation errors come back with the same messages the screen shows. Prefer a dedicated tool when one fits.";
  return [
    {
      op,
      name: "read_app_action",
      title: "Look something up with an app action",
      description: `Runs one action from list_app_actions whose access is "read", exactly as the screen that offers it would, for one company. It changes nothing. ${how}`,
      access: "read",
      destructive: false,
      actions: "read",
    },
    {
      op,
      name: "call_app_action",
      title: "Change something with an app action",
      description: `Runs one action from list_app_actions whose access is "write", exactly as the screen that offers it would, for one company. It can create, change or remove records, so tell the person what it will do first. ${how}`,
      access: "write",
      destructive: true,
      actions: "write",
    },
  ];
}

/** The app-action tools only run actions of their own kind. */
function checkActionKind(tool: Tool, args: Record<string, unknown>) {
  if (!tool.actions) return;
  const action = ACTION_CATALOG.find((a) => a.name === args.action);
  if (!action || actionAccess(action) === tool.actions) return;
  throw new ApiError(
    400,
    "invalid_request",
    tool.actions === "read"
      ? `${action.name} changes things. Use call_app_action for it.`
      : `${action.name} only reads. Use read_app_action for it.`,
  );
}

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
    return errorResponse(
      toApiError(error, { route: "mcp" }),
      resourceMetadataUrl(origin, "/api/mcp"),
    );
  }

  const server = new McpServer(
    {
      name: "bookalyze",
      title: "Bookalyze",
      version: "1.0.0",
      websiteUrl: "https://bookalyze.com",
      // Assistants that show a connector's icon take it from here (MCP 2025-11-25).
      icons: [
        { src: `${origin}/connector-icon.png`, mimeType: "image/png", sizes: ["256x256"] },
        { src: `${origin}/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] },
        {
          src: `${origin}/favicon-light.svg`,
          mimeType: "image/svg+xml",
          sizes: ["any"],
          theme: "light",
        },
        {
          src: `${origin}/favicon-dark.svg`,
          mimeType: "image/svg+xml",
          sizes: ["any"],
          theme: "dark",
        },
      ],
    },
    { instructions: INSTRUCTIONS, capabilities: { tools: {} } },
  );
  const writable = principal.key.access === "write";
  for (const tool of OPERATIONS.flatMap(toolsFor)) {
    // A read-only key isn't offered tools it could never use.
    if (tool.access === "write" && !writable) continue;
    const op = tool.op;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: op.input.shape,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.access === "read",
          destructiveHint: tool.destructive,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          checkActionKind(tool, args);
          const data = await execute(op, principal, args, origin);
          return { content: [{ type: "text" as const, text: text(data) }] };
        } catch (error) {
          const failure = toApiError(error, { tool: tool.name });
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
