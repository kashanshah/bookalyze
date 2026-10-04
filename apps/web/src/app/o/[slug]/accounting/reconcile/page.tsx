import { formatMoney, naturalAmount } from "@bookalyze/core";
import { listReconcilableAccounts, schema } from "@bookalyze/db";
import { inArray, sql } from "drizzle-orm";
import { ArrowRight, CheckCircle2, CircleDashed, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { getAccountingContext, inOrg } from "@/server/accounting";

export const metadata: Metadata = { title: "Reconcile" };

export default async function ReconcilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency } = ctx.profile;
  const { accounts, balances } = await inOrg(ctx, async (tx) => {
    const accounts = await listReconcilableAccounts(tx);
    const balances = accounts.length
      ? await tx
          .select({
            accountId: schema.journalLines.accountId,
            total: sql<string>`sum(${schema.journalLines.amount})::text`,
          })
          .from(schema.journalLines)
          .where(
            inArray(
              schema.journalLines.accountId,
              accounts.map((a) => a.id),
            ),
          )
          .groupBy(schema.journalLines.accountId)
      : [];
    return { accounts, balances: new Map(balances.map((b) => [b.accountId, b.total])) };
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Accounting"
        title="Reconcile"
        description="Check each bank, card and cash account against its statement: tick what's on the statement until the balances agree. Reconciled transactions are locked so the numbers stay right."
      />
      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <Landmark className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No bank, card or cash accounts yet.</p>
          <Button asChild className="mt-4">
            <Link href={`/o/${slug}/accounting/accounts?type=asset`}>
              Add one in your chart of accounts
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {accounts.map((a, i) => {
            const currency = a.currency ?? baseCurrency;
            const balance = naturalAmount(a.type, balances.get(a.id) ?? "0");
            return (
              <li
                key={a.id}
                className="fade-in-0 slide-in-from-bottom-1 animate-in fill-mode-both"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <Link
                  href={`/o/${slug}/accounting/reconcile/${a.id}`}
                  className="group flex h-full items-center gap-4 rounded-2xl border bg-card p-4 shadow-xs transition-all duration-200 hover:border-primary/30 hover:shadow-md sm:p-5"
                >
                  <span
                    className={
                      a.lastReconciled
                        ? "flex size-10 shrink-0 items-center justify-center rounded-xl bg-success/12 text-success"
                        : "flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                    }
                  >
                    {a.lastReconciled ? (
                      <CheckCircle2 className="size-5" />
                    ) : (
                      <CircleDashed className="size-5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{a.code ? `${a.code} · ${a.name}` : a.name}</span>
                      {a.inProgressId ? <Badge variant="warning">In progress</Badge> : null}
                    </span>
                    <span className="mt-0.5 block text-muted-foreground text-sm">
                      {a.lastReconciled
                        ? `Reconciled through ${formatDate(a.lastReconciled.statementDate, locale)}`
                        : "Never reconciled"}
                      {" · "}
                      <span className="tabular">
                        Balance {formatMoney(balance, currency, locale)}
                      </span>
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary text-sm">
                    {a.inProgressId ? "Continue" : "Reconcile"}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
