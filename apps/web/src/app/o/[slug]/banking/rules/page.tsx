import { isMoneyAccountSubtype } from "@bookalyze/core";
import { contactOptions, listRules } from "@bookalyze/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { accountOptions, getBankingContext, inOrg, listAccounts } from "@/server/accounting";
import { RulesList } from "./rules-list";
import type { RuleFormContext, RuleView } from "./types";

export const metadata: Metadata = { title: "Rules" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ text?: string; category?: string; account?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getBankingContext(slug);
  const accounts = await listAccounts(ctx);
  const { rules, contacts } = await inOrg(ctx, async (tx) => ({
    rules: await listRules(tx),
    contacts: await contactOptions(tx),
  }));

  const name = (id: string | null) => {
    const a = accounts.find((x) => x.id === id);
    return a ? (a.code ? `${a.code} · ${a.name}` : a.name) : "";
  };
  const form: RuleFormContext = {
    slug,
    currency: ctx.profile.baseCurrency,
    locale: ctx.profile.locale,
    moneyAccounts: accounts
      .filter((a) => isMoneyAccountSubtype(a.subtype) && !a.isArchived)
      .map((a) => ({ id: a.id, label: name(a.id) })),
    categories: accountOptions(accounts.filter((a) => !isMoneyAccountSubtype(a.subtype))).map(
      (g) => ({ type: g.type, options: g.options.map((o) => ({ id: o.id, label: o.label })) }),
    ),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name })),
  };
  const views: RuleView[] = rules.map((r) => ({
    id: r.id,
    matchText: r.matchText,
    direction: r.direction,
    amountMin: r.amountMin,
    amountMax: r.amountMax,
    accountId: r.accountId,
    accountName: r.accountId ? name(r.accountId) : null,
    categoryAccountId: r.categoryAccountId,
    categoryName: name(r.categoryAccountId) || "A removed account",
    contactId: r.contactId,
    contactName: contacts.find((c) => c.id === r.contactId)?.name ?? null,
    isActive: r.isActive,
    applied: r.applied,
  }));
  // "Make a rule" from a transaction opens the form filled in.
  const prefill =
    sp.text || sp.category
      ? {
          matchText: (sp.text ?? "").slice(0, 200),
          categoryAccountId: sp.category && UUID.test(sp.category) ? sp.category : "",
          accountId: sp.account && UUID.test(sp.account) ? sp.account : "",
        }
      : null;

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Banking"
        title="Rules"
        description="Categorize bank transactions as they arrive. Each one still waits for your review tick on the Transactions screen, so nothing is filed without you seeing it."
      />
      <RulesList rules={views} ctx={form} prefill={prefill} />
    </div>
  );
}
