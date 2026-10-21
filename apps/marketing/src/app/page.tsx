import {
  ArrowRight,
  BookOpenCheck,
  Boxes,
  ChartNoAxesCombined,
  FileText,
  Landmark,
  LockKeyhole,
  ScrollText,
  ShieldCheck,
  Star,
  UsersRound,
} from "lucide-react";
import { ButtonLink } from "@/components/button";
import { CountryCards } from "@/components/countries";
import { ClosingCta } from "@/components/cta";
import { Faq, type Question } from "@/components/faq";
import { MoneyFlow } from "@/components/flow";
import { InView } from "@/components/in-view";
import { MarketplaceCards } from "@/components/marketplaces";
import { PainsGrid } from "@/components/pains";
import {
  CompaniesPreview,
  InvoicePreview,
  PayoutsPreview,
  ProfitWaterfall,
  ReviewsPreview,
  timing,
  WisePreview,
} from "@/components/previews";
import { Checklist, Section, SectionHeading } from "@/components/section";
import { cn, SIGN_UP_URL } from "@/lib/site";

const CONNECTS = [
  "Amazon",
  "Walmart",
  "Noon",
  "eBay",
  "Wise",
  "Any bank by statement",
  "Wave (import)",
];

/** The three things the owner wants every visitor to see, in the hero and in their own sections. */
const HIGHLIGHTS = [
  { icon: Star, label: "Automatic review requests", href: "#reviews" },
  { icon: Landmark, label: "Wise bank sync", href: "#wise" },
  { icon: FileText, label: "Buyer invoices in seconds", href: "#invoices" },
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
    body: "Purchase orders with freight and duties, stock costed first-in first-out, cost of goods sold every month, and when to reorder each product.",
  },
  {
    icon: ChartNoAxesCombined,
    title: "Profit after ads",
    body: "Every product's profit after fees, landed cost and its own Amazon ads, with its break-even ACOS. The ones losing money first.",
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
    a: "Plans start at $9 a month per company; see Pricing. Your first company gets 30 days free with every feature included. We take a card when you sign up and charge it on day 31; cancel any time before then and nothing is charged.",
  },
  {
    q: "Which marketplaces can I connect?",
    a: "Amazon (North America, Europe, the Middle East and the Far East), Walmart (the US, Canada and Mexico), Noon (the UAE, Saudi Arabia and Egypt) and eBay (US, Canada, UK, Australia, Germany, France, Italy and Spain).",
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
    q: "Are the review requests allowed by Amazon?",
    a: "Yes. Bookalyze sends Amazon's own Request a Review, once per order, inside Amazon's window. It writes no custom emails to buyers.",
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
              30 days free on every plan
            </p>
            <h1 className="text-balance font-semibold text-4xl tracking-tight sm:text-5xl lg:text-6xl">
              Accounting built for Amazon, Walmart and Noon sellers.
            </h1>
            <p className="max-w-xl text-pretty text-lg text-muted-foreground leading-relaxed">
              For sellers in the United States, Canada, Mexico, the UAE, Saudi Arabia and Egypt.
              Every settlement posted, every payout matched to your bank, and what each channel
              really earned after fees, refunds, ads and cost of goods. eBay too.
            </p>
            <ul className="flex flex-wrap gap-2">
              {HIGHLIGHTS.map((h) => (
                <li key={h.href}>
                  <a
                    href={h.href}
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 font-medium text-accent-foreground text-sm transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    <h.icon className="size-3.5" />
                    {h.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={SIGN_UP_URL} size="lg">
                Start free
                <ArrowRight className="rtl:rotate-180" />
              </ButtonLink>
              <ButtonLink href="#losing-money" variant="outline" size="lg">
                Am I making money?
              </ButtonLink>
            </div>
            <p className="text-muted-foreground text-sm">
              30 days free, then from $9 a month. Cancel any time.
            </p>
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

      {/* The losing-money message */}
      <Section id="losing-money" className="grid gap-14 lg:grid-cols-2 lg:items-center">
        <div className="grid gap-8">
          <SectionHeading
            align="start"
            eyebrow="Are you really making money?"
            title="Many sellers find out too late"
            lead="The payout looks healthy, so the business must be too. Then every fee, refund, ad, storage charge and unit cost is set against each sale, and a channel or a product turns out to have been losing money for months."
          />
          <Checklist
            items={[
              "Channel profit for each marketplace: net from the marketplace, cost of goods sold, your own costs, profit and margin",
              "Each listing's price beside what it costs you and Amazon's fees",
              "Cost of goods from your real landed costs, not a guess",
            ]}
          />
          <ButtonLink
            href="/guides/are-you-losing-money"
            variant="outline"
            className="justify-self-start"
          >
            Find the channel that loses money
            <ArrowRight className="rtl:rotate-180" />
          </ButtonLink>
        </div>
        <ProfitWaterfall />
      </Section>

      {/* Pains → answers */}
      <Section tint className="grid gap-12">
        <SectionHeading
          eyebrow="The pains of selling online"
          title="The usual problems, answered"
          lead="Each one is a real headache for marketplace sellers. Here's what Bookalyze does about it."
        />
        <PainsGrid />
      </Section>

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
          title="Amazon, Walmart, Noon and eBay, each one fully connected"
          lead="Stop downloading reports and typing totals. Each connection keeps bringing in what your books need, and checks it adds up."
        />
        <MarketplaceCards />
      </Section>

      {/* Highlight: review requests */}
      <Highlight
        id="reviews"
        eyebrow="Automatic review requests"
        title="Ask every Amazon buyer for a review, without lifting a finger"
        lead="Switch it on once. Bookalyze sends Amazon's own Request a Review to every eligible buyer, on the day you choose after delivery, every hour, on every marketplace."
        points={[
          "Amazon's own request: within Amazon's rules, never twice for the same order",
          "Refunded orders, A-to-z claims and chargebacks checked just before sending, and skipped",
          "Leave out replacements, business orders, promotions or any SKU",
          "Or ask hundreds of orders at once, by hand",
        ]}
        guide="automatic-review-requests"
        picture={<ReviewsPreview />}
      />

      {/* Highlight: Wise */}
      <Highlight
        id="wise"
        tint
        reverse
        eyebrow="Wise bank sync"
        title="Your Wise account, in your books every morning"
        lead="Connect Wise with a read-only token and every balance, in every currency, syncs on its own each day. Marketplace payouts find their settlement; rules sort the routine."
        points={[
          "Each Wise currency balance becomes its own bank account in your books",
          "New lines every day, no exports or typing, and possible duplicates flagged",
          "Marketplace payouts matched to their settlements; supplier payments linked to purchase orders",
          "Any other bank by statement upload, with the columns remembered",
          "Not yet: Wise profiles that need Wise's strong customer authentication (for example in the UAE); upload statements meanwhile",
        ]}
        guide="connect-wise"
        picture={<WisePreview />}
      />

      {/* Highlight: buyer invoices */}
      <Highlight
        id="invoices"
        eyebrow="Buyer invoices"
        title="Create and send a buyer's invoice in seconds"
        lead="A buyer asks for a VAT invoice? Open the order, choose Create invoice, and send it through Amazon. Arabic and English on one PDF, with your letterhead and tax number."
        points={[
          "Lines, shipping, discounts and totals come straight from the order",
          '"Tax invoice" when you\'re registered, "Invoice" when you\'re not',
          "Buyers' invoice requests collected from a forwarding address, so none are missed",
          "Your own numbering, logo and letterhead",
        ]}
        guide="buyer-invoices"
        picture={<InvoicePreview />}
      />

      {/* Countries */}
      <Section tint className="grid gap-12">
        <SectionHeading
          eyebrow="Where we work"
          title="Made for the countries where these marketplaces are"
          lead="Where Amazon meets Walmart, and where Amazon meets Noon: each country's marketplaces, currency and tax."
        />
        <CountryCards />
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

/** A highlighted feature: copy and points on one side, its picture on the other. */
function Highlight({
  id,
  eyebrow,
  title,
  lead,
  points,
  guide,
  picture,
  tint,
  reverse,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  points: readonly string[];
  guide: string;
  picture: React.ReactNode;
  tint?: boolean;
  reverse?: boolean;
}) {
  return (
    <Section id={id} tint={tint} className="grid gap-14 lg:grid-cols-2 lg:items-center">
      <div className={cn("grid gap-8", reverse && "lg:order-last")}>
        <SectionHeading align="start" eyebrow={eyebrow} title={title} lead={lead} />
        <Checklist items={points} />
        <ButtonLink href={`/guides/${guide}`} variant="outline" className="justify-self-start">
          Read the guide
          <ArrowRight className="rtl:rotate-180" />
        </ButtonLink>
      </div>
      {picture}
    </Section>
  );
}
