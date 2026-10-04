import { getDb, schema } from "@bookalyze/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/server/session";
import { AcceptInvitationButton } from "./accept-button";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const [invite] = isUuid
    ? await getDb()
        .select({
          email: schema.invitation.email,
          status: schema.invitation.status,
          expiresAt: schema.invitation.expiresAt,
          orgName: schema.organization.name,
        })
        .from(schema.invitation)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.invitation.organizationId),
        )
        .where(eq(schema.invitation.id, id))
        .limit(1)
    : [];
  const session = await getSession();
  const valid = invite && invite.status === "pending" && invite.expiresAt > new Date();
  const here = `/accept-invitation/${id}`;

  let body: React.ReactNode;
  if (!valid) {
    body = (
      <CardHeader>
        <CardTitle>Invitation unavailable</CardTitle>
        <CardDescription>
          This invitation has expired, was cancelled, or was already used.
        </CardDescription>
      </CardHeader>
    );
  } else if (!session) {
    const q = `?redirect=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`;
    body = (
      <>
        <CardHeader>
          <CardTitle>Join {invite.orgName}</CardTitle>
          <CardDescription>
            Sign in or create an account with{" "}
            <strong className="text-foreground">{invite.email}</strong> to accept.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Button asChild>
            <Link href={`/sign-up${q}`}>Create account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/sign-in${q}`}>I already have an account</Link>
          </Button>
        </CardContent>
      </>
    );
  } else if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    body = (
      <CardHeader>
        <CardTitle>Wrong account</CardTitle>
        <CardDescription>
          This invitation is for {invite.email}, but you're signed in as {session.user.email}. Sign
          out and sign in with the invited email.
        </CardDescription>
      </CardHeader>
    );
  } else {
    body = (
      <>
        <CardHeader>
          <CardTitle>Join {invite.orgName}</CardTitle>
          <CardDescription>
            You've been invited to collaborate on {invite.orgName} in Bookalyze.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptInvitationButton invitationId={id} />
        </CardContent>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-sidebar px-4">
      <Brand className="h-9" />
      <Card className="w-full max-w-sm">{body}</Card>
    </div>
  );
}
