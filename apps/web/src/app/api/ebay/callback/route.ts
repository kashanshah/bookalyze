import {
  attachEbayChannels,
  createConnection,
  getChannel,
  getEbayConnection,
  recordConnectionSync,
  schema,
  setConnectionSecret,
} from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { inOrg } from "@/server/accounting";
import { audit } from "@/server/audit";
import { getCommerceContext } from "@/server/commerce";
import {
  EBAY_STATE_COOKIE,
  EbayError,
  exchangeEbayCode,
  getEbayUser,
  readEbayState,
  sealEbayCredentials,
} from "@/server/ebay";
import { logWarn } from "@/server/log";
import { isOrgAdmin } from "@/server/org";

/**
 * Where eBay sends a seller back after its consent page (the RuName's "auth accepted" and
 * "declined" URLs both point here). The state must be ours, unexpired, from this browser (its
 * cookie) and from the signed-in admin who asked. The code becomes the account's tokens: the
 * refresh token is sealed in the vault, and the company's eBay sites go on the connection.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const jar = await cookies();
  const nonce = jar.get(EBAY_STATE_COOKIE)?.value;
  jar.delete(EBAY_STATE_COOKIE);
  const state = readEbayState(url.searchParams.get("state"));
  if (!state || !nonce || nonce !== state.nonce) {
    logWarn("ebay.callback_state_refused", { hasState: Boolean(state), hasCookie: Boolean(nonce) });
    return NextResponse.redirect(new URL("/", request.url));
  }
  const back = (result: "connected" | "declined" | "failed", message?: string) => {
    const to = new URL(`/o/${state.slug}/commerce/channels/${state.channelId}`, request.url);
    to.searchParams.set("ebay", result);
    if (message) to.searchParams.set("message", message.slice(0, 300));
    return NextResponse.redirect(to);
  };

  const ctx = await getCommerceContext(state.slug);
  if (ctx.session.user.id !== state.userId || !isOrgAdmin(ctx)) {
    return back("failed", "Only the owner or admin who started connecting can finish it.");
  }
  if (url.searchParams.get("error")) return back("declined");
  const code = url.searchParams.get("code");
  if (!code) return back("failed", "eBay didn't send a sign-in code. Connect eBay again.");

  try {
    const tokens = await exchangeEbayCode(code);
    if (!tokens.refreshToken) {
      return back("failed", "eBay didn't send a lasting sign-in. Connect eBay again.");
    }
    const user = await getEbayUser(tokens.accessToken);
    const refreshTokenExpiresAt = tokens.refreshTokenExpiresIn
      ? new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000).toISOString()
      : null;
    const settings = {
      userId: user.userId,
      username: user.username,
      accountType: user.accountType,
      marketplace: user.registrationMarketplaceId,
      refreshTokenExpiresAt,
    };
    const name = `eBay · ${user.username}`;
    const found = await inOrg(ctx, async (tx) => {
      const channel = await getChannel(tx, state.channelId);
      if (!channel || channel.kind !== "ebay") return false;
      const existing = await getEbayConnection(tx);
      const id =
        existing?.id ??
        (
          await createConnection(tx, {
            orgId: ctx.org.id,
            userId: ctx.session.user.id,
            provider: "ebay",
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
        sealEbayCredentials(ctx.org.id, id, {
          refreshToken: tokens.refreshToken ?? "",
          refreshTokenExpiresAt,
        }),
      );
      await attachEbayChannels(tx, id);
      await recordConnectionSync(tx, id, { at: new Date(), error: null });
      await audit(tx, {
        orgId: ctx.org.id,
        actorUserId: ctx.session.user.id,
        action: existing ? "connection.credentials_replaced" : "connection.created",
        entityType: "connection",
        entityId: id,
        after: { provider: "ebay", username: user.username, marketplace: settings.marketplace },
      });
      return true;
    });
    if (!found) return back("failed", "That eBay site isn't one of this company's channels.");
    return back("connected");
  } catch (error) {
    if (error instanceof EbayError) return back("failed", error.message);
    throw error;
  }
}
