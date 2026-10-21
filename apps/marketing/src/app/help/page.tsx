import { ArrowRight, LifeBuoy, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink } from "@/components/button";
import { GuideLinks } from "@/components/guide-links";
import { GuideSearch } from "@/components/guide-search";
import { Section, SectionHeading } from "@/components/section";
import { CATEGORIES, guideSummaries, guidesIn } from "@/content/guides";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Help and support",
  description:
    "Search the Bookalyze guides, find the most asked questions, or contact a person for help.",
  alternates: { canonical: "/help" },
};

/** The guides people need most, first. */
const POPULAR = [
  "how-bookalyze-works",
  "connect-amazon",
  "how-payouts-post",
  "match-payouts",
  "connect-wise",
  "automatic-review-requests",
  "buyer-invoices",
  "channel-profit",
] as const;

export default function HelpPage() {
  const categories = CATEGORIES.filter((c) => guidesIn(c.id).length);
  return (
    <>
      <Section className="grid gap-10">
        <div className="fade-in-0 slide-in-from-bottom-3 animate-in duration-700">
          <SectionHeading
            as="h1"
            eyebrow="Help and support"
            title="How can we help?"
            lead="Search the guides for how anything works, or ask a person."
          />
        </div>
        <Suspense>
          <GuideSearch guides={guideSummaries()} autoFocus className="mx-auto w-full max-w-2xl" />
        </Suspense>
      </Section>

      <Section tint className="grid gap-10">
        <SectionHeading align="start" title="Popular guides" />
        <GuideLinks slugs={POPULAR} className="lg:grid-cols-2" />
      </Section>

      <Section className="grid gap-10">
        <SectionHeading align="start" title="Browse by topic" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <li
              key={c.id}
              className="group relative grid content-start gap-1.5 rounded-2xl border bg-card p-5 shadow-xs transition-shadow hover:shadow-md"
            >
              <h3 className="font-semibold">
                <Link
                  href={`/guides#${c.id}`}
                  className="after:absolute after:inset-0 after:rounded-2xl"
                >
                  {c.title}
                </Link>
              </h3>
              <p className="text-muted-foreground text-sm leading-6">{c.lead}</p>
              <p className="text-muted-foreground text-xs">
                {guidesIn(c.id).length === 1 ? "1 guide" : `${guidesIn(c.id).length} guides`}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section tint className="grid gap-8">
        <div className="mx-auto grid w-full max-w-3xl gap-6 rounded-3xl border bg-card p-8 text-center shadow-xs sm:p-10">
          <LifeBuoy className="mx-auto size-8 text-primary" />
          <div className="grid gap-2">
            <h2 className="font-semibold text-2xl tracking-tight">Still stuck?</h2>
            <p className="text-muted-foreground leading-relaxed">
              Tell us what you were trying to do and what you saw. A person reads every message and
              replies by email.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink href="/contact?topic=help">
              Contact support
              <ArrowRight className="rtl:rotate-180" />
            </ButtonLink>
            <ButtonLink href={`mailto:${CONTACT_EMAIL}`} variant="outline">
              <Mail />
              {CONTACT_EMAIL}
            </ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
