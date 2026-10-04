import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Columns3,
  Landmark,
  ReceiptText,
  Scale,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { getAccountingContext } from "@/server/accounting";

export const metadata: Metadata = { title: "Reports" };

const REPORTS = [
  {
    href: "profit-and-loss",
    title: "Profit and loss",
    body: "Income, cost of goods sold and expenses for a period, and what's left as profit.",
    icon: BarChart3,
  },
  {
    href: "balance-sheet",
    title: "Balance sheet",
    body: "What the company owns, owes and the owners' stake, on a given date.",
    icon: Landmark,
  },
  {
    href: "trial-balance",
    title: "Trial balance",
    body: "Every account's debit or credit balance. Your accountant's starting point at year end.",
    icon: Scale,
  },
  {
    href: "general-ledger",
    title: "General ledger",
    body: "Every line posted to each account, with opening and closing balances. Click any account to see its lines.",
    icon: BookOpen,
  },
  {
    href: "sales-tax",
    title: "Sales tax",
    body: "Tax collected and paid for each filing period, and what you owe or get back.",
    icon: ReceiptText,
  },
] as const;

const COMING = [
  {
    title: "Compare periods",
    body: "Profit and loss side by side with last year or last quarter.",
    icon: Columns3,
  },
] as const;

export default async function ReportsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getAccountingContext(slug);
  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow="Accounting"
        title="Reports"
        description={`Financial statements for ${ctx.org.name}, always up to date and following your financial year.`}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r, i) => (
          <Link
            key={r.href}
            href={`/o/${slug}/accounting/reports/${r.href}`}
            className="group fade-in-0 slide-in-from-bottom-2 animate-in fill-mode-both"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex h-full flex-col gap-3 rounded-2xl border bg-card p-5 shadow-xs transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-lg group-hover:shadow-primary/5">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <r.icon className="size-5" />
              </span>
              <div className="flex-1">
                <p className="font-medium">{r.title}</p>
                <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{r.body}</p>
              </div>
              <span className="inline-flex items-center gap-1 font-medium text-primary text-sm">
                Open report
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
              </span>
            </div>
          </Link>
        ))}
      </div>
      <section className="grid gap-3">
        <h2 className="font-medium text-muted-foreground text-sm">On the way</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {COMING.map((r) => (
            <div key={r.title} className="flex gap-3 rounded-2xl border border-dashed p-4">
              <r.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="flex flex-wrap items-center gap-2 font-medium text-sm">
                  {r.title}
                  <Badge variant="outline">Soon</Badge>
                </p>
                <p className="mt-1 text-muted-foreground text-sm">{r.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
