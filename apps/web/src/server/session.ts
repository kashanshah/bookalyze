import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { currentApiPrincipal } from "./api/principal";
import { getAuth } from "./auth";

type Session = Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>;

export const getSession = cache(async (): Promise<Session> => {
  // Read request headers first: it marks the page as dynamic before any runtime config is touched.
  const requestHeaders = await headers();
  // An API or MCP request: the key's owner, never a browser cookie that came along.
  const api = currentApiPrincipal();
  if (api) return apiSession(api);
  return getAuth().api.getSession({ headers: requestHeaders });
});

/** The session an API key stands in for: its owner, with no browser session behind it. */
function apiSession(api: NonNullable<ReturnType<typeof currentApiPrincipal>>): Session {
  const now = new Date();
  return {
    user: api.user,
    session: {
      id: `api-key:${api.key.id}`,
      userId: api.user.id,
      token: "",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      ipAddress: null,
      userAgent: null,
      activeOrganizationId: null,
    },
  } as unknown as Session;
}

export async function requireSession(redirectTo?: string) {
  const session = await getSession();
  if (!session) {
    redirect(redirectTo ? `/sign-in?redirect=${encodeURIComponent(redirectTo)}` : "/sign-in");
  }
  return session;
}

/** Accepts only same-site relative paths, so redirects can't be used for phishing. */
export function safeRedirect(value: string | null | undefined, fallback = "/"): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
