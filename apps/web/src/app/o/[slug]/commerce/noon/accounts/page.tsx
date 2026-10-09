import {
  type AccountType,
  accountTypes,
  can,
  NOON_ACCOUNT_HINTS,
  NOON_ACCOUNT_KEYS,
  NOON_ACCOUNT_LABELS,
  type NoonAccountKey,
  type NoonAccounts,
} from "@bookalyze/core";
import { getNoonAccounts, getNoonSettings, schema } from "@bookalyze/db";
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
import { saveNoonSetupAction } from "../actions";

export const metadata: Metadata = { title: "How Noon posts" };

type Account = typeof schema.accounts.$inferSelect;

/** The type and purpose a new account opens with, for this line. */
const NEW_ACCOUNT: Record<NoonAccountKey, { type: AccountType; subtype: string }> = {
  sales: { type: "income", subtype: "income" },
  refunds: { type: "income", subtype: "income" },
  fees: { type: "expense", subtype: "payment_processing_fee" },
  advertising: { type: "expense", subtype: "operating_expense" },
  shippingCredits: { type: "income", subtype: "income" },
  subsidies: { type: "income", subtype: "other_income" },
  transfers: { type: "expense", subtype: "payment_processing_fee" },
  other: { type: "expense", subtype: "operating_expense" },
  balance: { type: "asset", subtype: "money_in_transit" },
};

/**
 * Suggestions for a first setup, from the accounts' names and types: only suggestions, shown
 * for the person to check and save (posting never relies on names).
 */
function suggest(all: readonly Account[]): NoonAccounts {
  const find = (type: Account["type"], pattern: RegExp, subtype?: string) =>
    all.find((a) => a.type === type && (!subtype || a.subtype === subtype) && pattern.test(a.name))
      ?.id;
  const sales = find("income", /noon/i) ?? find("income", /^sales$/i);
  const fees = find("expense", /noon.*(fee|commission)/i) ?? find("expense", /fee|commission/i);
  return {
    sales,
    refunds: sales,
    fees,
    advertising: find("expense", /noon.*advert/i) ?? find("expense", /advert/i),
    shippingCredits: sales,
    subsidies: find("income", /noon.*subsid/i) ?? sales,
    transfers: find("expense", /noon/i) ?? fees,
    other: fees,
    balance: find("asset", /noon/i),
  };
}

export default async function NoonAccountsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { saved, settings, all, first } = await inOrg(ctx, async (tx) => ({
    saved: await getNoonAccounts(tx),
    settings: await getNoonSettings(tx),
    all: await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.isArchived, false))
      .orderBy(schema.accounts.code, schema.accounts.name),
    first: (
      await tx
        .select({ day: sql<string | null>`min(${schema.noonTransactions.transactionDate})::text` })
        .from(schema.noonTransactions)
    )[0]?.day,
  }));
  const firstTime = !settings.postFrom;
  const initial = firstTime ? suggest(all) : saved;
  // By default from Noon's first month: the books get every Noon row.
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
        href={`/o/${slug}/commerce/noon`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Noon transactions
      </Link>
      <PageHeader
        eyebrow="Commerce"
        title="How Noon posts"
        description="Each Noon country's month goes into your books as one entry: sales, fees, advertising and subsidies to the accounts you choose here, and the net to your Noon balance. Each payout then moves from the Noon balance to your bank when it's matched to the deposit."
      />
      <PostingAccountsForm
        slug={slug}
        idPrefix="noon"
        keys={NOON_ACCOUNT_KEYS}
        labels={NOON_ACCOUNT_LABELS}
        hints={NOON_ACCOUNT_HINTS}
        newAccount={NEW_ACCOUNT}
        clearingKey="balance"
        clearingHint="The Noon balance has to be an asset, such as money in transit."
        initial={Object.fromEntries(NOON_ACCOUNT_KEYS.map((k) => [k, initial[k] ?? ""]))}
        postFrom={settings.postFrom ?? startMonth}
        postFromField={{
          label: "Post Noon from",
          hint: "Months from this one go into the books, and payouts from it are matched. Earlier ones stay out: your books have those already.",
          month: true,
        }}
        options={options}
        suggested={firstTime}
        canManage={isOrgAdmin(ctx)}
        locale={ctx.profile.locale}
        save={saveNoonSetupAction}
        savedDescription="Noon posts with these accounts from now on."
        doneHref={`/o/${slug}/commerce/noon`}
      />
    </div>
  );
}
