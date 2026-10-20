import {
  BookOpenCheck,
  Boxes,
  Building2,
  ChartNoAxesCombined,
  Landmark,
  type LucideIcon,
  Star,
  Store,
} from "lucide-react";
import type { Metadata } from "next";
import { ClosingCta } from "@/components/cta";
import { MARKETPLACES } from "@/components/marketplaces";
import {
  BankMatchPreview,
  CompaniesPreview,
  LotsPreview,
  ReorderChart,
  ReviewsPreview,
  SettlementPreview,
  TransactionsPreview,
} from "@/components/previews";
import { Checklist, Section, SectionHeading } from "@/components/section";
import { cn } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Amazon, eBay and Noon connections, double-entry bookkeeping, bank reconciliation, stock and cost of goods sold, reorder planning, review requests and multi-company accounting.",
  alternates: { canonical: "/features" },
};

type Group = {
  id: string;
  icon: LucideIcon;
  title: string;
  lead: string;
  points: readonly string[];
  /** A moving picture of this part of the app. */
  picture: () => React.ReactNode;
};

const GROUPS: Group[] = [
  {
    id: "accounting",
    picture: TransactionsPreview,
    icon: BookOpenCheck,
    title: "Accounting",
    lead: "Real double-entry books, without having to think in debits and credits.",
    points: [
      "A Transactions screen to review, categorise and approve in seconds",
      "Your own chart of accounts, started from a sensible template",
      "Receipts and files on every transaction",
      "Customers and vendors, and invoices for marketplace orders",
      "Sales tax: rates, what you collected and what you can claim back",
      "Profit and loss, balance sheet, trial balance and general ledger",
      "Any currency, with each day's exchange rate",
      "Close a period so nothing changes behind you",
      "Import your history from Wave, or any spreadsheet",
    ],
  },
  {
    id: "banking",
    picture: BankMatchPreview,
    icon: Landmark,
    title: "Banking",
    lead: "Every account in one place, agreeing with the bank.",
    points: [
      "Wise syncs on its own, in every currency you hold",
      "Upload statements from any other bank",
      "Duplicates spotted before they reach your books",
      "Rules that categorise the routine, and suggest new rules",
      "Transfers between your own accounts matched for you",
      "Reconcile each account against its statement",
    ],
  },
  {
    id: "inventory",
    picture: LotsPreview,
    icon: Boxes,
    title: "Stock and cost of goods sold",
    lead: "Know what each sale really cost, down to freight and duties.",
    points: [
      "Products, with each marketplace SKU linked to them",
      "Bundles and multi-packs",
      "Purchase orders to suppliers, delivered in parts, paid in instalments",
      "Fill in a purchase order from an Alibaba.com receipt",
      "Freight, duties and prep added to each delivery's cost",
      "Stock costed first-in first-out, with cost of goods sold posted monthly",
      "Amazon's FBA and Noon's FBN stock movements: returns and losses",
    ],
  },
  {
    id: "reorder",
    picture: ReorderChart,
    icon: ChartNoAxesCombined,
    title: "Profit and reorder",
    lead: "See what's earning, and order before you run out.",
    points: [
      "Channel profit: sales, fees, cost of goods and your own costs, per marketplace",
      "Each listing's price next to its cost, fees and profit",
      "When each product runs out at the pace it's selling",
      "How many to order, and by when, with lead times, minimums and cartons",
      "One click from a reorder line to a purchase order",
    ],
  },
  {
    id: "reviews",
    picture: ReviewsPreview,
    icon: Star,
    title: "Reviews and listings",
    lead: "Small jobs that used to take an afternoon.",
    points: [
      "Amazon's own review request, sent at the right time",
      "Hundreds of orders at once, or automatically every day",
      "Eligibility checked for you, with Amazon's answer on each order",
      "Listing watch: an email when an Amazon listing's price, featured offer or rank changes",
    ],
  },
  {
    id: "companies",
    picture: CompaniesPreview,
    icon: Building2,
    title: "Every company you run",
    lead: "One login for all of your businesses, each completely separate.",
    points: [
      "Each company with its own country, currency, tax and financial year",
      "Invite people to one company, with the role they need",
      "Turn on only the parts each business uses",
      "Company profile, documents and a compliance calendar with reminders",
      "A record of every change: who, what and when",
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-16 sm:px-6 sm:pt-24">
        <div className="fade-in-0 slide-in-from-bottom-3 animate-in duration-700">
          <SectionHeading
            as="h1"
            eyebrow="Features"
            title="Everything from the marketplace payout to the balance sheet"
            lead="Bookalyze connects your marketplaces and banks, keeps proper books, and tracks the stock in between."
          />
        </div>
        <nav aria-label="On this page" className="flex flex-wrap justify-center gap-2">
          {[{ id: "marketplaces", title: "Marketplaces" }, ...GROUPS].map((g) => (
            <a
              key={g.id}
              href={`#${g.id}`}
              className="rounded-full border bg-card px-3.5 py-1.5 text-sm shadow-xs hover:bg-accent hover:text-accent-foreground"
            >
              {g.title}
            </a>
          ))}
        </nav>
      </section>

      <Section id="marketplaces" className="grid gap-12 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-8">
          <GroupHeading
            icon={Store}
            title="Marketplaces"
            lead="The heart of Bookalyze: each marketplace's money, in your books and matched to your bank."
          />
          {MARKETPLACES.map((m) => (
            <div key={m.name} className="grid gap-3">
              <h3 className="font-semibold text-lg">
                {m.name}
                <span className="ms-2 font-normal text-muted-foreground text-sm">{m.where}</span>
              </h3>
              <Checklist items={m.brings} />
              <p className="text-muted-foreground text-sm">{m.connect}</p>
            </div>
          ))}
        </div>
        <div className="lg:sticky lg:top-24">
          <SettlementPreview />
        </div>
      </Section>

      {GROUPS.map((g, i) => (
        <Section
          key={g.id}
          id={g.id}
          tint={i % 2 === 0}
          className="grid gap-12 lg:grid-cols-2 lg:items-center"
        >
          <div className={cn("grid gap-8", i % 2 === 1 && "lg:order-last")}>
            <GroupHeading icon={g.icon} title={g.title} lead={g.lead} />
            <Checklist items={g.points} />
          </div>
          <g.picture />
        </Section>
      ))}

      <div className="pt-20 sm:pt-28">
        <ClosingCta />
      </div>
    </>
  );
}

function GroupHeading({
  icon: Icon,
  title,
  lead,
}: {
  icon: LucideIcon;
  title: string;
  lead: string;
}) {
  return (
    <div className="grid gap-3">
      <span className="flex size-11 items-center justify-center rounded-xl bg-linear-to-br from-primary to-primary/70 text-primary-foreground shadow-md shadow-primary/20">
        <Icon className="size-5" />
      </span>
      <h2 className="font-semibold text-2xl tracking-tight sm:text-3xl">{title}</h2>
      <p className="max-w-xl text-muted-foreground leading-relaxed">{lead}</p>
    </div>
  );
}
