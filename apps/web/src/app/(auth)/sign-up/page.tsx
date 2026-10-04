import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { env, isGoogleEnabled } from "@/server/env";
import { getSession, safeRedirect } from "@/server/session";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; email?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = safeRedirect(params.redirect);
  if (await getSession()) redirect(redirectTo);
  return (
    <SignUpForm
      redirectTo={redirectTo}
      googleEnabled={isGoogleEnabled()}
      inviteOnly={env().SIGNUP_MODE === "invite_only"}
      initialEmail={params.email}
    />
  );
}
