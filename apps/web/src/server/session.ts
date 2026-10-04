import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./auth";

export const getSession = cache(async () => {
  // Read request headers first: it marks the page as dynamic before any runtime config is touched.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

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
