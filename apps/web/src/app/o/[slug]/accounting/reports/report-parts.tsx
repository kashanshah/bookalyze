import type { ReportSection } from "@bookalyze/core";
import { ArrowLeft, Check, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Amount } from "@/components/accounting/amount";
import { PageHeader } from "@/components/shell/page-header";
import { cn } from "@/lib/utils";

export function ReportHeader({
  slug,
  title,
  company,
  period,
  description,
}: {
  slug: string;
  title: string;
  company: string;
  period: string;
  description: string;
}) {
  return (
    <div className="grid gap-4">
      <Link
        href={`/o/${slug}/accounting/reports`}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        All reports
      </Link>
      <PageHeader eyebrow={`${company} · ${period}`} title={title} description={description} />
    </div>
  );
}

/** The paper the report sits on. */
export function ReportCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="fade-in-0 slide-in-from-bottom-1 animate-in overflow-hidden rounded-2xl border bg-card shadow-xs duration-300 print:border-0 print:shadow-none">
      {children}
    </div>
  );
}

export function ReportSectionRows({
  section,
  currency,
  locale,
  emptyText,
}: {
  section: ReportSection;
  currency: string;
  locale: string;
  emptyText?: string;
}) {
  return (
    <div className="border-b last:border-b-0">
      <h3 className="bg-muted/30 px-5 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider sm:px-6">
        {section.label}
      </h3>
      {section.rows.length === 0 ? (
        <p className="px-5 py-3 text-muted-foreground text-sm sm:px-6">
          {emptyText ?? "Nothing in this period."}
        </p>
      ) : (
        <ul>
          {section.rows.map((row) => (
            <li
              key={row.accountId}
              className="flex items-baseline justify-between gap-4 px-5 py-2 text-sm sm:px-6"
            >
              <span className="min-w-0">
                {row.code ? (
                  <span className="me-2 font-mono text-muted-foreground text-xs">{row.code}</span>
                ) : null}
                {row.name}
              </span>
              <Amount value={row.amount} currency={currency} locale={locale} />
            </li>
          ))}
        </ul>
      )}
      <TotalRow
        label={`Total ${section.label.toLowerCase()}`}
        value={section.total}
        currency={currency}
        locale={locale}
      />
    </div>
  );
}

export function TotalRow({
  label,
  value,
  currency,
  locale,
  emphasis = false,
}: {
  label: string;
  value: string;
  currency: string;
  locale: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-t px-5 py-2.5 font-semibold text-sm sm:px-6",
        emphasis && "bg-primary/5 py-3.5 text-base",
      )}
    >
      <span>{label}</span>
      <Amount value={value} currency={currency} locale={locale} />
    </div>
  );
}

export function BalanceCheck({
  balanced,
  okText,
  badText,
}: {
  balanced: boolean;
  okText: string;
  badText: string;
}) {
  return balanced ? (
    <p className="inline-flex items-center gap-1.5 text-sm text-success">
      <Check className="size-4" strokeWidth={2.5} />
      {okText}
    </p>
  ) : (
    <p className="inline-flex items-center gap-1.5 text-destructive text-sm">
      <TriangleAlert className="size-4" />
      {badText}
    </p>
  );
}
