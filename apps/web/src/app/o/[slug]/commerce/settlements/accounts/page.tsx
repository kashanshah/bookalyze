import {
  accountTypes,
  can,
  fiscalYearFor,
  SETTLEMENT_ACCOUNT_KEYS,
  type SettlementAccountKey,
  type SettlementAccounts,
} from "@bookalyze/core";
import { getSettlementAccounts, getSettlementSettings, schema } from "@bookalyze/db";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { nowIn } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { fiscalConfigOf, isOrgAdmin } from "@/server/org";
import { SettlementAccountsForm } from "./accounts-form";

export const metadata: Metadata = { title: "How settlements post" };

type Account = typeof schema.accounts.$inferSelect;

/**
 * Suggestions for a first setup, from the accounts' names and types: only suggestions, shown
 * for the person to check and save (posting never relies on names).
 */
function suggest(all: readonly Account[]): SettlementAccounts {
  const find = (type: Account["type"], pattern: RegExp, subtype?: string) =>
    all.find((a) => a.type === type && (!subtype || a.subtype === subtype) && pattern.test(a.name))
      ?.id;
  const sales = find("income", /amazon.*(sales|payout)/i) ?? find("income", /^sales$/i);
  const clearing =
    find("asset", /amazon/i, "money_in_transit") ?? find("asset", /./, "money_in_transit");
  return {
    sales,
    refunds: sales,
    promotions: sales,
    reimbursements: find("income", /other income/i) ?? sales,
    fees: find("expense", /amazon.*fee/i) ?? find("expense", /fee/i),
    advertising: find("expense", /amazon.*advert/i) ?? find("expense", /advert/i),
    tax: find("liability", /tax|gst|hst|vat/i) ?? clearing,
    reserve: clearing,
    other: clearing,
    clearing,
  };
}

export default async function SettlementAccountsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const { saved, settings, all } = await inOrg(ctx, async (tx) => ({
    saved: await getSettlementAccounts(tx),
    settings: await getSettlementSettings(tx),
    all: await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.isArchived, false))
      .orderBy(schema.accounts.code, schema.accounts.name),
  }));
  const firstTime = !settings.postFrom;
  const initial = firstTime ? suggest(all) : saved;
  const today = nowIn(ctx.profile.timezone).date;
  const fy = fiscalYearFor(today, fiscalConfigOf(ctx.profile));
  const options = all.map((a) => ({
    value: a.id,
    label: a.code ? `${a.code} · ${a.name}` : a.name,
    group: accountTypes[a.type].label,
    type: a.type,
  }));

  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/commerce/settlements`}
        className="-mb-2 inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Settlements
      </Link>
      <PageHeader
        eyebrow="Commerce"
        title="How settlements post"
        description="Each settlement goes into your books as one entry: every kind of amount to the account you choose here, and the payout to a clearing account until it reaches your bank."
      />
      <SettlementAccountsForm
        slug={slug}
        keys={SETTLEMENT_ACCOUNT_KEYS as SettlementAccountKey[]}
        initial={Object.fromEntries(SETTLEMENT_ACCOUNT_KEYS.map((k) => [k, initial[k] ?? ""]))}
        postFrom={settings.postFrom ?? fy.start}
        autoPost={settings.autoPost}
        options={options}
        suggested={firstTime}
        canManage={isOrgAdmin(ctx)}
        locale={ctx.profile.locale}
      />
    </div>
  );
}
