"use client";

import { Check } from "lucide-react";
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
import { cn } from "@/lib/utils";

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
  const afterSignUp = redirectTo === "/" ? "/onboarding" : redirectTo;
  const longEnough = password.length >= 10;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
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
    router.push(`/check-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <>
      <AuthHeading
        title="Create your account"
        description={
          inviteOnly
            ? "Bookalyze is invite-only for now. Use the email address your invitation was sent to."
            : "Set up your books in a few minutes. No card needed."
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
            <Input id="name" name="name" autoComplete="name" placeholder="Jane Doe" required />
          </Field>
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
            label="Password"
            htmlFor="password"
            hint={
              <span
                className={cn(
                  "inline-flex items-center gap-1 transition-colors",
                  longEnough && "text-success",
                )}
              >
                <Check
                  className={cn(
                    "size-3 transition-opacity",
                    longEnough ? "opacity-100" : "opacity-40",
                  )}
                />
                At least 10 characters
              </span>
            }
          >
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
            {pending ? <Spinner /> : null}
            {pending ? "Creating your account…" : "Create account"}
          </Button>
        </form>
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
