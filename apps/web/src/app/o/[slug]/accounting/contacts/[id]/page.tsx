import { fiscalYearFor, formatMoney } from "@bookalyze/core";
import { contactTotals, formatEntryNumber, getContact, listTransactions } from "@bookalyze/db";
import { ArrowLeft, ArrowRight, Mail, MapPin, Pencil, Phone, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, nowIn } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { fiscalConfigOf } from "@/server/org";
import { ContactDialog } from "../contact-dialog";
import { ArchiveContactButton } from "./archive-contact";

export const metadata: Metadata = { title: "Contact" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE_LABEL = { customer: "Customer", vendor: "Vendor", both: "Customer & vendor" } as const;

export default async function ContactPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const fy = fiscalYearFor(nowIn(ctx.profile.timezone).date, fiscalConfigOf(ctx.profile));

  const data = await inOrg(ctx, async (tx) => {
    const contact = await getContact(tx, id);
    if (!contact) return null;
    const [allTime, thisYear, recent] = await Promise.all([
      contactTotals(tx, id),
      contactTotals(tx, id, { from: fy.start, to: fy.end }),
      listTransactions(tx, { contactId: id, limit: 25, offset: 0 }),
    ]);
    return { contact, allTime, thisYear, recent };
  });
  if (!data) notFound();
  const { contact, allTime, thisYear, recent } = data;
  const base = `/o/${slug}/accounting`;

  return (
    <div className="grid gap-6">
      <Link
        href={`${base}/contacts`}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        Customers & vendors
      </Link>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {TYPE_LABEL[contact.type]}
            {contact.isArchived ? <Badge variant="outline">Archived</Badge> : null}
          </span>
        }
        title={contact.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <ArchiveContactButton
              slug={slug}
              id={contact.id}
              name={contact.name}
              archived={contact.isArchived}
            />
            <ContactDialog
              slug={slug}
              contact={contact}
              trigger={
                <Button variant="outline">
                  <Pencil />
                  Edit
                </Button>
              }
            />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: `Received in ${fy.label}`, value: thisYear.received, tone: "text-success" },
          { label: `Paid in ${fy.label}`, value: thisYear.paid, tone: "" },
          { label: "Received, all time", value: allTime.received, tone: "text-success" },
          { label: "Paid, all time", value: allTime.paid, tone: "" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
            <p className="text-muted-foreground text-xs">{s.label}</p>
            <Amount
              value={s.value}
              currency={currency}
              locale={locale}
              className={cn("mt-1 block font-semibold text-xl tracking-tight", s.tone)}
            />
          </div>
        ))}
      </div>

      {contact.email || contact.phone || contact.taxNumber || contact.address || contact.notes ? (
        <dl className="grid gap-4 rounded-2xl border bg-card p-5 text-sm shadow-xs sm:grid-cols-2 sm:p-6">
          {contact.email ? (
            <div className="flex gap-2">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <dd>
                <a href={`mailto:${contact.email}`} className="text-primary hover:underline">
                  {contact.email}
                </a>
              </dd>
            </div>
          ) : null}
          {contact.phone ? (
            <div className="flex gap-2">
              <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <dd>
                <a href={`tel:${contact.phone}`} className="hover:underline">
                  {contact.phone}
                </a>
              </dd>
            </div>
          ) : null}
          {contact.taxNumber ? (
            <div className="flex gap-2">
              <Receipt className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <dd>
                <span className="text-muted-foreground">Tax number </span>
                {contact.taxNumber}
              </dd>
            </div>
          ) : null}
          {contact.address ? (
            <div className="flex gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <dd className="whitespace-pre-line">{contact.address}</dd>
            </div>
          ) : null}
          {contact.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground text-xs">Notes</dt>
              <dd className="mt-1 whitespace-pre-line">{contact.notes}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-semibold">Transactions</h2>
          {recent.total > 0 ? (
            <Link
              href={`${base}/transactions?contact=${contact.id}`}
              className="inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
            >
              Open in Transactions
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Link>
          ) : null}
        </div>
        {recent.rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground text-sm">
            No transactions with {contact.name} yet. Choose them as the{" "}
            {contact.type === "vendor" ? "vendor" : "customer"} when you add one.
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-xs">
            {recent.rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`${base}/journal/${r.id}`}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-5"
                >
                  <span className="tabular w-24 shrink-0 text-muted-foreground text-sm">
                    {formatDate(r.date, locale)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-sm">
                    {r.memo || formatEntryNumber(r.entryNumber)}
                  </span>
                  <span
                    className={cn(
                      "tabular whitespace-nowrap font-medium text-sm",
                      r.view.kind === "deposit" && "text-success",
                    )}
                  >
                    {r.view.kind === "deposit" ? "+" : r.view.kind === "withdrawal" ? "−" : ""}
                    {formatMoney(r.view.amount, r.currency, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
