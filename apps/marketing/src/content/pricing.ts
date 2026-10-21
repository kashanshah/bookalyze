/**
 * Packages and add-ons (docs/GROWTH-PLAN.md §2, "Pricing"). USD per company per month; yearly is
 * ten months (two months free). Unlimited users, orders and marketplaces. Billing in the app
 * (workstream C) uses the same table from `packages/core`; keep the two in step.
 * Nothing is charged during early access.
 */

export type Interval = "month" | "year";

export type PackageId = "books" | "seller" | "seller-plus";

export type Package = {
  id: PackageId;
  name: string;
  /** One line under the name. */
  forWhom: string;
  monthly: number;
  yearly: number;
  /** What's in it, in plain words. */
  includes: readonly string[];
  /** The package it builds on ("Everything in Books, plus"). */
  builds?: string;
  highlight?: boolean;
};

export const PACKAGES: readonly Package[] = [
  {
    id: "books",
    name: "Books",
    forWhom: "Bookkeeping and banking for any company.",
    monthly: 9,
    yearly: 90,
    includes: [
      "Double-entry accounting: transactions, receipts, journal entries, chart of accounts",
      "Sales tax, exchange rates and closing the books",
      "Profit and loss, balance sheet, trial balance",
      "Wise sync, statement upload for any bank, rules, duplicates, transfers, reconcile",
      "Company profile, documents and compliance calendar",
    ],
  },
  {
    id: "seller",
    name: "Seller",
    forWhom: "For selling on Amazon, Walmart, Noon and eBay.",
    monthly: 19,
    yearly: 190,
    builds: "Everything in Books, plus",
    includes: [
      "Amazon, Walmart, Noon and eBay orders",
      "Settlements and months posted, payouts matched to your bank",
      "Channel profit for every marketplace",
      "Buyer invoices and invoice requests",
      "Listing watch",
    ],
  },
  {
    id: "seller-plus",
    name: "Seller Plus",
    forWhom: "Everything, for sellers who hold stock.",
    monthly: 29,
    yearly: 290,
    builds: "Everything in Seller, plus",
    includes: [
      "Stock: products, purchase orders, landed cost, FIFO lots, cost of goods sold",
      "FBA, FBN and WFS stock beside yours; reorder; Amazon prices",
      "Review requests, by hand, in bulk and automatic",
    ],
    highlight: true,
  },
];

export type AddOn = {
  id: "stock" | "reviews";
  name: string;
  monthly: number;
  yearly: number;
  body: string;
};

/** Add-ons on Seller. Seller with both ($32) costs more than Seller Plus ($29). */
export const ADD_ONS: readonly AddOn[] = [
  {
    id: "stock",
    name: "Stock",
    monthly: 8,
    yearly: 80,
    body: "Products, purchase orders, landed cost, FIFO lots, cost of goods sold, marketplace stock, reorder and Amazon prices.",
  },
  {
    id: "reviews",
    name: "Review requests",
    monthly: 5,
    yearly: 50,
    body: "Amazon's own Request a Review, by hand, in bulk or automatically.",
  },
];

/**
 * Review requests on their own, for sellers who keep their books elsewhere (`reviews_only` in
 * core): Amazon is connected and its orders come in, and nothing else in the app is included.
 */
export const REVIEWS_ONLY = {
  name: "Review requests only",
  monthly: 9,
  yearly: 90,
  forWhom: "For Amazon sellers who just want more reviews.",
  includes: [
    "Amazon's own Request a Review, by hand, hundreds at once or automatically",
    "Rules for when to ask: days after delivery, skipping refunds, replacements and business orders",
    "Connect your Amazon store and its orders come in on their own",
    "Move to Seller or Seller Plus any time; your requests stay",
  ],
} as const;

/**
 * Currencies pegged to the US dollar, so the local price is exact. Others (CAD, MXN, EGP) float:
 * the card's bank converts at its own rate, and we don't guess one here.
 */
export const PEGGED: readonly { code: string; perUsd: number }[] = [
  { code: "AED", perUsd: 3.6725 },
  { code: "SAR", perUsd: 3.75 },
];
