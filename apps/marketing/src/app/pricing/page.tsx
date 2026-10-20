import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { ClosingCta } from "@/components/cta";
import { Faq, type Question } from "@/components/faq";
import { Checklist, Section, SectionHeading } from "@/components/section";
import { CONTACT_EMAIL, SIGN_UP_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Bookalyze is free during early access, with every feature included: marketplace connections, bookkeeping, banking, stock and reorder planning.",
  alternates: { canonical: "/pricing" },
};

const INCLUDED = [
  "Amazon, eBay and Noon connections",
  "Settlements posted and payouts matched to your bank",
  "Double-entry bookkeeping and reports",
  "Wise sync and statement upload for any bank",
  "Stock, purchase orders and cost of goods sold",
  "Channel profit and reorder planning",
  "Review requests and listing watch",
  "As many companies and teammates as you need",
] as const;

const FAQ: Question[] = [
  {
    q: "Is it really free?",
    a: "Yes. During early access every feature is free, for as many companies as you run. We don't ask for a card.",
  },
  {
    q: "What happens when early access ends?",
    a: "Paid plans will come later. We'll email you well before anything changes, and nothing is charged unless you choose a plan. Your books stay yours either way.",
  },
  {
    q: "Can I take my data with me?",
    a: "Yes. Every report, including every transaction, downloads as a spreadsheet (CSV) at any time.",
  },
  {
    q: "Do I need an accountant to use it?",
    a: "No. Bookalyze is made for business owners: plain words, sensible defaults and a hint wherever a choice isn't obvious. If you have an accountant, invite them to the companies they look after.",
  },
  {
    q: "I have a question that isn't here.",
    a: (
      <>
        Write to us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        . A person reads every email.
      </>
    ),
  },
];

export default function PricingPage() {
  return (
    <>
      <Section className="grid gap-14">
        <div className="fade-in-0 slide-in-from-bottom-3 animate-in duration-700">
          <SectionHeading
            as="h1"
            eyebrow="Pricing"
            title="Free while we're in early access"
            lead="Everything Bookalyze does, for every company you run, at no cost while we build it with our first sellers."
          />
        </div>
        <div className="fade-in-0 slide-in-from-bottom-6 mx-auto grid w-full max-w-3xl animate-in overflow-hidden rounded-3xl border bg-card fill-mode-both shadow-primary/10 shadow-xl delay-150 duration-700 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="grid content-start gap-4 bg-accent p-8 text-accent-foreground">
            <p className="font-medium">Early access</p>
            <p className="flex items-baseline gap-2">
              <span className="font-semibold text-5xl text-foreground tracking-tight">$0</span>
              <span className="text-sm">a month</span>
            </p>
            <p className="text-sm leading-6">Every feature. No card needed.</p>
            <ButtonLink href={SIGN_UP_URL} size="lg" className="mt-2 w-full">
              Start free
              <ArrowRight className="rtl:rotate-180" />
            </ButtonLink>
          </div>
          <div className="grid content-start gap-4 p-8">
            <p className="font-medium">Everything included</p>
            <Checklist items={INCLUDED} />
          </div>
        </div>
      </Section>

      <Section tint className="grid gap-12">
        <SectionHeading eyebrow="Questions" title="About pricing" />
        <Faq items={FAQ} />
      </Section>

      <div className="pt-20 sm:pt-28">
        <ClosingCta title="Start with your first company" />
      </div>
    </>
  );
}
