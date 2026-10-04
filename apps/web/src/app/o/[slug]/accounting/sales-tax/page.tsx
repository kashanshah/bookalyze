import {
  defaultPackRates,
  FILING_FREQUENCY_LABELS,
  formatTaxRate,
  TAX_PACKS,
  taxPackFor,
} from "@bookalyze/core";
import { listTaxRates, listTaxRegistrations } from "@bookalyze/db";
import { BadgeCheck, FileText, Pencil, Percent, Plus, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { getAccountingContext, inOrg, listAccounts } from "@/server/accounting";
import { PackPicker } from "./pack-setup";
import { ArchiveRateButton, PackDialog } from "./rate-actions";
import { RateDialog } from "./rate-dialog";
import { RegistrationDialog } from "./registration-dialog";

export const metadata: Metadata = { title: "Sales tax" };

export default async function SalesTaxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  const { profile } = ctx;
  const [accounts, { rates, registrations }] = await Promise.all([
    listAccounts(ctx),
    inOrg(ctx, async (tx) => ({
      rates: await listTaxRates(tx, { includeArchived: true }),
      registrations: await listTaxRegistrations(tx),
    })),
  ]);
  const pack = taxPackFor(profile.countryCode) ?? null;
  const suggested = pack ? defaultPackRates(pack, profile.subdivisionCode).map((r) => r.key) : [];
  const taxAccounts = accounts
    .filter((a) => a.subtype === "sales_tax" && !a.isArchived)
    .map((a) => ({ id: a.id, label: a.code ? `${a.code} · ${a.name}` : a.name }));
  const active = rates.filter((r) => !r.isArchived);
  const archived = rates.filter((r) => r.isArchived);
  const addRate = (
    <RateDialog
      slug={slug}
      accounts={taxAccounts}
      trigger={
        <Button variant={pack ? "ghost" : "default"}>
          <Plus />
          Add a rate
        </Button>
      }
    />
  );

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Accounting"
        title="Sales tax"
        description="The sales taxes you charge and pay, such as GST/HST or VAT. Enter amounts including tax on your transactions and Bookalyze splits the tax out for your return."
        actions={
          rates.length ? (
            <Button asChild variant="outline">
              <Link href={`/o/${slug}/accounting/reports/sales-tax`}>
                <FileText />
                Sales tax report
              </Link>
            </Button>
          ) : null
        }
      />

      {rates.length === 0 ? (
        <section className="fade-in-0 slide-in-from-bottom-2 relative grid animate-in gap-5 overflow-hidden rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
          <div className="pointer-events-none absolute inset-0 bg-dots text-primary opacity-[0.05]" />
          <div className="relative flex gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ReceiptText className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-lg tracking-tight">
                {pack ? `Set up ${pack.label}` : "Set up sales tax"}
              </h2>
              <p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-relaxed">
                Only if you're registered to collect sales tax. If you're not, there's nothing to
                set up: leave this page as it is and come back if you register later.
              </p>
            </div>
          </div>
          <div className="relative">
            {pack ? (
              <PackPicker slug={slug} pack={pack} suggested={suggested} existing={[]} />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {addRate}
                <p className="text-muted-foreground text-sm">
                  Ready-made rates are available for{" "}
                  {TAX_PACKS.map((p) => p.label.split(":")[0]).join(" and ")}.
                </p>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {rates.length ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold tracking-tight">Tax rates</h2>
              <p className="text-muted-foreground text-sm">
                Choose one on each category of a transaction. Archive a rate you no longer use.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {addRate}
              {pack ? (
                <PackDialog
                  slug={slug}
                  pack={pack}
                  suggested={suggested}
                  existing={rates.map((r) => r.name)}
                />
              ) : null}
            </div>
          </div>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
            {[...active, ...archived].map((r, i) => (
              <li
                key={r.id}
                className="fade-in-0 flex animate-in items-center gap-3 fill-mode-both px-4 py-3 sm:px-5"
                style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Percent className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-sm">
                    <span className={r.isArchived ? "text-muted-foreground" : undefined}>
                      {r.name}
                    </span>
                    {r.isArchived ? <Badge variant="outline">Archived</Badge> : null}
                    {!r.isRecoverable ? <Badge variant="warning">Not claimable</Badge> : null}
                  </p>
                  <p className="truncate text-muted-foreground text-xs">
                    {formatTaxRate(r.rate)}% · kept in {r.accountName}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <RateDialog
                    slug={slug}
                    accounts={taxAccounts}
                    rate={{
                      id: r.id,
                      name: r.name,
                      rate: r.rate,
                      accountId: r.accountId,
                      isRecoverable: r.isRecoverable,
                      inUse: r.inUse,
                    }}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${r.name}`}
                        title="Edit"
                      >
                        <Pencil />
                      </Button>
                    }
                  />
                  <ArchiveRateButton slug={slug} id={r.id} name={r.name} archived={r.isArchived} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold tracking-tight">Registrations</h2>
            <p className="text-muted-foreground text-sm">
              Your sales tax accounts with each tax authority, and how often you file.
            </p>
          </div>
          <RegistrationDialog
            slug={slug}
            defaultAuthority={pack?.authority}
            trigger={
              <Button variant="ghost">
                <Plus />
                Add a registration
              </Button>
            }
          />
        </div>
        {registrations.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground text-sm">
            No registrations yet. Add yours to file by period and keep your number on record.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {registrations.map((reg) => (
              <li key={reg.id}>
                <RegistrationDialog
                  slug={slug}
                  registration={{
                    id: reg.id,
                    authority: reg.authority,
                    registrationNumber: reg.registrationNumber,
                    filingFrequency: reg.filingFrequency,
                    effectiveFrom: reg.effectiveFrom,
                    isActive: reg.isActive,
                  }}
                  trigger={
                    <button
                      type="button"
                      className="group flex h-full w-full gap-3 rounded-2xl border bg-card p-4 text-start shadow-xs transition-all duration-200 hover:border-primary/30 hover:shadow-md"
                    >
                      <BadgeCheck
                        className={
                          reg.isActive
                            ? "mt-0.5 size-5 shrink-0 text-success"
                            : "mt-0.5 size-5 shrink-0 text-muted-foreground"
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 font-medium text-sm">
                          {reg.authority}
                          {reg.isActive ? null : <Badge variant="outline">Closed</Badge>}
                        </span>
                        <span className="mt-1 block text-muted-foreground text-xs">
                          {reg.registrationNumber
                            ? `${reg.registrationNumber} · `
                            : "No number yet · "}
                          Files {FILING_FREQUENCY_LABELS[reg.filingFrequency].toLowerCase()}
                          {reg.effectiveFrom
                            ? ` · since ${formatDate(reg.effectiveFrom, profile.locale)}`
                            : ""}
                        </span>
                      </span>
                      <Pencil className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
