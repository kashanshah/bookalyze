import type { Metadata } from "next";
import { ClosingCta } from "@/components/cta";
import { Faq, type Question } from "@/components/faq";
import { Checklist, Section, SectionHeading } from "@/components/section";
import { CONTACT_EMAIL } from "@/lib/site";
import { PricingTable } from "./pricing-table";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple monthly packages per company: Books $9, Seller $19, Seller Plus $29, or Amazon review requests on their own for $9, with unlimited users, orders and marketplaces. 30 days free; cancel any time.",
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
    q: "How does the free trial work?",
    a: "Your first company gets 30 days of everything, with nothing held back, whichever plan you choose. You choose a plan and give a card when you sign up; it's charged on day 31, then every month or year. Change plan any time before then.",
  },
  {
    q: "Can I cancel before I'm charged?",
    a: "Yes, any time, in Plan and billing. Cancel before day 31 and nothing is charged. After that, a plan stops at the end of the month or year you've paid for, and nothing in your books is deleted.",
  },
  {
    q: "Is the trial per company?",
    a: "The 30 days are for your first company. Companies you add after that start on their plan straight away.",
  },
  {
    q: "Can I buy only review requests?",
    a: "Yes. Review requests only is $9 a month per company: connect your Amazon store, its orders come in, and you send Amazon's own review requests by hand, in bulk or automatically. It doesn't include the books or settlements. If you want those later, move to Seller + Reviews or Seller Plus, and your requests carry on.",
  },
  {
    q: "What happens if I move to a smaller package?",
    a: "Only what the smaller package doesn't include stops: the rest keeps working exactly as before. You can switch plans any time in Plan and billing. What you drop becomes read-only, never deleted: its numbers stay in your reports and exports, and everything comes back as it was if you add it again.",
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
            title="One simple price per company. 30 days free."
            lead="Packages of modules that work together. Pay for what each business uses; move to a smaller package and the rest keeps working."
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
