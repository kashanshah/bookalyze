import { ACCOUNTING_GUIDES } from "./accounting";
import { ADVERTISING_GUIDES } from "./advertising";
import { BANKING_GUIDES } from "./banking";
import { COMPANY_GUIDES } from "./company";
import { CONNECTION_GUIDES } from "./connections";
import { INVENTORY_GUIDES } from "./inventory";
import { INVOICE_GUIDES } from "./invoices";
import { LISTING_GUIDES } from "./listings";
import { MARKETPLACE_GUIDES } from "./marketplaces";
import { PAYOUT_GUIDES } from "./payouts";
import { PLAYBOOK_GUIDES } from "./playbooks";
import { REPORT_GUIDES } from "./reports";
import { REVIEW_GUIDES } from "./reviews";
import { START_GUIDES } from "./start";
import type { CategoryId, Guide } from "./types";

export type { Block, CategoryId, Guide } from "./types";

/** The guide categories, in the order the index shows them. */
export const CATEGORIES: readonly { id: CategoryId; title: string; lead: string }[] = [
  { id: "start", title: "Getting started", lead: "How Bookalyze works, and your first week." },
  {
    id: "marketplaces",
    title: "Marketplaces",
    lead: "Connect Amazon, Walmart, Noon and eBay, and work with their orders.",
  },
  {
    id: "payouts",
    title: "Payouts in your books",
    lead: "Settlements and months posted, and each payout matched to your bank.",
  },
  {
    id: "banking",
    title: "Banking",
    lead: "Wise, statements from any bank, rules, duplicates and reconciling.",
  },
  { id: "invoices", title: "Invoices", lead: "Buyer invoices, invoice requests and your brand." },
  {
    id: "reviews",
    title: "Reviews and listings",
    lead: "Review requests, listing watch and Amazon prices.",
  },
  {
    id: "accounting",
    title: "Accounting",
    lead: "Transactions, receipts, journal entries, sales tax and closing the books.",
  },
  {
    id: "inventory",
    title: "Stock and cost of goods",
    lead: "Products, purchase orders, landed cost, FIFO lots and cost of goods sold.",
  },
  {
    id: "reports",
    title: "Reports and views",
    lead: "Channel profit, financial reports and Home.",
  },
  {
    id: "advertising",
    title: "Advertising and profit",
    lead: "What ads really cost each product: profit after ads, TACOS, break-even ACOS.",
  },
  { id: "company", title: "Your company", lead: "Profile, documents and the compliance calendar." },
  {
    id: "playbooks",
    title: "Worked examples",
    lead: "Real situations, step by step, with the checks that show it worked.",
  },
];

/** Every guide, grouped by category in the order above. */
export const GUIDES: readonly Guide[] = [
  ...START_GUIDES,
  ...CONNECTION_GUIDES,
  ...MARKETPLACE_GUIDES,
  ...PAYOUT_GUIDES,
  ...BANKING_GUIDES,
  ...INVOICE_GUIDES,
  ...REVIEW_GUIDES,
  ...LISTING_GUIDES,
  ...ACCOUNTING_GUIDES,
  ...INVENTORY_GUIDES,
  ...REPORT_GUIDES,
  ...ADVERTISING_GUIDES,
  ...COMPANY_GUIDES,
  ...PLAYBOOK_GUIDES,
].sort(
  (a, b) =>
    CATEGORIES.findIndex((c) => c.id === a.category) -
    CATEGORIES.findIndex((c) => c.id === b.category),
);

/** The guides people need most, first (Help's "Popular guides"). */
export const POPULAR_GUIDES: readonly string[] = [
  "how-bookalyze-works",
  "connect-amazon",
  "how-payouts-post",
  "match-payouts",
  "connect-wise",
  "automatic-review-requests",
  "buyer-invoices",
  "channel-profit",
  "profit-after-ads",
];

export function guide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export function guidesIn(category: CategoryId): Guide[] {
  return GUIDES.filter((g) => g.category === category);
}

/** What the search box looks through: each guide's title, summary and category. */
export function guideSummaries() {
  return GUIDES.map((g) => ({
    slug: g.slug,
    title: g.title,
    summary: g.summary,
    category: CATEGORIES.find((c) => c.id === g.category)?.title ?? "",
  }));
}
