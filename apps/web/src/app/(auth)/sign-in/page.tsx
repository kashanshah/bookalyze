import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isGoogleEnabled } from "@/server/env";
import { getSession, safeRedirect } from "@/server/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  unable_to_create_user:
    "Bookalyze is invite-only for now. Ask an organization owner to invite you.",
  account_not_linked: "That Google account couldn't be linked to your existing account.",
  access_denied: "Google sign-in was cancelled.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string; email?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = safeRedirect(params.redirect);
  if (await getSession()) redirect(redirectTo);
  const error = params.error
    ? (ERRORS[params.error] ?? "Sign-in failed. Please try again.")
    : undefined;
  return (
    <SignInForm
      redirectTo={redirectTo}
      googleEnabled={isGoogleEnabled()}
      initialError={error}
      initialEmail={params.email}
    />
  );
}
