import {
  type AccountType,
  accountTypes,
  can,
  EBAY_ACCOUNT_HINTS,
  EBAY_ACCOUNT_KEYS,
  EBAY_ACCOUNT_LABELS,
  type EbayAccountKey,
  type EbayAccounts,
} from "@bookalyze/core";
import { getEbayAccounts, getEbaySettings, schema } from "@bookalyze/db";
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
import { saveEbaySetupAction } from "../actions";

export const metadata: Metadata = { title: "How eBay posts" };

type Account = typeof schema.accounts.$inferSelect;

/** The type and purpose a new account opens with, for this line. */
const NEW_ACCOUNT: Record<EbayAccountKey, { type: AccountType; subtype: string }> = {
  sales: { type: "income", subtype: "income" },
  refunds: { type: "income", subtype: "income" },
  fees: { type: "expense", subtype: "payment_processing_fee" },
  advertising: { type: "expense", subtype: "operating_expense" },
  shipping: { type: "expense", subtype: "operating_expense" },
  credits: { type: "income", subtype: "other_income" },
  other: { type: "expense", subtype: "operating_expense" },
  transfers: { type: "asset", subtype: "money_in_transit" },
  balance: { type: "asset", subtype: "money_in_transit" },
};

/**
 * Suggestions for a first setup, from the accounts' names and types: only suggestions, shown
 * for the person to check and save (posting never relies on names).
 */
function suggest(all: readonly Account[]): EbayAccounts {
  const find = (type: Account["type"], pattern: RegExp) =>
    all.find((a) => a.type === type && pattern.test(a.name))?.id;
  const sales = find("income", /ebay/i) ?? find("income", /^sales$/i);
  const fees = find("expense", /ebay.*(fee|commission)/i) ?? find("expense", /fee|commission/i);
  return {
    sales,
    refunds: sales,
    fees,
    advertising: find("expense", /ebay.*advert/i) ?? find("expense", /advert/i),
    shipping: find("expense", /shipping|postage|delivery/i),
    credits: sales,
    other: fees,
    balance: find("asset", /ebay/i),
  };
}

export default async function EbayAccountsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { saved, settings, all, first } = await inOrg(ctx, async (tx) => ({
    saved: await getEbayAccounts(tx),
    settings: await getEbaySettings(tx),
    all: await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.isArchived, false))
      .orderBy(schema.accounts.code, schema.accounts.name),
    first: (
      await tx
        .select({ day: sql<string | null>`min(${schema.ebayTransactions.transactionDate})::text` })
        .from(schema.ebayTransactions)
    )[0]?.day,
  }));
  const firstTime = !settings.postFrom;
  const initial = firstTime ? suggest(all) : saved;
  // By default from eBay's first month: the books get every eBay row.
  const startMonth = `${(first ?? nowIn(ctx.profile.timezone).date).slice(0, 7)}-01`;
  const options = all.map((a) => ({
    value: a.id,
    label: a.code ? `${a.code} · ${a.name}` : a.name,
    group: accountTypes[a.type].label,
    type: a.type,
  }));

  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/ebay`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        eBay money
      </Link>
      <PageHeader
        eyebrow="Commerce"
        title="How eBay posts"
        description="Each eBay site's month goes into your books as one entry: sales, fees, advertising and shipping labels to the accounts you choose here, and the net to your eBay balance. Each payout then moves from the eBay balance to your bank when it's matched to the deposit."
      />
      <PostingAccountsForm
        slug={slug}
        idPrefix="ebay"
        keys={EBAY_ACCOUNT_KEYS}
        labels={EBAY_ACCOUNT_LABELS}
        hints={EBAY_ACCOUNT_HINTS}
        newAccount={NEW_ACCOUNT}
        clearingKey="balance"
        clearingHint="The eBay balance has to be an asset, such as money in transit."
        initial={Object.fromEntries(EBAY_ACCOUNT_KEYS.map((k) => [k, initial[k] ?? ""]))}
        postFrom={settings.postFrom ?? startMonth}
        postFromField={{
          label: "Post eBay from",
          hint: "Months from this one go into the books, and payouts from it are matched. Earlier ones stay out: your books have those already.",
          month: true,
        }}
        autoPost={settings.autoPost}
        autoPostField={{
          label: "Post eBay automatically",
          hint: "Every evening, new rows and payouts come in from eBay, each month posts once it's over (and again when eBay changes it), and a payout is matched to its deposit when exactly one deposit of that amount, in that currency, is uncategorized or in your eBay sales account.",
        }}
        options={options}
        suggested={firstTime}
        canManage={isOrgAdmin(ctx)}
        locale={ctx.profile.locale}
        save={saveEbaySetupAction}
        savedDescription="eBay posts with these accounts from now on."
        doneHref={`/o/${slug}/commerce/ebay`}
      />
    </div>
  );
}
