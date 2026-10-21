import type { Metadata } from "next";
import { ClosingCta } from "@/components/cta";
import { Faq, type Question } from "@/components/faq";
import { Checklist, Section, SectionHeading } from "@/components/section";
import { CONTACT_EMAIL } from "@/lib/site";
import { PricingTable } from "./pricing-table";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple monthly packages per company: Books $9, Seller $19, Seller Plus $29, with unlimited users, orders and marketplaces. Free during early access.",
  alternates: { canonical: "/pricing" },
};

const EVERY_PLAN = [
  "As many teammates as you need",
  "No limits on orders, marketplaces or bank accounts",
  "No order-volume tiers: the price doesn't grow with your sales",
  "Every report downloads as a spreadsheet, any time",
] as const;

const FAQ: Question[] = [
  {
    q: "Is it really free right now?",
    a: "Yes. During early access every feature is free, for as many companies as you run, and we don't ask for a card. The prices here are what plans will cost once billing starts.",
  },
  {
    q: "When does billing start?",
    a: "Not yet. We'll email you at least 30 days before it does, and nothing is charged unless you choose a plan.",
  },
  {
    q: "What happens if I drop a package or an add-on?",
    a: "Only what you drop stops: the rest keeps working exactly as before. What you drop becomes read-only, never deleted: its numbers stay in your reports and exports, and everything comes back as it was if you add it again.",
  },
  {
    q: "Is the price per company?",
    a: "Yes. Each company you run has its own plan, so a Canadian corporation can be on Seller Plus while a side business stays on Books.",
  },
  {
    q: "Which currency am I charged in?",
    a: "US dollars. The UAE dirham and Saudi riyal are pegged to the dollar, so their prices shown are exact; for other currencies, your card's bank converts at its own rate.",
  },
  {
    q: "Can I take my data with me?",
    a: "Yes. Every report, including every transaction, downloads as a spreadsheet (CSV) at any time.",
  },
  {
    q: "I have a question that isn't here.",
    a: (
      <>
        Write to us from the{" "}
        <a href="/contact" className="text-primary underline underline-offset-4">
          contact page
        </a>{" "}
        or at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        . A person reads every message.
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
            title="One simple price per company. Free during early access."
            lead="Packages of modules that work together, and small add-ons. Pay for what each business uses; drop something and the rest keeps working."
          />
        </div>
        <div className="fade-in-0 slide-in-from-bottom-6 animate-in fill-mode-both delay-150 duration-700">
          <PricingTable />
        </div>
        <div className="mx-auto grid w-full max-w-3xl gap-4">
          <h2 className="text-center font-semibold">With every plan</h2>
          <Checklist items={EVERY_PLAN} className="mx-auto sm:grid-cols-2" />
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
