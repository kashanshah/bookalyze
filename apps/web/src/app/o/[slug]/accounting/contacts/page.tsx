import { listContacts } from "@bookalyze/db";
import { ChevronRight, Plus, Search, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getAccountingContext, inOrg } from "@/server/accounting";
import { ContactDialog } from "./contact-dialog";

export const metadata: Metadata = { title: "Customers & vendors" };

const TABS = [
  { key: "", label: "Everyone" },
  { key: "customer", label: "Customers" },
  { key: "vendor", label: "Vendors" },
  { key: "archived", label: "Archived" },
] as const;

const TYPE_LABEL = { customer: "Customer", vendor: "Vendor", both: "Customer & vendor" } as const;

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as (typeof TABS)[number]["key"]) : "";
  const q = (sp.q ?? "").slice(0, 100);
  const ctx = await getAccountingContext(slug);
  const { locale, baseCurrency: currency } = ctx.profile;
  const contacts = await inOrg(ctx, (tx) =>
    listContacts(tx, {
      type: tab === "customer" || tab === "vendor" ? tab : null,
      archived: tab === "archived",
      search: q || null,
    }),
  );
  const base = `/o/${slug}/accounting/contacts`;
  const tabHref = (key: string) => {
    const p = new URLSearchParams();
    if (key) p.set("tab", key);
    if (q) p.set("q", q);
    return `${base}${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Accounting"
        title="Customers & vendors"
        description="The people and companies you get paid by and pay. Link them to transactions to see totals for each."
        actions={
          <ContactDialog
            slug={slug}
            defaultType={tab === "vendor" ? "vendor" : "customer"}
            trigger={
              <Button>
                <Plus />
                Add contact
              </Button>
            }
          />
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Filter contacts"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0"
        >
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              scroll={false}
              aria-current={t.key === tab ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                t.key === tab
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <form className="relative w-full sm:w-72" action={base}>
          {tab ? <input type="hidden" name="tab" value={tab} /> : null}
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search names and emails"
            aria-label="Search contacts"
            className="ps-9"
          />
        </form>
      </div>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Users className="size-6" />
          </span>
          <p className="font-medium">
            {q || tab ? "No contacts match." : "No customers or vendors yet"}
          </p>
          <p className="max-w-sm text-muted-foreground text-sm">
            {q || tab
              ? "Try another search or tab."
              : "Add the people you sell to and buy from, or create them straight from a transaction."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_9rem_9rem_1.25rem] gap-4 border-b bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider md:grid">
            <span>Name</span>
            <span>Email</span>
            <span className="text-end">Received</span>
            <span className="text-end">Paid</span>
            <span />
          </div>
          <ul className="divide-y">
            {contacts.map((c, i) => (
              <li
                key={c.id}
                className="fade-in-0 animate-in fill-mode-both"
                style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
              >
                <Link
                  href={`${base}/${c.id}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_9rem_9rem_1.25rem]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-sm">{c.name}</span>
                    <Badge
                      variant={c.type === "vendor" ? "outline" : "secondary"}
                      className="shrink-0"
                    >
                      {TYPE_LABEL[c.type]}
                    </Badge>
                  </span>
                  <span className="col-start-1 truncate text-muted-foreground text-xs md:col-start-auto md:text-sm">
                    {c.email ??
                      (c.transactions
                        ? `${c.transactions} transaction${c.transactions === 1 ? "" : "s"}`
                        : "")}
                  </span>
                  <span className="col-start-2 row-span-2 row-start-1 text-end text-sm md:col-start-auto md:row-span-1 md:row-start-auto">
                    <Amount
                      value={c.received}
                      currency={currency}
                      locale={locale}
                      muteZero
                      className="text-success"
                    />
                    <span className="block text-muted-foreground text-xs md:hidden">
                      paid <Amount value={c.paid} currency={currency} locale={locale} muteZero />
                    </span>
                  </span>
                  <span className="hidden text-end text-sm md:block">
                    <Amount value={c.paid} currency={currency} locale={locale} muteZero />
                  </span>
                  <ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
