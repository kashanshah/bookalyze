import { AMAZON_ADS_REGIONS } from "@bookalyze/core";
import {
  createConnection,
  getChannel,
  listAmazonAdsConnections,
  recordConnectionSync,
  schema,
  setConnectionSecret,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { after, type NextRequest, NextResponse } from "next/server";
import { inOrg } from "@/server/accounting";
import {
  AMAZON_ADS_STATE_COOKIE,
  AmazonAdsError,
  amazonAdsProfiles,
  exchangeAmazonAdsCode,
  readAmazonAdsState,
  sealAmazonAdsCredentials,
} from "@/server/amazon-ads";
import { syncAmazonAdsConnection } from "@/server/amazon-ads-sync";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import { logWarn } from "@/server/log";
import { isOrgAdmin } from "@/server/org";

/**
 * Where Amazon sends an admin back after its consent page for Amazon Ads. The state must be ours,
 * unexpired, from this browser (its cookie) and from the signed-in admin who asked. The code
 * becomes the account's refresh token, sealed in the vault on the company's Ads connection for
 * that region, with the ads profiles Amazon lists; the first reports are asked for straight away.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const jar = await cookies();
  const nonce = jar.get(AMAZON_ADS_STATE_COOKIE)?.value;
  jar.delete(AMAZON_ADS_STATE_COOKIE);
  const state = readAmazonAdsState(url.searchParams.get("state"));
  if (!state || !nonce || nonce !== state.nonce) {
    logWarn("amazon_ads.callback_state_refused", {
      hasState: Boolean(state),
      hasCookie: Boolean(nonce),
    });
    return NextResponse.redirect(new URL("/", request.url));
  }
  const back = (result: "connected" | "declined" | "failed", message?: string) => {
    const to = new URL(`/o/${state.slug}/commerce/channels/${state.channelId}`, request.url);
    to.searchParams.set("ads", result);
    if (message) to.searchParams.set("message", message.slice(0, 300));
    return NextResponse.redirect(to);
  };

  const ctx = await getCommerceContext(state.slug);
  if (ctx.session.user.id !== state.userId || !isOrgAdmin(ctx)) {
    return back("failed", "Only the owner or admin who started connecting can finish it.");
  }
  if (url.searchParams.get("error")) return back("declined");
  const code = url.searchParams.get("code");
  if (!code) return back("failed", "Amazon didn't send a sign-in code. Connect Amazon Ads again.");

  try {
    const tokens = await exchangeAmazonAdsCode(state.region, code);
    if (!tokens.refreshToken) {
      return back("failed", "Amazon didn't send a lasting sign-in. Connect Amazon Ads again.");
    }
    const profiles = await amazonAdsProfiles({
      region: state.region,
      refreshToken: tokens.refreshToken,
    });
    const settings = { region: state.region, profiles };
    const name = `Amazon Ads · ${AMAZON_ADS_REGIONS[state.region].label}`;
    const saved = await inOrg(ctx, async (tx) => {
      const channel = await getChannel(tx, state.channelId);
      if (channel?.kind !== "amazon") return null;
      const existing = (await listAmazonAdsConnections(tx)).find(
        (c) => c.settings.region === state.region,
      );
      const id =
        existing?.id ??
        (
          await createConnection(tx, {
            orgId: ctx.org.id,
            userId: ctx.session.user.id,
            provider: "amazon_ads",
            name,
            settings,
          })
        ).id;
      if (existing) {
        await tx
          .update(schema.connections)
          .set({ settings, name, status: "active" })
          .where(eq(schema.connections.id, id));
      }
      await setConnectionSecret(
        tx,
        id,
        sealAmazonAdsCredentials(ctx.org.id, id, { refreshToken: tokens.refreshToken ?? "" }),
      );
      await recordConnectionSync(tx, id, { at: new Date(), error: null });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: existing ? "connection.credentials_replaced" : "connection.created",
        entityType: "connection",
        entityId: id,
        after: {
          provider: "amazon_ads",
          region: state.region,
          profiles: profiles.map((p) => ({ country: p.countryCode, type: p.accountType })),
        },
      });
      return { id, matches: profiles.some((p) => p.marketplaceId === channel.marketplaceId) };
    });
    if (!saved) return back("failed", "That marketplace isn't one of this company's channels.");
    // Ask for the first reports once the admin is back on the page.
    after(() =>
      syncAmazonAdsConnection({ orgId: ctx.org.id, userId: null }, saved.id, {
        requestNew: true,
        deadline: Date.now() + 25_000,
      }).catch((error) =>
        logWarn(
          "amazon_ads.first_sync_failed",
          { orgId: ctx.org.id, connectionId: saved.id },
          error,
        ),
      ),
    );
    if (!saved.matches) {
      return back(
        "failed",
        "Connected, but this login has no ads account for this marketplace. Connect again with the login you use in Campaign Manager for it.",
      );
    }
    return back("connected");
  } catch (error) {
    if (error instanceof AmazonAdsError) return back("failed", error.message);
    throw error;
  }
}
