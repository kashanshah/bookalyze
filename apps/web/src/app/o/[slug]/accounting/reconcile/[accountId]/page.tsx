import { formatMoney, isMoneyAccountSubtype } from "@bookalyze/core";
import { reconciliationHistory, reconciliationState, schema } from "@bookalyze/db";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { formatDate, nowIn } from "@/lib/dates";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { ReconcileScreen } from "./reconcile-screen";
import { StartReconciliation, UndoReconciliationButton } from "./start-form";

export const metadata: Metadata = { title: "Reconcile" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReconcileAccountPage({
  params,
}: {
  params: Promise<{ slug: string; accountId: string }>;
}) {
  const { slug, accountId } = await params;
  if (!UUID.test(accountId)) notFound();
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency } = ctx.profile;
  const data = await inOrg(ctx, async (tx) => {
    const [account] = await tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId));
    if (!account || !isMoneyAccountSubtype(account.subtype)) return null;
    const [open] = await tx
      .select({ id: schema.reconciliations.id })
      .from(schema.reconciliations)
      .where(
        and(
          eq(schema.reconciliations.accountId, accountId),
          eq(schema.reconciliations.status, "in_progress"),
        ),
      );
    const state = open ? await reconciliationState(tx, open.id) : null;
    const history = await reconciliationHistory(tx, accountId);
    return { account, state, history };
  });
  if (!data) notFound();
  const { account, state, history } = data;
  const currency = account.currency ?? baseCurrency;
  const title = account.code ? `${account.code} · ${account.name}` : account.name;
  const statementWord = account.subtype === "credit_card" ? "statement" : "bank statement";

  return (
    <div className="grid gap-6">
      <Link
        href={`/o/${slug}/accounting/reconcile`}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        All accounts
      </Link>
      <PageHeader eyebrow="Reconcile" title={title} />

      {state ? (
        <ReconcileScreen
          slug={slug}
          accountId={account.id}
          type={account.type}
          isCard={account.subtype === "credit_card"}
          currency={currency}
          locale={locale}
          reconciliation={{
            id: state.reconciliation.id,
            statementDate: state.reconciliation.statementDate,
            statementBalance: state.reconciliation.statementBalance,
          }}
          opening={state.totals.opening}
          lines={state.lines}
        />
      ) : (
        <StartReconciliation
          slug={slug}
          accountId={account.id}
          statementWord={statementWord}
          today={nowIn(ctx.profile.timezone).date}
          after={history[0]?.statementDate ?? null}
          locale={locale}
          currency={currency}
        />
      )}

      {history.length ? (
        <section className="grid gap-3">
          <h2 className="font-semibold tracking-tight">Past reconciliations</h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
            {history.map((r, i) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
              >
                <div>
                  <p className="font-medium text-sm">
                    Statement of {formatDate(r.statementDate, locale, "long")}
                  </p>
                  <p className="tabular text-muted-foreground text-xs">
                    Ending balance {formatMoney(r.statementBalance, currency, locale)}
                    {r.completedAt
                      ? ` · finished ${formatDate(r.completedAt.toISOString().slice(0, 10), locale)}`
                      : ""}
                  </p>
                </div>
                {i === 0 && !state ? <UndoReconciliationButton slug={slug} id={r.id} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
