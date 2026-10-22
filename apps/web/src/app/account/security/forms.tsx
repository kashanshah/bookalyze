"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { PasswordRules, passwordReady } from "@/components/auth/password-rules";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { type SetPasswordState, setPasswordAction } from "./actions";

/**
 * Password card body. Owns the "set password" state so that when the page refreshes into
 * "change password" mode (the account now has a password) the success toast still fires.
 */
export function PasswordSection({
  hasPassword,
  email,
  name,
}: {
  hasPassword: boolean;
  /** The signed-in person: the rules keep their name and email out of the password. */
  email: string;
  name: string;
}) {
  const [password, setPassword] = useState("");
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(
    setPasswordAction,
    {},
  );
  useEffect(() => {
    if (state.done)
      toast.success(
        "Password set. You can now sign in with your email and password, or with Google.",
      );
  }, [state.done]);
  if (hasPassword) return <ChangePasswordForm email={email} name={name} />;
  return (
    <form action={action} className="grid max-w-sm gap-4">
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Field
        label="New password"
        htmlFor="password"
        hint={<PasswordRules id="password-rules" password={password} email={email} name={name} />}
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
      <Field label="Confirm password" htmlFor="confirm">
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? <Spinner /> : null}
        Set password
      </Button>
    </form>
  );
}

function ChangePasswordForm({ email, name }: { email: string; name: string }) {
  const [error, setError] = useState<string>();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const newPassword = String(form.get("newPassword"));
    if (!passwordReady(newPassword, { email, name })) {
      setError("Choose a password that meets every rule under it.");
      return;
    }
    if (newPassword !== String(form.get("confirm"))) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    setError(undefined);
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword")),
      newPassword,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) {
      setError(error.message ?? "Could not change your password.");
      return;
    }
    formEl.reset();
    setPassword("");
    toast.success("Password changed. You've been signed out on your other devices.");
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-sm gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Field label="Current password" htmlFor="currentPassword">
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field
        label="New password"
        htmlFor="newPassword"
        hint={
          <PasswordRules id="new-password-rules" password={password} email={email} name={name} />
        }
      >
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          aria-describedby="new-password-rules"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}

export function GoogleConnection({
  accountId,
  canDisconnect,
  error,
}: {
  /** The linked Google account's Better Auth id, if connected. */
  accountId?: string | undefined;
  canDisconnect: boolean;
  error?: string | undefined;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    error ? "Google couldn't be connected. Use the Google account with the same email." : undefined,
  );

  if (!accountId) {
    return (
      <div className="grid gap-3">
        {message ? <Alert variant="destructive">{message}</Alert> : null}
        <Button
          variant="outline"
          className="w-fit"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await authClient.linkSocial({ provider: "google", callbackURL: "/account/security" });
          }}
        >
          Connect Google
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {message ? <Alert variant="destructive">{message}</Alert> : null}
      <Button
        variant="outline"
        className="w-fit"
        disabled={!canDisconnect || pending}
        title={canDisconnect ? undefined : "Set a password first so you can still sign in."}
        onClick={async () => {
          setPending(true);
          const { error } = await authClient.unlinkAccount({ accountId });
          setPending(false);
          if (error) setMessage(error.message ?? "Could not disconnect Google.");
          else router.refresh();
        }}
      >
        Disconnect Google
      </Button>
      {!canDisconnect ? (
        <p className="text-muted-foreground text-xs">
          Set a password first so you can still sign in without Google.
        </p>
      ) : null}
    </div>
  );
}
