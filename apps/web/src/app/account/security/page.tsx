import { KeyRound, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuth } from "@/server/auth";
import { isGoogleEnabled } from "@/server/env";
import { requireSession } from "@/server/session";
import { GoogleConnection, PasswordSection } from "./forms";

export const metadata: Metadata = { title: "Account & security" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireSession("/account/security");
  const { error } = await searchParams;
  const requestHeaders = await headers();
  const accounts = await getAuth().api.listUserAccounts({ headers: requestHeaders });
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const googleAccount = accounts.find((a) => a.providerId === "google");
  const hasGoogle = Boolean(googleAccount);

  return (
    <>
      <div className="flex items-center gap-4">
        <Avatar name={session.user.name} className="size-12 text-sm" />
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Account & security</h1>
          <p className="mt-0.5 text-muted-foreground text-sm">
            {session.user.name} · {session.user.email}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            Password
            {hasPassword ? (
              <Badge variant="success">Set</Badge>
            ) : (
              <Badge variant="outline">Not set</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {hasPassword
              ? "Change the password you use to sign in with your email address."
              : "You signed up with Google. Set a password to also sign in with your email address and password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordSection hasPassword={hasPassword} />
        </CardContent>
      </Card>

      {isGoogleEnabled() || hasGoogle ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Google
              {hasGoogle ? (
                <Badge variant="success">Connected</Badge>
              ) : (
                <Badge variant="outline">Not connected</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {hasGoogle
                ? "You can sign in with Google."
                : `Connect the Google account for ${session.user.email} to sign in with one click.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoogleConnection
              accountId={googleAccount?.id}
              canDisconnect={hasPassword}
              error={error}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            Two-step verification <Badge variant="outline">Coming soon</Badge>
          </CardTitle>
          <CardDescription>
            Authenticator-app codes for an extra layer of protection.
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}
