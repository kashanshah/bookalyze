import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button";
import { ClosingCta } from "@/components/cta";
import { Faq } from "@/components/faq";
import { PainsGrid } from "@/components/pains";
import { Section, SectionHeading } from "@/components/section";
import { COUNTRIES, country } from "@/content/countries";
import { marketplace } from "@/content/marketplaces";
import { SIGN_UP_URL } from "@/lib/site";

export function generateStaticParams() {
  return COUNTRIES.map((c) => ({ country: c.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string }>;
}): Promise<Metadata> {
  const c = country((await params).country);
  if (!c) return {};
  return {
    title: c.title,
    description: c.lead,
    alternates: { canonical: `/sellers/${c.slug}` },
  };
}

export default async function CountryPage({ params }: { params: Promise<{ country: string }> }) {
  const c = country((await params).country);
  if (!c) notFound();

  return (
    <>
      <Section className="grid gap-8">
        <div className="fade-in-0 slide-in-from-bottom-3 grid animate-in gap-6 duration-700">
          <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
            <Link href="/sellers" className="hover:text-foreground">
              Sellers by country
            </Link>
            <span aria-hidden="true" className="mx-2">
              /
            </span>
            <span aria-current="page">{c.name}</span>
          </nav>
          <p aria-hidden="true" className="text-5xl leading-none">
            {c.flag}
          </p>
          <SectionHeading as="h1" align="start" title={c.title} lead={c.lead} />
          <p className="text-muted-foreground text-sm">
            Books in {c.currencyName} ({c.currency}), or in any main currency you choose.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={SIGN_UP_URL} size="lg">
              Start free
              <ArrowRight className="rtl:rotate-180" />
            </ButtonLink>
            <ButtonLink href="/pricing" variant="outline" size="lg">
              See pricing
            </ButtonLink>
          </div>
        </div>
      </Section>

      <Section tint className="grid gap-10">
        <SectionHeading eyebrow="Marketplaces" title={`What connects ${c.inName}`} />
        <ul className="grid gap-4 md:grid-cols-3">
          {c.marketplaces.map((x) => {
            const m = marketplace(x.slug);
            if (!m) return null;
            return (
              <li
                key={x.slug}
                className="group relative grid content-start gap-2 rounded-2xl border bg-card p-6 shadow-xs transition-shadow hover:shadow-md"
              >
                <h3 className="font-semibold text-xl tracking-tight">
                  <Link
                    href={`/marketplaces/${m.slug}`}
                    className="after:absolute after:inset-0 after:rounded-2xl"
                  >
                    {m.name}
                  </Link>
                </h3>
                <p className="text-muted-foreground text-sm">{x.sites}</p>
                <p className="text-sm leading-6">{m.tagline}</p>
                <span className="inline-flex items-center gap-1 font-medium text-primary text-sm">
                  More about {m.name}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section className="grid gap-12">
        <SectionHeading
          eyebrow={`Selling ${c.inName}`}
          title="What's particular, and what we do about it"
        />
        <div className="grid gap-5 md:grid-cols-2">
          {c.points.map((p) => (
            <article
              key={p.title}
              className="grid content-start gap-2 rounded-2xl border bg-card p-6 shadow-xs"
            >
              <h3 className="font-semibold">{p.title}</h3>
              <p className="text-muted-foreground text-sm leading-6">{p.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section tint className="grid gap-12">
        <SectionHeading
          eyebrow="The pains of selling online"
          title="The usual problems, answered"
          lead="Wherever you sell, the same headaches come up."
        />
        <PainsGrid />
      </Section>

      {c.faq.length ? (
        <Section className="grid gap-12">
          <SectionHeading eyebrow="Questions" title={`Selling ${c.inName}`} />
          <Faq items={c.faq} />
        </Section>
      ) : null}

      <div className="pt-20 sm:pt-28">
        <ClosingCta />
      </div>
    </>
  );
}
