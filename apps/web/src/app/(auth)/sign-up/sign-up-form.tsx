"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { GoogleButton, OrDivider } from "@/components/auth/google-button";
import { PasswordRules, passwordReady } from "@/components/auth/password-rules";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function SignUpForm({
  redirectTo,
  googleEnabled,
  inviteOnly,
  initialEmail,
}: {
  redirectTo: string;
  googleEnabled: boolean;
  inviteOnly: boolean;
  initialEmail?: string | undefined;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail ?? "");
  const afterSignUp = redirectTo === "/" ? "/onboarding" : redirectTo;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    if (!passwordReady(password, { email, name })) {
      setError("Choose a password that meets every rule under it.");
      return;
    }
    setPending(true);
    setError(undefined);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")),
      email,
      password: String(form.get("password")),
      callbackURL: afterSignUp,
    });
    if (error) {
      setPending(false);
      setError(
        error.status === 429
          ? "Too many attempts. Please wait a few seconds and try again."
          : (error.message ?? "We couldn't create your account. Please try again."),
      );
      return;
    }
    track("Sign up", { with: "email" });
    router.push(`/check-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <>
      <AuthHeading
        title="Create your account"
        description={
          inviteOnly
            ? "Bookalyze is invite-only for now. Use the email address your invitation was sent to."
            : "Set up your books in a few minutes. 30 days free; cancel any time."
        }
      />
      <div className="grid gap-5">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {googleEnabled ? (
          <>
            <GoogleButton redirectTo={afterSignUp} label="Sign up with Google" />
            <OrDivider />
          </>
        ) : null}
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Your name" htmlFor="name">
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Jane Doe"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Email address" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            hint={
              <PasswordRules id="password-rules" password={password} email={email} name={name} />
            }
          >
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              aria-describedby="password-rules"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
            {pending ? <Spinner /> : null}
            {pending ? "Creating your account…" : "Create account"}
          </Button>
        </form>
        <p className="text-center text-muted-foreground text-xs leading-5">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
            Terms of service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy-policy"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Privacy policy
          </Link>
          .
        </p>
        <p className="text-center text-muted-foreground text-sm">
          Already have an account?{" "}
          <Link
            href={`/sign-in${redirectTo !== "/" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </>
  );
}
