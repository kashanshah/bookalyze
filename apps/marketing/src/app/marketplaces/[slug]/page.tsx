import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button";
import { ClosingCta } from "@/components/cta";
import { Faq } from "@/components/faq";
import { GuideLinks } from "@/components/guide-links";
import { Checklist, Section, SectionHeading } from "@/components/section";
import { COUNTRIES } from "@/content/countries";
import { MARKETPLACES, marketplace } from "@/content/marketplaces";
import { SIGN_UP_URL } from "@/lib/site";

export function generateStaticParams() {
  return MARKETPLACES.map((m) => ({ slug: m.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const m = marketplace((await params).slug);
  if (!m) return {};
  return {
    title: `${m.name} accounting`,
    description: `${m.tagline} ${m.where}.`,
    alternates: { canonical: `/marketplaces/${m.slug}` },
  };
}

export default async function MarketplacePage({ params }: { params: Promise<{ slug: string }> }) {
  const m = marketplace((await params).slug);
  if (!m) notFound();
  const countries = COUNTRIES.filter((c) => c.marketplaces.some((x) => x.slug === m.slug));

  return (
    <>
      <Section className="grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
        <div className="fade-in-0 slide-in-from-bottom-3 grid animate-in gap-6 duration-700">
          <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
            <Link href="/marketplaces" className="hover:text-foreground">
              Marketplaces
            </Link>
            <span aria-hidden="true" className="mx-2">
              /
            </span>
            <span aria-current="page">{m.name}</span>
          </nav>
          <SectionHeading
            as="h1"
            align="start"
            title={`${m.name}, in your books`}
            lead={m.tagline}
          />
          <p className="max-w-2xl text-pretty text-muted-foreground leading-relaxed">{m.intro}</p>
          <p className="text-sm">
            <span className="font-medium">Where it works: </span>
            <span className="text-muted-foreground">{m.where}</span>
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={SIGN_UP_URL} size="lg">
              Start free
              <ArrowRight className="rtl:rotate-180" />
            </ButtonLink>
            <ButtonLink href={`/guides/connect-${m.slug}`} variant="outline" size="lg">
              How to connect {m.name}
            </ButtonLink>
          </div>
        </div>
        <div className="fade-in-0 slide-in-from-bottom-6 grid animate-in gap-4 rounded-2xl border bg-card fill-mode-both p-6 shadow-xs delay-150 duration-700 sm:p-7">
          <h2 className="font-semibold">What comes in</h2>
          <Checklist items={m.brings} />
          <p className="rounded-xl bg-accent px-4 py-3 text-accent-foreground text-sm leading-6">
            {m.connect}
          </p>
        </div>
      </Section>

      <Section tint className="grid gap-12">
        <SectionHeading eyebrow="Connecting" title={`Connect ${m.name} in three steps`} />
        <ol className="grid gap-6 md:grid-cols-3">
          {m.steps.map((step, i) => (
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

      {m.sections.map((section, i) => (
        <Section
          key={section.title}
          tint={i % 2 === 1}
          className="grid gap-8 lg:grid-cols-2 lg:items-start"
        >
          <SectionHeading align="start" title={section.title} lead={section.body} />
          <Checklist items={section.points} className="lg:pt-2" />
        </Section>
      ))}

      {countries.length ? (
        <Section tint={m.sections.length % 2 === 1} className="grid gap-8">
          <SectionHeading eyebrow="Countries" title={`Selling on ${m.name} in`} />
          <ul className="flex flex-wrap justify-center gap-3">
            {countries.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/sellers/${c.slug}`}
                  className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm shadow-xs hover:bg-accent hover:text-accent-foreground"
                >
                  <span aria-hidden="true">{c.flag}</span>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section className="grid gap-12">
        <SectionHeading eyebrow="Questions" title={`About ${m.name}`} />
        <Faq items={m.faq} />
      </Section>

      <Section tint className="grid gap-10">
        <SectionHeading eyebrow="Guides" title="Read next" />
        <GuideLinks slugs={m.guides} />
      </Section>

      <div className="pt-20 sm:pt-28">
        <ClosingCta title={`Connect ${m.name} today`} />
      </div>
    </>
  );
}
