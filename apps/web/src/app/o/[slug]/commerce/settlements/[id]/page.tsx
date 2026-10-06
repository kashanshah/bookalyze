import {
  buildSettlementEntry,
  can,
  formatDecimal,
  parseDecimal,
  SETTLEMENT_GROUPS,
  type SettlementGroup,
  settlementDepositWindow,
  settlementGroup,
  settlementLineLabel,
} from "@bookalyze/core";
import {
  getSettlement,
  getSettlementAccounts,
  getSettlementSettings,
  schema,
  settlementDepositCandidates,
} from "@bookalyze/db";
import { AlertTriangle, ArrowLeft, BookCheck, Landmark, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { inOrg } from "@/server/accounting";
import { getCommerceContext } from "@/server/commerce";
import { isOrgAdmin } from "@/server/org";
import { DepositChoice, UnmatchDepositButton } from "../deposit-buttons";
import { PostSettlementButton, UnpostSettlementButton } from "../posting-buttons";

export const metadata: Metadata = { title: "Settlement" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER = Object.keys(SETTLEMENT_GROUPS) as SettlementGroup[];

export default async function SettlementPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getCommerceContext(slug);
  if (!can(ctx.plan, ctx.enabledModules, "commerce.settlements")) notFound();
  const found = await inOrg(ctx, async (tx) => {
    const settlement = await getSettlement(tx, id);
    if (!settlement) return null;
    const lookForDeposit =
      Boolean(settlement.entryId) && !settlement.deposit && parseDecimal(settlement.total) > 0n;
    return {
      settlement,
      candidates: lookForDeposit ? await settlementDepositCandidates(tx, id) : [],
      accounts: await getSettlementAccounts(tx),
      settings: await getSettlementSettings(tx),
      names: new Map(
        (await tx.select().from(schema.accounts)).map((a) => [
          a.id,
          a.code ? `${a.code} · ${a.name}` : a.name,
        ]),
      ),
    };
  });
  if (!found) notFound();
  const { settlement: s, candidates, accounts, settings, names } = found;
  const canPost = isOrgAdmin(ctx);
  const posted = Boolean(s.entryId);
  const before = settings.postFrom ? s.endAt.toISOString().slice(0, 10) < settings.postFrom : false;
  const preview = buildSettlementEntry({ total: s.total, lines: s.lines, accounts });
  const foreign = s.currency !== ctx.profile.baseCurrency;
  const { locale, timezone } = ctx.profile;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: timezone });
  const negative = parseDecimal(s.total) < 0n;
  const clearingName = accounts.clearing ? names.get(accounts.clearing) : null;
  const depositWindow = settlementDepositWindow({
    depositDate: s.depositDate,
    endDate: s.endAt.toISOString().slice(0, 10),
  });

  // Lines by group, each group with its subtotal, in a fixed order.
  const groups = ORDER.map((key) => {
    const lines = s.lines
      .filter((l) => settlementGroup(l) === key)
      .map((l) => ({ ...l, label: settlementLineLabel(l) }));
    // Same plain name twice (an order's and a refund's tax, say): keep them apart by type.
    const labels = new Map<string, number>();
    for (const l of lines) labels.set(l.label, (labels.get(l.label) ?? 0) + 1);
    const subtotal = formatDecimal(lines.reduce((t, l) => t + parseDecimal(l.amount), 0n));
    return {
      key,
      label: SETTLEMENT_GROUPS[key],
      subtotal,
      lines: lines.map((l) => ({
        ...l,
        label: (labels.get(l.label) ?? 0) > 1 ? `${l.label} (${l.transactionType})` : l.label,
      })),
    };
  }).filter((g) => g.lines.length);

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
        title={`${day.format(s.startAt)} – ${day.format(s.endAt)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{s.channelName ?? s.marketplace ?? "Amazon"}</span>
            <span>·</span>
            <span className="tabular">Settlement {s.externalId}</span>
            {s.source === "upload" ? <Badge variant="secondary">Uploaded</Badge> : null}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <h2 className="border-b px-5 py-3 font-medium text-sm">What makes up the payout</h2>
          {groups.map((g) => (
            <div key={g.key} className="border-b last:border-b-0">
              <div className="flex items-center justify-between gap-4 bg-muted/20 px-5 py-2.5 font-medium text-sm">
                <span>{g.label}</span>
                <Amount value={g.subtotal} currency={s.currency} locale={locale} />
              </div>
              <ul className="divide-y">
                {g.lines.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-start justify-between gap-4 px-5 py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block">{l.label}</span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {[l.transactionType, l.amountType, l.amountDescription].join(" · ")}
                        {l.count > 1 ? ` · ${l.count} lines` : ""}
                      </span>
                    </span>
                    <Amount value={l.amount} currency={s.currency} locale={locale} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t bg-muted/20 px-5 py-4 font-semibold text-sm">
            <span>{negative ? "Owed to Amazon" : "Paid to you"}</span>
            <Amount value={s.total} currency={s.currency} locale={locale} />
          </div>
        </section>

        <aside className="grid h-fit gap-4">
          <div className="rounded-2xl border bg-card p-5 shadow-xs">
            <p className="text-muted-foreground text-xs">
              {negative ? "Owed to Amazon" : "Payout"}
            </p>
            <p className="mt-1 font-semibold text-2xl tracking-tight">
              <Amount value={s.total} currency={s.currency} locale={locale} />
            </p>
            <dl className="mt-4 grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Paid into your bank</dt>
                <dd className="mt-0.5">
                  {negative
                    ? "Nothing: Amazon carries the balance to the next period or charges your card"
                    : s.depositDate
                      ? formatDate(s.depositDate, locale)
                      : "Not paid yet"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Orders</dt>
                <dd className="mt-0.5">{s.orderCount}</dd>
              </div>
            </dl>
          </div>
          {s.balanced ? null : (
            <p className="flex gap-2 rounded-xl bg-warning/10 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              The lines don't add up to the payout. Download the statement again from Seller Central
              and upload it.
            </p>
          )}
          <div className="rounded-2xl border bg-card p-5 shadow-xs">
            <h2 className="flex items-center gap-2 font-medium text-sm">
              <BookCheck className="size-4 text-primary" />
              In your books
            </h2>
            {posted && s.entryId ? (
              <div className="mt-2 grid gap-3 text-sm">
                <p>
                  Posted as{" "}
                  <Link
                    href={`/o/${slug}/accounting/journal/${s.entryId}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    JE-{String(s.entryNumber).padStart(4, "0")}
                  </Link>
                  .{" "}
                  {s.deposit
                    ? "Its deposit is matched below."
                    : "The payout waits in the clearing account until its deposit is matched."}
                </p>
                {canPost ? <UnpostSettlementButton slug={slug} id={s.id} /> : null}
              </div>
            ) : !settings.postFrom ? (
              <div className="mt-2 grid gap-3 text-sm">
                <p className="text-muted-foreground">
                  Choose which account each kind of amount goes to, and from when settlements post.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/o/${slug}/commerce/settlements/accounts`}>
                    <Settings2 />
                    Choose accounts
                  </Link>
                </Button>
              </div>
            ) : foreign ? (
              <p className="mt-2 text-muted-foreground text-sm">
                This settlement is in {s.currency}. Posting settlements in another currency than{" "}
                {ctx.profile.baseCurrency} comes later.
              </p>
            ) : !preview.ok ? (
              <div className="mt-2 grid gap-3 text-sm">
                <p className="text-muted-foreground">{preview.error}</p>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/o/${slug}/commerce/settlements/accounts`}>
                    <Settings2 />
                    Choose accounts
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="mt-3 grid gap-3">
                <p className="text-muted-foreground text-xs">
                  {before
                    ? `It ends before ${formatDate(settings.postFrom, locale)}, when posting starts: your books likely have this payout already.`
                    : `One entry dated ${formatDate(s.endAt.toISOString().slice(0, 10), locale)}:`}
                </p>
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-xs">
                    <tr>
                      <th className="pb-1 text-start font-normal">Account</th>
                      <th className="pb-1 text-end font-normal">Debit</th>
                      <th className="pb-1 text-end font-normal">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((l) => {
                      const debit = !l.amount.startsWith("-");
                      const value = debit ? l.amount : l.amount.slice(1);
                      return (
                        <tr key={l.accountId} className="border-t align-top">
                          <td className="py-1.5 pe-2">
                            <span className="block">{names.get(l.accountId) ?? "Account"}</span>
                            <span className="block text-muted-foreground text-xs">
                              {l.description}
                            </span>
                          </td>
                          <td className="py-1.5 text-end">
                            {debit ? (
                              <Amount value={value} currency={s.currency} locale={locale} />
                            ) : null}
                          </td>
                          <td className="py-1.5 text-end">
                            {debit ? null : (
                              <Amount value={value} currency={s.currency} locale={locale} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {canPost && !before ? <PostSettlementButton slug={slug} id={s.id} /> : null}
                <Link
                  href={`/o/${slug}/commerce/settlements/accounts`}
                  className="text-primary text-xs underline-offset-4 hover:underline"
                >
                  Change the accounts
                </Link>
              </div>
            )}
          </div>
          {posted && parseDecimal(s.total) > 0n ? (
            <div className="rounded-2xl border bg-card p-5 shadow-xs">
              <h2 className="flex items-center gap-2 font-medium text-sm">
                <Landmark className="size-4 text-primary" />
                Bank deposit
              </h2>
              {s.deposit ? (
                <div className="mt-2 grid gap-3 text-sm">
                  <p>
                    Matched to the deposit into {s.deposit.accountName} on{" "}
                    {formatDate(s.deposit.date, locale)} (
                    <Link
                      href={`/o/${slug}/accounting/journal/${s.deposit.entryId}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      JE-{String(s.deposit.entryNumber).padStart(4, "0")}
                    </Link>
                    ). It clears the payout from {clearingName ?? "the clearing account"}.
                  </p>
                  {canPost ? <UnmatchDepositButton slug={slug} settlementId={s.id} /> : null}
                </div>
              ) : candidates.length ? (
                <div className="mt-2 grid gap-3 text-sm">
                  <p className="text-muted-foreground text-xs">
                    {candidates.length === 1
                      ? "This deposit matches the payout:"
                      : "These deposits match the payout. Choose the right one:"}
                  </p>
                  <ul className="grid gap-3">
                    {candidates.map((c) => (
                      <li key={c.entryId} className="grid gap-2 rounded-xl border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block font-medium">
                              {formatDate(c.date, locale)} · {c.accountName}
                            </span>
                            {c.description ? (
                              <span className="block truncate text-muted-foreground text-xs">
                                {c.description}
                              </span>
                            ) : null}
                          </span>
                          <Amount value={s.total} currency={s.currency} locale={locale} />
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {c.uncategorized
                            ? `Not categorized yet. Matching puts it in ${clearingName ?? "the clearing account"}.`
                            : `Now in ${c.categories.join(", ")}. Matching moves it to ${clearingName ?? "the clearing account"}, so these sales aren't counted twice.`}
                        </p>
                        {canPost ? (
                          <DepositChoice slug={slug} settlementId={s.id} entryId={c.entryId} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground text-sm">
                  No deposit of <Amount value={s.total} currency={s.currency} locale={locale} />{" "}
                  found in your bank accounts between {formatDate(depositWindow.from, locale)} and{" "}
                  {formatDate(depositWindow.to, locale)}. It shows here once your bank brings it in.
                </p>
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
