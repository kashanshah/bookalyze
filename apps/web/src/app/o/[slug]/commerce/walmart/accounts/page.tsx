import {
  type AccountType,
  accountTypes,
  can,
  WALMART_ACCOUNT_HINTS,
  WALMART_ACCOUNT_KEYS,
  WALMART_ACCOUNT_LABELS,
  type WalmartAccountKey,
  type WalmartAccounts,
} from "@bookalyze/core";
import { getWalmartAccounts, getWalmartSettings, schema } from "@bookalyze/db";
import { eq, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PostingAccountsForm } from "@/components/commerce/posting-accounts-form";
import { PageHeader } from "@/components/shell/page-header";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { saveWalmartSetupAction } from "../actions";

export const metadata: Metadata = { title: "How Walmart posts" };

type Account = typeof schema.accounts.$inferSelect;

/** The type and purpose a new account opens with, for this line. */
const NEW_ACCOUNT: Record<WalmartAccountKey, { type: AccountType; subtype: string }> = {
  sales: { type: "income", subtype: "income" },
  refunds: { type: "income", subtype: "income" },
  fees: { type: "expense", subtype: "payment_processing_fee" },
  fulfilment: { type: "expense", subtype: "operating_expense" },
  advertising: { type: "expense", subtype: "operating_expense" },
  shipping: { type: "expense", subtype: "operating_expense" },
  tax: { type: "liability", subtype: "sales_tax" },
  other: { type: "expense", subtype: "operating_expense" },
  balance: { type: "asset", subtype: "money_in_transit" },
};

/**
 * Suggestions for a first setup, from the accounts' names and types: only suggestions, shown
 * for the person to check and save (posting never relies on names).
 */
function suggest(all: readonly Account[]): WalmartAccounts {
  const find = (type: Account["type"], pattern: RegExp) =>
    all.find((a) => a.type === type && pattern.test(a.name))?.id;
  const sales = find("income", /walmart/i) ?? find("income", /^sales$/i);
  const fees = find("expense", /walmart.*(fee|commission)/i) ?? find("expense", /fee|commission/i);
  return {
    sales,
    refunds: sales,
    fees,
    fulfilment: find("expense", /wfs|fulfil/i) ?? fees,
    advertising: find("expense", /walmart.*advert/i) ?? find("expense", /advert/i),
    shipping: find("expense", /shipping|postage|delivery/i),
    tax: find("liability", /sales tax|gst|hst|vat/i),
    other: fees,
    balance: find("asset", /walmart/i),
  };
}

export default async function WalmartAccountsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { saved, settings, all, first } = await inOrg(ctx, async (tx) => ({
    saved: await getWalmartAccounts(tx),
    settings: await getWalmartSettings(tx),
    all: await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.isArchived, false))
      .orderBy(schema.accounts.code, schema.accounts.name),
    first: (
      await tx
        .select({
          day: sql<
            string | null
          >`min(coalesce(${schema.walmartSettlements.periodTo}, ${schema.walmartSettlements.reportDate}))::text`,
        })
        .from(schema.walmartSettlements)
    )[0]?.day,
  }));
  const firstTime = !settings.postFrom;
  const initial = firstTime ? suggest(all) : saved;
  const options = all.map((a) => ({
    value: a.id,
    label: a.code ? `${a.code} · ${a.name}` : a.name,
    group: accountTypes[a.type].label,
    type: a.type,
  }));

  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/walmart`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Walmart money
      </Link>
      <PageHeader
        eyebrow="Commerce"
        title="How Walmart posts"
        description="Each Walmart settlement goes into your books as one entry on its last day: sales, Walmart's fees, WFS fees and advertising to the accounts you choose here, and what Walmart owes you to your Walmart balance. Each payout then moves from the Walmart balance to your bank when it's matched to the deposit."
      />
      <PostingAccountsForm
        slug={slug}
        idPrefix="walmart"
        keys={WALMART_ACCOUNT_KEYS}
        labels={WALMART_ACCOUNT_LABELS}
        hints={WALMART_ACCOUNT_HINTS}
        newAccount={NEW_ACCOUNT}
        clearingKey="balance"
        clearingHint="The Walmart balance has to be an asset, such as money in transit."
        initial={Object.fromEntries(WALMART_ACCOUNT_KEYS.map((k) => [k, initial[k] ?? ""]))}
        postFrom={settings.postFrom ?? first ?? nowIn(ctx.profile.timezone).date}
        postFromField={{
          label: "Post Walmart from",
          hint: "Settlements ending on this day or later go into the books, and their payouts are matched. Earlier ones stay out: your books have those already.",
        }}
        autoPost={settings.autoPost}
        autoPostField={{
          label: "Post Walmart automatically",
          hint: "Every evening, new settlements come in from Walmart and each one that adds up to Walmart's payout posts (and again when Walmart corrects it). A payout is matched to its deposit when exactly one deposit of that amount, in that currency, is uncategorized or in your Walmart sales account.",
        }}
        options={options}
        suggested={firstTime}
        canManage={isOrgAdmin(ctx)}
        locale={ctx.profile.locale}
        save={saveWalmartSetupAction}
        savedDescription="Walmart posts with these accounts from now on."
        doneHref={`/o/${slug}/commerce/walmart`}
      />
    </div>
  );
}
