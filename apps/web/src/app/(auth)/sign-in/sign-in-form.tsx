"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { GoogleButton, OrDivider } from "@/components/auth/google-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function SignInForm({
  redirectTo,
  googleEnabled,
  initialError,
  initialEmail,
}: {
  redirectTo: string;
  googleEnabled: boolean;
  initialError?: string | undefined;
  initialEmail?: string | undefined;
}) {
  const router = useRouter();
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState<string>();
  const [unverifiedEmail, setUnverifiedEmail] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    const { error } = await authClient.signIn.email({
      email,
      password: String(form.get("password")),
      callbackURL: redirectTo,
    });
    if (error) {
      setPending(false);
      if (error.code === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(email);
        setError("Please confirm your email address first. We've just sent you a new link.");
      } else if (error.status === 429) {
        setError("Too many attempts. Please wait a few seconds and try again.");
      } else {
        setError("That email and password don't match. Try again or reset your password.");
      }
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    await authClient.sendVerificationEmail({ email: unverifiedEmail, callbackURL: redirectTo });
    setNotice("Sent. Check your inbox for the confirmation link.");
  }

  return (
    <>
      <AuthHeading title="Welcome back" description="Sign in to manage your books and stores." />
      <div className="grid gap-5">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}
        {googleEnabled ? (
          <>
            <GoogleButton redirectTo={redirectTo} label="Continue with Google" />
            <OrDivider />
          </>
        ) : null}
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Email address" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              defaultValue={initialEmail}
            />
          </Field>
          <Field
            label={
              <span className="flex w-full items-center justify-between">
                Password
                <Link
                  href="/forgot-password"
                  className="font-normal text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </Link>
              </span>
            }
            htmlFor="password"
          >
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
            {pending ? <Spinner /> : null}
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          {unverifiedEmail ? (
            <Button type="button" variant="link" onClick={resendVerification}>
              Resend confirmation email
            </Button>
          ) : null}
        </form>
        <p className="text-center text-muted-foreground text-sm">
          New to Bookalyze?{" "}
          <Link
            href={`/sign-up${redirectTo !== "/" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </>
  );
}
