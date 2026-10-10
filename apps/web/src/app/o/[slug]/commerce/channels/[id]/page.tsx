import { can, isFulfilmentMode, noonReportInputs } from "@bookalyze/core";
import {
  getChannel,
  getEbayConnection,
  getNoonConnection,
  listAmazonConnections,
} from "@bookalyze/db";
import { ArrowLeft, ArrowRight, BookCheck, ListOrdered, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { ebayApp } from "@/server/ebay";
import { isOrgAdmin } from "@/server/org";
import { AmazonAccount } from "../amazon";
import { EbayAccount, EbayConnectNotice } from "../ebay";
import { NoonAccount, type NoonConnectionView, NoonFulfilment } from "../noon";
import { PLATFORMS } from "../platforms";
import { ChannelSwitch } from "./channel-settings";

export const metadata: Metadata = { title: "Channel" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One channel's own page: switch it on or off, its platform's settings (who ships a Noon
 * country's orders…), and the account behind it with its credentials.
 */
export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  /** `ebay` (connected, declined, failed) and `message`: eBay's callback sending the admin back. */
  searchParams: Promise<{ ebay?: string; message?: string }>;
}) {
  const { slug, id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const ctx = await getCommerceContext(slug);
  const data = await inOrg(ctx, async (tx) => {
    const channel = await getChannel(tx, id);
    if (!channel) return null;
    return {
      channel,
      amazon:
        channel.kind === "amazon"
          ? ((await listAmazonConnections(tx)).find((c) => c.id === channel.connectionId) ?? null)
          : null,
      noon: channel.kind === "noon" ? await getNoonConnection(tx) : null,
      ebay: channel.kind === "ebay" ? await getEbayConnection(tx) : null,
    };
  });
  if (!data) notFound();
  const { channel: ch } = data;
  // A disconnected Amazon account's marketplaces are hidden, like its orders.
  if (ch.kind === "amazon" && (!data.amazon || data.amazon.status === "disconnected")) notFound();

  const { locale } = ctx.profile;
  const canManage = isOrgAdmin(ctx);
  const base = `/o/${slug}/commerce`;
  const platform = PLATFORMS[ch.kind];
  const country = ch.country
    ? (new Intl.DisplayNames(locale, { type: "region" }).of(ch.country) ?? ch.country)
    : null;
  const money = can(ctx.plan, ctx.enabledModules, "commerce.settlements");

  return (
    <div className="grid gap-6">
      <Link
        href={`${base}/channels`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        All channels
      </Link>
      <PageHeader
        eyebrow={platform.label}
        title={ch.name}
        description={[country, ch.currency, ch.isActive ? null : "Switched off"]
          .filter(Boolean)
          .join(" · ")}
        actions={
          ch.kind === "ebay" ? null : (
            <Button variant="outline" asChild>
              <Link href={`${base}/orders?channel=${ch.id}`}>
                <ListOrdered />
                Its orders
              </Link>
            </Button>
          )
        }
      />

      <section
        aria-labelledby="channel-heading"
        className="fade-in-0 grid animate-in gap-5 rounded-2xl border bg-card px-5 py-5 shadow-xs"
      >
        <div>
          <h2 id="channel-heading" className="font-semibold">
            This channel
          </h2>
          <p className="text-muted-foreground text-sm">
            {ch.kind === "ebay"
              ? "You ship eBay orders yourself."
              : ch.kind === "noon"
                ? "Noon country settings."
                : "Amazon marketplace settings."}
          </p>
        </div>
        <ChannelSwitch
          slug={slug}
          channel={ch}
          canManage={canManage}
          label={ch.kind === "amazon" ? `Bring in orders from ${ch.name}` : `Use ${ch.name}`}
          hint={
            ch.kind === "amazon"
              ? "Switched on, its orders come in by themselves. Switched off, it keeps everything brought in so far."
              : "Switch it off if you stop selling there. It keeps everything brought in so far."
          }
        />
        {ch.kind === "noon" ? (
          <div className="max-w-sm">
            <NoonFulfilment
              slug={slug}
              canManage={canManage}
              channel={{
                id: ch.id,
                name: ch.name,
                fulfilment: ch.fulfilment && isFulfilmentMode(ch.fulfilment) ? ch.fulfilment : null,
              }}
            />
          </div>
        ) : null}
      </section>

      {ch.kind === "amazon" && data.amazon ? (
        <AmazonAccount
          slug={slug}
          locale={locale}
          canManage={canManage}
          channelId={ch.id}
          connection={{
            id: data.amazon.id,
            name: data.amazon.name,
            status: data.amazon.status,
            region: String(data.amazon.settings.region ?? ""),
            storeName:
              typeof data.amazon.settings.storeName === "string"
                ? data.amazon.settings.storeName
                : null,
            lastSyncedAt: data.amazon.lastSyncedAt?.toISOString() ?? null,
            lastError: data.amazon.lastError,
            channels: data.amazon.channels.map((c) => ({
              id: c.id,
              name: c.name,
              country: c.country,
              currency: c.currency,
              isActive: c.isActive,
            })),
          }}
        />
      ) : null}

      {ch.kind === "noon" ? (
        <>
          <NoonAccount
            slug={slug}
            locale={locale}
            canManage={canManage}
            country={ch.country}
            connection={noonView(data.noon)}
          />
          {money ? (
            <nav
              aria-label="Noon in your books"
              className="overflow-hidden rounded-2xl border bg-card shadow-xs"
            >
              <LinkRow
                href={`${base}/noon`}
                icon={<ReceiptText />}
                title="Noon transactions"
                text="Every sale, fee and subsidy Noon paid or charged, month by month: bring in the past year from Noon's API, or upload the transaction view."
              />
              <LinkRow
                href={`${base}/noon/accounts`}
                icon={<BookCheck />}
                title="How Noon posts"
                text="The accounts each kind of Noon line goes to, and when posting starts."
              />
            </nav>
          ) : null}
        </>
      ) : null}

      {ch.kind === "ebay" ? (
        <>
          <EbayAccount
            slug={slug}
            locale={locale}
            canManage={canManage}
            channelId={ch.id}
            configured={Boolean(ebayApp())}
            connection={
              data.ebay
                ? {
                    status: data.ebay.status,
                    username:
                      typeof data.ebay.settings.username === "string"
                        ? data.ebay.settings.username
                        : null,
                    marketplace:
                      typeof data.ebay.settings.marketplace === "string"
                        ? data.ebay.settings.marketplace
                        : null,
                    lastSyncedAt: data.ebay.lastSyncedAt?.toISOString() ?? null,
                    lastError: data.ebay.lastError,
                  }
                : null
            }
          />
          <EbayConnectNotice
            result={sp.ebay ?? null}
            message={typeof sp.message === "string" ? sp.message : null}
          />
        </>
      ) : null}
    </div>
  );
}

function LinkRow({
  href,
  icon,
  title,
  text,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 border-b px-5 py-3.5 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
    >
      <span className="shrink-0 text-primary [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{title}</span>
        <span className="block text-muted-foreground text-xs">{text}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
    </Link>
  );
}

function noonView(c: Awaited<ReturnType<typeof getNoonConnection>>): NoonConnectionView | null {
  if (!c) return null;
  const reports = Array.isArray(c.settings.reports)
    ? c.settings.reports.filter((r): r is string => typeof r === "string")
    : [];
  const params =
    c.settings.reportParams && typeof c.settings.reportParams === "object"
      ? (c.settings.reportParams as Record<string, unknown>)
      : {};
  return {
    status: c.status,
    projectCode: typeof c.settings.projectCode === "string" ? c.settings.projectCode : null,
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
    lastError: c.lastError,
    reports: reports.length,
    reportCodes: reports,
    reportInputs: Object.fromEntries(
      Object.entries(params).map(([code, spec]) => [code, noonReportInputs(spec)]),
    ),
    payoutsReport: c.settings.payoutsReport === true,
  };
}
