"use server";

import { createAuthorizationCode, getDb, listApiKeys, MAX_API_KEYS } from "@bookalyze/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentApiPrincipal } from "@/server/api/principal";
import { logInfo } from "@/server/log";
import { redirectWith } from "@/server/oauth";
import { type AuthorizeParams, checkAuthorizeRequest } from "@/server/oauth-request";
import { listUserOrgs } from "@/server/org";
import { requireSession } from "@/server/session";

const LIFETIME_DAYS = { "30": 30, "90": 90, "365": 365 } as const;

const choiceSchema = z.object({
  access: z.enum(["read", "write"]),
  companies: z.enum(["all", "chosen"]),
  organizationIds: z.array(z.uuid()).max(200),
  lifetime: z.enum(["30", "90", "365", "never"]),
});

export type ConsentChoice = z.input<typeof choiceSchema>;
export type ConsentResult =
  | { ok: true; redirect: string }
  | { ok: false; message?: string; errors?: Record<string, string> };

async function signedIn() {
  // Only a person in the browser approves apps; an API key can't connect more apps.
  if (currentApiPrincipal()) throw new Error("Apps are approved in the browser only.");
  return requireSession("/account/api-keys");
}

/** The person approved: a one-time code goes back to the app, which swaps it for tokens. */
export async function approveAction(
  params: AuthorizeParams,
  choice: ConsentChoice,
): Promise<ConsentResult> {
  const session = await signedIn();
  const request = await checkAuthorizeRequest(params);
  if (!request.ok) {
    return "redirect" in request
      ? { ok: true, redirect: request.redirect }
      : { ok: false, message: request.show };
  }
  const parsed = choiceSchema.safeParse(choice);
  if (!parsed.success) return { ok: false, message: "Choose what the app may do." };
  const value = parsed.data;
  let organizationIds: string[] | null = null;
  if (value.companies === "chosen") {
    const mine = new Set((await listUserOrgs(session.user.id)).map((o) => o.id));
    organizationIds = [...new Set(value.organizationIds)].filter((id) => mine.has(id));
    if (!organizationIds.length) {
      return { ok: false, errors: { organizationIds: "Choose at least one company." } };
    }
  }
  // Approving again replaces this app's earlier connection, so it doesn't count.
  const live = (await listApiKeys(getDb(), session.user.id)).filter(
    (k) => !k.revokedAt && k.clientId !== request.client.id,
  );
  if (live.length >= MAX_API_KEYS) {
    return {
      ok: false,
      message: `You have ${MAX_API_KEYS} API keys and connected apps already. Revoke one in Account → API keys first.`,
    };
  }
  const code = await createAuthorizationCode(getDb(), {
    clientId: request.client.id,
    userId: session.user.id,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    access: value.access,
    organizationIds,
    lifetimeDays: value.lifetime === "never" ? null : LIFETIME_DAYS[value.lifetime],
  });
  logInfo("oauth.approved", { clientId: request.client.id, access: value.access });
  revalidatePath("/account/api-keys");
  return {
    ok: true,
    redirect: redirectWith(request.redirectUri, {
      code,
      state: request.state,
      iss: request.origin,
    }),
  };
}

/** The person said no: the app hears access_denied. */
export async function denyAction(params: AuthorizeParams): Promise<ConsentResult> {
  await signedIn();
  const request = await checkAuthorizeRequest(params);
  if (!request.ok) {
    return "redirect" in request
      ? { ok: true, redirect: request.redirect }
      : { ok: false, message: request.show };
  }
  return {
    ok: true,
    redirect: redirectWith(request.redirectUri, {
      error: "access_denied",
      error_description: "The person didn't allow access.",
      state: request.state,
      iss: request.origin,
    }),
  };
}
