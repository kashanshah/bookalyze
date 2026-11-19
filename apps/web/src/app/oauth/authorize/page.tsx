import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { type AuthorizeParams, checkAuthorizeRequest, returnPlace } from "@/server/oauth-request";
import { listUserOrgs } from "@/server/org";
import { requireSession } from "@/server/session";
import { Consent } from "./consent";

export const metadata: Metadata = { title: "Connect an app", robots: { index: false } };

const KEYS: (keyof AuthorizeParams)[] = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
];

/**
 * "Sign in with Bookalyze": an app such as Claude Code asks for access, and the person chooses
 * what it may do, in which companies and for how long. Approving sends a one-time code back to
 * the app (see server/oauth.ts).
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params: AuthorizeParams = {};
  for (const key of KEYS) {
    const value = raw[key];
    if (typeof value === "string") params[key] = value;
  }
  const request = await checkAuthorizeRequest(params);
  if (!request.ok) {
    if ("redirect" in request) redirect(request.redirect);
    return (
      <Card>
        <CardContent className="flex gap-3 py-6">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="grid gap-1">
            <h1 className="font-semibold">This link can't be used</h1>
            <p className="text-muted-foreground text-sm">{request.show}</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  const query = new URLSearchParams(params as Record<string, string>).toString();
  const session = await requireSession(`/oauth/authorize?${query}`);
  const orgs = await listUserOrgs(session.user.id);
  return (
    <Consent
      params={params}
      appName={request.client.name}
      returnsTo={returnPlace(request.redirectUri)}
      email={session.user.email}
      wantsWrite={request.wantsWrite}
      companies={orgs.map((o) => ({ id: o.id, name: o.name }))}
    />
  );
}
