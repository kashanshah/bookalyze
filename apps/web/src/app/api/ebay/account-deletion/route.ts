import { parseEbayDeletionNotice } from "@bookalyze/core";
import { forgetEbayUser, getDb, schema, withOrg } from "@bookalyze/db";
import { type NextRequest, NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { ebayApp, ebayChallengeResponse, verifyEbayNotice } from "@/server/ebay";
import { logError, logInfo, logWarn } from "@/server/log";

/**
 * eBay's marketplace account-deletion notices (required for apps that keep eBay user data). GET
 * answers eBay's endpoint check; POST, once its signature checks out, disconnects every
 * company's connection to that eBay user and forgets the user's eBay name and id.
 */
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get("challenge_code");
  const answer = challenge ? ebayChallengeResponse(challenge) : null;
  if (!answer) return NextResponse.json({ error: "Not set up" }, { status: 404 });
  return NextResponse.json({ challengeResponse: answer });
}

export async function POST(request: NextRequest) {
  if (!ebayApp()) return NextResponse.json({ error: "Not set up" }, { status: 404 });
  const body = await request.text();
  if (!(await verifyEbayNotice(body, request.headers.get("x-ebay-signature")))) {
    // eBay's docs: 412 when the signature doesn't verify.
    return new NextResponse(null, { status: 412 });
  }
  let notice: ReturnType<typeof parseEbayDeletionNotice> = null;
  try {
    notice = parseEbayDeletionNotice(JSON.parse(body));
  } catch {
    notice = null;
  }
  if (!notice) {
    logWarn("ebay.notice_ignored", {});
    return new NextResponse(null, { status: 204 });
  }
  const { userId } = notice;
  // Every company is checked in its own withOrg(): nothing else is read outside it.
  const orgs = await getDb().select({ id: schema.organization.id }).from(schema.organization);
  let forgotten = 0;
  for (const org of orgs) {
    try {
      forgotten += await withOrg(getDb(), { orgId: org.id, userId: null }, async (tx) => {
        const count = await forgetEbayUser(tx, userId);
        if (count) {
          await audit(tx, {
            orgId: org.id,
            actorUserId: null,
            action: "connection.disconnected",
            entityType: "connection",
            after: { provider: "ebay", reason: "eBay account deleted" },
          });
        }
        return count;
      });
    } catch (error) {
      logError("ebay.notice_failed", error, { orgId: org.id });
    }
  }
  logInfo("ebay.account_deleted", { connections: forgotten });
  return new NextResponse(null, { status: 204 });
}
