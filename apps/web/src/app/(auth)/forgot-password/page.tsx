"use client";

import { ArrowLeft, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthHeading } from "@/components/auth/auth-heading";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setPending(true);
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    // Same response whether or not the account exists, so emails can't be enumerated.
    setSentTo(email);
  }

  return (
    <>
      {sentTo ? (
        <>
          <span className="zoom-in-75 mb-6 flex size-12 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
            <MailCheck className="size-6" />
          </span>
          <AuthHeading
            title="Check your email"
            description={
              <>
                If an account exists for <strong className="text-foreground">{sentTo}</strong>,
                we've sent a link to choose a new password. It expires in one hour.
              </>
            }
          />
        </>
      ) : (
        <>
          <AuthHeading
            title="Forgot your password?"
            description="Enter your email and we'll send you a reset link."
          />
          <form onSubmit={onSubmit} className="grid gap-4">
            <Field label="Email address" htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                required
              />
            </Field>
            <Button type="submit" size="lg" disabled={pending} className="w-full">
              {pending ? <Spinner /> : null}
              Send reset link
            </Button>
          </form>
        </>
      )}
      <Link
        href="/sign-in"
        className="mt-6 inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Back to sign in
      </Link>
    </>
  );
}
