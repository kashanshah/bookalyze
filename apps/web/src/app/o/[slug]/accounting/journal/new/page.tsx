import { currencies } from "@bookalyze/core/reference-data";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { nowIn } from "@/lib/dates";
import { accountOptions, getAccountingContext, listAccounts } from "@/server/accounting";
import { JournalForm } from "./journal-form";

export const metadata: Metadata = { title: "New journal entry" };

export default async function NewJournalEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const accounts = await listAccounts(ctx);
  if (!accounts.length) redirect(`/o/${slug}/accounting/accounts`);
  const base = ctx.profile.baseCurrency;
  // The base currency and currencies the company's accounts use come first.
  const used = new Set([base, ...accounts.flatMap((a) => (a.currency ? [a.currency] : []))]);
  const currencyOptions = [
    ...currencies.filter((c) => used.has(c.code)),
    ...currencies.filter((c) => !used.has(c.code)),
  ].map((c) => ({ code: c.code, name: c.name }));

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Journal entries"
        title="New journal entry"
        description="Move amounts between accounts. Use it for opening balances, owner contributions, corrections and anything that isn't a bank transaction."
      />
      <JournalForm
        slug={slug}
        today={nowIn(ctx.profile.timezone).date}
        baseCurrency={base}
        locale={ctx.profile.locale}
        currencies={currencyOptions}
        accountGroups={accountOptions(accounts)}
      />
    </div>
  );
}
