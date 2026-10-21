import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ClosingCta } from "@/components/cta";
import { GuideSearch } from "@/components/guide-search";
import { Section, SectionHeading } from "@/components/section";
import { CATEGORIES, guideSummaries, guidesIn } from "@/content/guides";

export const metadata: Metadata = {
  title: "Guides",
  description:
    "How Bookalyze works, step by step: connecting Amazon, Walmart, Noon and eBay, settlements and payouts, banking, invoices, review requests, stock and cost of goods sold, and reports.",
  alternates: { canonical: "/guides" },
};

export default function GuidesPage() {
  const categories = CATEGORIES.filter((c) => guidesIn(c.id).length);
  return (
    <>
      <Section className="grid gap-10">
        <div className="fade-in-0 slide-in-from-bottom-3 animate-in duration-700">
          <SectionHeading
            as="h1"
            eyebrow="Guides"
            title="How Bookalyze works"
            lead="Every screen, step by step, with what you should see when it's working. Written for sellers, not accountants."
          />
        </div>
        <Suspense>
          <GuideSearch guides={guideSummaries()} className="mx-auto w-full max-w-2xl" />
        </Suspense>
        <nav aria-label="Categories" className="flex flex-wrap justify-center gap-2">
          {categories.map((c) => (
            <a
              key={c.id}
              href={`#${c.id}`}
              className="rounded-full border bg-card px-3.5 py-1.5 text-sm shadow-xs hover:bg-accent hover:text-accent-foreground"
            >
              {c.title}
            </a>
          ))}
        </nav>
      </Section>

      {categories.map((c, i) => (
        <Section key={c.id} id={c.id} tint={i % 2 === 0} className="grid gap-8">
          <SectionHeading align="start" title={c.title} lead={c.lead} />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {guidesIn(c.id).map((g) => (
              <li
                key={g.slug}
                className="group relative grid content-start gap-2 rounded-2xl border bg-card p-5 shadow-xs transition-shadow hover:shadow-md"
              >
                <h3 className="font-semibold leading-snug">
                  <Link
                    href={`/guides/${g.slug}`}
                    className="after:absolute after:inset-0 after:rounded-2xl"
                  >
                    {g.title}
                  </Link>
                </h3>
                <p className="line-clamp-3 text-muted-foreground text-sm leading-6">{g.summary}</p>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      <div className="pt-20 sm:pt-28">
        <ClosingCta title="Try it on your own company" />
      </div>
    </>
  );
}
