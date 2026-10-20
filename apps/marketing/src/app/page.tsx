import {
  ArrowRight,
  BookOpenCheck,
  Boxes,
  ChartNoAxesCombined,
  Landmark,
  LockKeyhole,
  ScrollText,
  ShieldCheck,
  Star,
  UsersRound,
} from "lucide-react";
import { ButtonLink } from "@/components/button";
import { ClosingCta } from "@/components/cta";
import { Faq, type Question } from "@/components/faq";
import { MoneyFlow } from "@/components/flow";
import { InView } from "@/components/in-view";
import { MarketplaceCards } from "@/components/marketplaces";
import { CompaniesPreview, PayoutsPreview, ProfitWaterfall, timing } from "@/components/previews";
import { Checklist, Section, SectionHeading } from "@/components/section";
import { SIGN_UP_URL } from "@/lib/site";

const CONNECTS = ["Amazon", "eBay", "Noon", "Wise", "Any bank by statement", "Wave (import)"];

const FLOW = [
  {
    title: "Brought in",
    body: "Orders, fees, refunds and payouts arrive from each marketplace every day, on their own.",
  },
  {
    title: "Posted",
    body: "Each settlement or month becomes one tidy entry, split into sales, fees, refunds and ads.",
  },
  {
    title: "Matched",
    body: "Each payout is paired with the deposit in your bank, so you know every dollar arrived.",
  },
  {
    title: "Profit",
    body: "Sales less fees, cost of goods and your own costs, for each marketplace and product.",
  },
] as const;

const FEATURES = [
  {
    icon: BookOpenCheck,
    title: "Proper bookkeeping",
    body: "Double-entry books behind a simple Transactions screen, receipts on every line, and profit and loss, balance sheet and sales tax reports.",
  },
  {
    icon: Landmark,
    title: "Banks that reconcile",
    body: "Wise syncs on its own; any other bank by statement upload. Rules sort the routine, and transfers between your own accounts are matched.",
  },
  {
    icon: Boxes,
    title: "Stock and cost of goods",
    body: "Purchase orders with freight and duties, stock costed first-in first-out, and cost of goods sold posted every month.",
  },
  {
    icon: ChartNoAxesCombined,
    title: "Know when to reorder",
    body: "When each product runs out at the pace it's selling, and how many to order by when, so new stock arrives in time.",
  },
  {
    icon: Star,
    title: "Reviews and listings",
    body: "Amazon's own review requests sent at the right time, in bulk or automatically, and an email when a listing you watch changes.",
  },
  {
    icon: ScrollText,
    title: "Company paperwork",
    body: "Each company's profile, documents and filing dates in one place, with email reminders before anything is due.",
  },
] as const;

