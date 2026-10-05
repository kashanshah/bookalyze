import "server-only";
import { can } from "@bookalyze/core";
import { connectionSecretContext, openSecret, sealSecret } from "@bookalyze/db";
import { notFound } from "next/navigation";
import type { AmazonCredentials } from "./amazon";
import { env } from "./env";
import { getOrgContext, type OrgContext, type OrgProfile } from "./org";

export type CommerceContext = OrgContext & { profile: OrgProfile };

/** The context for Commerce pages and actions: the Commerce module must be on. */
export async function getCommerceContext(slug: string): Promise<CommerceContext> {
  const ctx = await getOrgContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.channels") || !ctx.profile) notFound();
  return ctx as CommerceContext;
}

/** Amazon credentials are kept sealed in the vault as one JSON value. */
export function sealAmazonCredentials(
  orgId: string,
  connectionId: string,
  creds: AmazonCredentials,
) {
  return sealSecret(
    JSON.stringify(creds),
    connectionSecretContext(orgId, connectionId),
    env().APP_ENCRYPTION_KEY,
  );
}

export function openAmazonCredentials(
  orgId: string,
  connectionId: string,
  sealed: string,
): AmazonCredentials {
  return JSON.parse(
    openSecret(sealed, connectionSecretContext(orgId, connectionId), env().APP_ENCRYPTION_KEY),
  ) as AmazonCredentials;
}
