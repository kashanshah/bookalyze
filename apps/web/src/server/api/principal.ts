import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ResolvedApiKey } from "@bookalyze/db";

/**
 * Who an API or MCP request acts as: one person, through one of their API keys. While a request
 * runs inside `runAsApiKey()`, `getSession()` returns that person's session, so every page loader
 * and server action works exactly as it does in the browser (same membership checks, roles,
 * validation and audit), and `audit()` notes the key that made each change.
 */
export type ApiPrincipal = {
  key: ResolvedApiKey;
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
    twoFactorEnabled: boolean | null;
  };
};

const storage = new AsyncLocalStorage<ApiPrincipal>();

export function runAsApiKey<T>(principal: ApiPrincipal, fn: () => Promise<T>): Promise<T> {
  return storage.run(principal, fn);
}

/** The API key the current request acts through, if any. */
export function currentApiPrincipal(): ApiPrincipal | undefined {
  return storage.getStore();
}
