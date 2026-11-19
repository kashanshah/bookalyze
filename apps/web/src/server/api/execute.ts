import "server-only";
import { ApiError, companyFor, type Operation, requireAccess, toApiError } from "./core";
import { type ApiPrincipal, runAsApiKey } from "./principal";

/**
 * Runs one operation for an authenticated key: scope first (read-only keys never reach a write),
 * then the input's shape, then the company (membership, the key's companies, paid modules),
 * then the operation itself as the key's owner. REST and MCP both come through here.
 */
export async function execute(
  op: Operation,
  principal: ApiPrincipal,
  raw: Record<string, unknown>,
  origin: string,
): Promise<unknown> {
  requireAccess(principal, op.access);
  const parsed = op.input.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fields[issue.path.map(String).join(".") || "input"] ??= issue.message;
    }
    const [first] = Object.entries(fields);
    throw new ApiError(
      400,
      "invalid_request",
      first ? `${first[0]}: ${first[1]}` : "Check the request.",
      { fields },
    );
  }
  const input = parsed.data as Record<string, unknown>;
  return runAsApiKey(principal, async () => {
    try {
      if (typeof input.company === "string") await companyFor(input.company, op);
      return await op.run({ principal, input, origin });
    } catch (error) {
      throw toApiError(error, { operation: op.name, keyId: principal.key.id });
    }
  });
}