const FAQ: Question[] = [
  {
    q: "What does it cost?",
    a: "Nothing during early access, with every feature included. Paid plans will come later; we'll tell you well before anything changes, and nothing is charged unless you choose a plan.",
  },
  {
    q: "Which marketplaces can I connect?",
    a: "Amazon (North America, Europe, the Middle East and the Far East), eBay (US, Canada, UK, Australia, Germany, France, Italy and Spain) and Noon (UAE, Saudi Arabia and Egypt). More are on the way.",
  },
  {
    q: "Do I still need a separate bookkeeping app?",
    a: "No. Bookalyze is full double-entry accounting: chart of accounts, bank reconciliation, receipts, sales tax and financial reports. If you use Wave, you can bring your history with you.",
  },
  {
    q: "Can I run several companies in different countries?",
    a: "Yes, that's what it's built for. Each company has its own currency, tax settings, financial year, team and connections, and you switch between them in a click.",
  },
  {
    q: "Is my data safe?",
    a: "Each company's data is kept apart by the database itself, access keys are encrypted before they're saved, and every change is recorded. We ask marketplaces for read-only access wherever they offer it.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[36rem] max-w-5xl rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-6xl gap-14 px-4 pt-16 pb-24 sm:px-6 sm:pt-24 sm:pb-32 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-12">
          <div className="fade-in-0 slide-in-from-bottom-3 grid animate-in justify-items-start gap-6 duration-700">
            <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 font-medium text-sm shadow-xs">
              <span className="size-2 rounded-full bg-success" />
              Free during early access
            </p>
            <h1 className="text-balance font-semibold text-4xl tracking-tight sm:text-5xl lg:text-6xl">
              Your marketplaces, straight into your books.
            </h1>
            <p className="max-w-xl text-pretty text-lg text-muted-foreground leading-relaxed">
              Bookalyze connects to Amazon, eBay and Noon, brings in every order, fee, refund and
              payout, and turns them into clean accounting entries matched to your bank. For every
              company you run, in any currency.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={SIGN_UP_URL} size="lg">
                Start free
                <ArrowRight className="rtl:rotate-180" />
              </ButtonLink>
              <ButtonLink href="#marketplaces" variant="outline" size="lg">
                See what connects
              </ButtonLink>
            </div>
            <p className="text-muted-foreground text-sm">No card needed. Set up in an afternoon.</p>
          </div>
          <div className="fade-in-0 slide-in-from-bottom-6 animate-in fill-mode-both delay-150 duration-700">
            <PayoutsPreview />
          </div>
        </div>
      </section>

      {/* Connects to */}
      <div className="border-y bg-sidebar">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-8 sm:flex-row sm:justify-center sm:gap-8 sm:px-6">
          <p className="shrink-0 text-muted-foreground text-sm">Connects to</p>
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {CONNECTS.map((name) => (
              <li key={name} className="font-semibold text-foreground/80 tracking-tight">
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* How the money flows */}
      <Section className="grid gap-12">
        <SectionHeading
          eyebrow="How it works"
          title="Connect once. Then it runs itself."
          lead="Every day, Bookalyze collects each marketplace's sales, fees and payouts, posts them to your books, finds each payout in your bank, and works out what you made."
        />
        <MoneyFlow />
      </Section>

      {/* Marketplaces */}
      <Section id="marketplaces" tint className="grid gap-12">
        <SectionHeading
          eyebrow="Marketplaces"
          title="Amazon, eBay and Noon, each one fully connected"
          lead="Stop downloading reports and typing totals. Each connection keeps bringing in what your books need, and checks it adds up."
        />
        <MarketplaceCards />
      </Section>

      {/* From payout to profit */}
      <Section className="grid gap-14 lg:grid-cols-2 lg:items-center">
        <div className="grid gap-10">
          <SectionHeading
            align="start"
            eyebrow="From payout to profit"
            title="Know what every payout contains, and what you really made"
          />
          <ol className="grid gap-6 sm:grid-cols-2">
            {FLOW.map((step, i) => (
              <li key={step.title} className="grid content-start gap-2">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm">
                  {i + 1}
                </span>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-6">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <ProfitWaterfall />
      </Section>

      {/* Everything else */}
      <Section className="grid gap-12">
        <SectionHeading
          eyebrow="Everything in one place"
          title="And everything else your business runs on"
          lead="Accounting, banking and stock in the same place as your sales, so the numbers agree."
        />
        <InView className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <article
              key={f.title}
              className="on-view-rise group grid content-start gap-3 rounded-2xl border bg-card p-6 shadow-xs transition-shadow hover:shadow-md"
              style={timing(i * 0.08)}
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-linear-to-br from-primary to-primary/70 text-primary-foreground shadow-md shadow-primary/20 transition-transform group-hover:-translate-y-0.5">
                <f.icon className="size-5" />
              </span>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-muted-foreground text-sm leading-6">{f.body}</p>
            </article>
          ))}
        </InView>
        <div className="flex justify-center">
          <ButtonLink href="/features" variant="outline">
            See every feature
            <ArrowRight className="rtl:rotate-180" />
          </ButtonLink>
        </div>
      </Section>

      {/* Multi-company */}
      <Section tint className="grid gap-14 lg:grid-cols-2 lg:items-center">
        <div className="grid gap-8">
          <SectionHeading
            align="start"
            eyebrow="More than one business?"
            title="Every company, one login"
            lead="A corporation in Canada, a trading licence in Dubai, a side business: switch between them in a click. Each keeps its own books, currency, tax, financial year, team and connections."
          />
          <Checklist
            items={[
              "Any country, any currency, any financial year",
              "Invite your accountant to one company only",
              "Turn on just the parts each business needs",
              "Moving from Wave? Bring your history and receipts",
            ]}
          />
        </div>
        <CompaniesPreview />
      </Section>

      {/* Trust */}
      <Section className="grid gap-12">
        <SectionHeading eyebrow="Safe by design" title="Your books stay yours" />
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: "Kept apart",
              body: "Each company's data is separated by the database itself, so one company can never see another's.",
            },
            {
              icon: LockKeyhole,
              title: "Keys encrypted",
              body: "Marketplace and bank access keys are encrypted before they're saved, and never shown again.",
            },
            {
              icon: UsersRound,
              title: "Every change recorded",
              body: "Invite people with the role they need, and see who changed what, and when.",
            },
          ].map((t) => (
            <div key={t.title} className="grid content-start gap-2 text-center">
              <t.icon className="mx-auto size-6 text-primary" />
              <h3 className="mt-1 font-semibold">{t.title}</h3>
              <p className="text-muted-foreground text-sm leading-6">{t.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ */}
      <Section tint className="grid gap-12">
        <SectionHeading eyebrow="Questions" title="Frequently asked" />
        <Faq items={FAQ} />
      </Section>

      <div className="pt-20 sm:pt-28">
        <ClosingCta />
      </div>
    </>
  );
}
