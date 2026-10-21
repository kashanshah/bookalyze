/**
 * The pains sellers have, and what Bookalyze does about each (docs/GROWTH-PLAN.md §2). Shown on
 * Home and on every country page. Each answer links to the guide that shows it. No statistics:
 * only what the app does today.
 */
export type Pain = { pain: string; answer: string; guide: string };

export const PAINS: readonly Pain[] = [
  {
    pain: "The payout isn't your sales: fees, refunds, ads, reserves and tax are netted out of it.",
    answer:
      "Each settlement or month is posted as one entry, split into sales, fees, refunds, ads, tax and amounts held back.",
    guide: "how-payouts-post",
  },
  {
    pain: "Deposits get counted as income on top of the sales, so income is counted twice.",
    answer:
      "Each payout is matched to its bank deposit and moved to the clearing account, so sales count once.",
    guide: "match-payouts",
  },
  {
    pain: "No idea what a unit really cost once freight and duties are in.",
    answer:
      "Landed cost on each delivery, stock lots costed first in first out, cost of goods sold posted every month.",
    guide: "landed-cost-and-lots",
  },
  {
    pain: "A channel that looks profitable loses money after ads and storage.",
    answer:
      "Channel profit for each marketplace, down to cost of goods and your own costs counted against it.",
    guide: "channel-profit",
  },
  {
    pain: "FBA, FBN or WFS stock that doesn't match the books, and lost units never noticed.",
    answer:
      "Stock movements from the marketplaces' own ledgers: returns back into stock, losses written off, stock compared.",
    guide: "stock-overview",
  },
  {
    pain: "Several marketplaces, currencies and companies kept in spreadsheets.",
    answer: "Every company, currency and marketplace in one login, each with its own books.",
    guide: "create-your-company",
  },
  {
    pain: "Running out of stock, or ordering far too much.",
    answer: "Reorder shows the day each product runs out, the day to order by, and how many.",
    guide: "reorder",
  },
  {
    pain: "Buyers asking for VAT invoices, one email at a time.",
    answer:
      "A bilingual Arabic and English invoice from the order in seconds, sent to the buyer through Amazon.",
    guide: "buyer-invoices",
  },
  {
    pain: "Too few reviews, because nobody has time to ask every buyer.",
    answer: "Amazon's own Request a Review, sent automatically at the right time after delivery.",
    guide: "automatic-review-requests",
  },
  {
    pain: "Bank lines typed or copied by hand.",
    answer:
      "Wise syncs every day, any other bank comes in by statement, and rules categorise the routine.",
    guide: "connect-wise",
  },
];
