"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AuthHeading } from "@/components/auth/auth-heading";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({
  token,
  invalid,
}: {
  token: string | undefined;
  invalid: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  if (invalid || !token) {
    return (
      <>
        <AuthHeading
          title="This link has expired"
          description="Reset links work once and expire after an hour."
        />
        <Button asChild size="lg" className="w-full">
          <Link href="/forgot-password">Send me a new link</Link>
        </Button>
      </>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (error) {
      setError(error.message ?? "We couldn't reset your password.");
      return;
    }
    toast.success("Password updated. Sign in with your new password.");
    router.push("/sign-in");
  }

  return (
    <>
      <AuthHeading
        title="Choose a new password"
        description="For your security, you'll be signed out everywhere else."
      />
      <form onSubmit={onSubmit} className="grid gap-4">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Field label="New password" htmlFor="password" hint="At least 10 characters.">
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm">
          <PasswordInput
            id="confirm"
            name="confirm"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </Field>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? <Spinner /> : null}
          Save new password
        </Button>
      </form>
    </>
  );
}
