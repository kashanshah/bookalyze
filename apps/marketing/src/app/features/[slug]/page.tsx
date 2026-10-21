import { BILLING_PACKAGES, TRIAL_DAYS } from "@bookalyze/core";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button";
import { ClosingCta } from "@/components/cta";
import { Faq } from "@/components/faq";
import { GuideLinks } from "@/components/guide-links";
import {
  BankMatchPreview,
  CompaniesPreview,
  InvoicePreview,
  LotsPreview,
  ProductProfitPreview,
  ProfitWaterfall,
  ReorderChart,
  ReviewsPreview,
  SettlementPreview,
  TransactionsPreview,
} from "@/components/previews";
import { Checklist, Section, SectionHeading } from "@/components/section";
import { FEATURES, type FeaturePicture, feature } from "@/content/features";
import { SIGN_UP_URL } from "@/lib/site";

const PICTURES: Record<FeaturePicture, () => React.ReactNode> = {
  reviews: ReviewsPreview,
  invoice: InvoicePreview,
  settlement: SettlementPreview,
  bank: BankMatchPreview,
  lots: LotsPreview,
  reorder: ReorderChart,
  profit: ProfitWaterfall,
  products: ProductProfitPreview,
  transactions: TransactionsPreview,
  companies: CompaniesPreview,
};

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const f = feature((await params).slug);
  if (!f) return {};
  return {
    title: f.name,
    description: f.tagline,
    alternates: {
      canonical: `/features/${f.slug}`,
      types: { "text/markdown": `/features/${f.slug}.md` },
    },
  };
}

const dollars = (amount: string) => `$${amount.replace(/\.00$/, "")}`;

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const f = feature((await params).slug);
  if (!f) notFound();
  // The plans that include it, cheapest first, straight from the app's billing catalogue.
  const plans = Object.values(BILLING_PACKAGES)
    .filter((p) => p.modules.includes(f.module))
    .sort((a, b) => Number(a.monthly) - Number(b.monthly));
  const Picture = f.picture ? PICTURES[f.picture] : null;
  const howTo = f.guides[0];

  return (
    <>
      <Section className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
        <div className="fade-in-0 slide-in-from-bottom-3 grid animate-in gap-6 duration-700">
          <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
            <Link href="/features" className="hover:text-foreground">
              Features
            </Link>
            <span aria-hidden="true" className="mx-2">
              /
            </span>
            <span aria-current="page">{f.name}</span>
          </nav>
          <SectionHeading as="h1" align="start" title={f.name} lead={f.tagline} />
          <p className="max-w-2xl text-pretty text-muted-foreground leading-relaxed">{f.intro}</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={SIGN_UP_URL} size="lg">
              Start free
              <ArrowRight className="rtl:rotate-180" />
            </ButtonLink>
            {howTo ? (
              <ButtonLink href={`/guides/${howTo}`} variant="outline" size="lg">
                How it works
              </ButtonLink>
            ) : null}
          </div>
        </div>
        <aside
          aria-label="Plans that include it"
          className="fade-in-0 slide-in-from-bottom-6 grid animate-in gap-4 rounded-2xl border bg-card fill-mode-both p-6 shadow-xs delay-150 duration-700 sm:p-7"
        >
          <h2 className="font-semibold">Included in</h2>
          <ul className="grid gap-2">
            {plans.map((p) => (
              <li
                key={p.key}
                className="flex items-baseline justify-between gap-3 rounded-xl bg-accent/60 px-4 py-3 text-sm"
              >
                <span className="font-medium">{p.name}</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{dollars(p.monthly)}</span>
                  <span className="text-muted-foreground text-xs"> a month</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm leading-6">
            Per company, in US dollars. {TRIAL_DAYS} days free with everything included; cancel any
            time.{" "}
            <Link
              href="/pricing"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Compare plans
            </Link>
          </p>
        </aside>
      </Section>

      {f.sections.map((section, i) =>
        i === 0 && Picture ? (
          <Section key={section.title} tint className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div className="grid gap-6">
              <SectionHeading align="start" title={section.title} lead={section.body} />
              <Checklist items={section.points} />
            </div>
            <Picture />
          </Section>
        ) : (
          <Section
            key={section.title}
            tint={i % 2 === 0}
            className="grid gap-8 lg:grid-cols-2 lg:items-start"
          >
            <SectionHeading align="start" title={section.title} lead={section.body} />
            <Checklist items={section.points} className="lg:pt-2" />
          </Section>
        ),
      )}

      <Section tint={f.sections.length % 2 === 0} className="grid gap-12">
        <SectionHeading eyebrow="Getting started" title="How it works" />
        <ol className="grid gap-6 md:grid-cols-3">
          {f.steps.map((step, i) => (
            <li
              key={step.title}
              className="grid content-start gap-3 rounded-2xl border bg-card p-6 shadow-xs"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm">
                {i + 1}
              </span>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-6">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section tint={f.sections.length % 2 === 1} className="grid gap-12">
        <SectionHeading eyebrow="Questions" title="Good to know" />
        <Faq items={f.faq} />
      </Section>

      <Section tint={f.sections.length % 2 === 0} className="grid gap-10">
        <SectionHeading eyebrow="Guides" title="Read next" />
        <GuideLinks slugs={f.guides} />
      </Section>

      <div className="pt-20 sm:pt-28">
        <ClosingCta />
      </div>
    </>
  );
}
