import { handleMcp } from "@/server/api/mcp";

/** The MCP server (Streamable HTTP). Authenticate with an API key as a Bearer token. */
export const maxDuration = 60;

export { handleMcp as DELETE, handleMcp as GET, handleMcp as POST };
