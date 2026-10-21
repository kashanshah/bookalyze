import type { Guide } from "./types";

/** Working with channels and orders once a marketplace is connected. */
export const MARKETPLACE_GUIDES: readonly Guide[] = [
  {
    slug: "channels",
    category: "marketplaces",
    title: "Channels: switch off, say who ships, remove, disconnect",
    summary:
      "Every Amazon marketplace, Walmart country, Noon country and eBay site is a channel in its own currency. Switch one off, say who ships its orders, remove one added by mistake, or disconnect an account.",
    sections: [
      {
        heading: "The list",
        blocks: [
          { where: "Commerce → Channels" },
          {
            p: "Each row shows the platform, country, currency, who ships, and badges: **Switched off**, **Connected**, **Needs attention** or **Not connected**. **Add a channel** opens a picker for Amazon, Walmart, Noon and eBay, then that platform's own form.",
          },
          {
            p: "Amazon makes your marketplaces from your account: connect it once and every marketplace you're registered in appears. Walmart countries, Noon countries and eBay sites you add one by one.",
          },
        ],
      },
      {
        heading: "A channel's page",
        blocks: [
          {
            list: [
              "**Switch it on or off.** Off, nothing more is brought in from it; what's already in stays.",
              "**Who ships** (Walmart and Noon): the marketplace (WFS, FBN), you, or both.",
              "**Its orders:** the Orders list filtered to this channel.",
              "**The account behind it:** test the connection, replace the keys, or disconnect.",
            ],
          },
        ],
      },
      {
        heading: "Remove one added by mistake",
        blocks: [
          {
            p: "A Walmart country, Noon country or eBay site added on the wrong company can be removed from its page (owners and admins). Its orders, transactions, stock movements, SKU links and prices go with it; your books don't change.",
          },
          {
            note: "Removing is only allowed while nothing of the channel is in the books: no posted settlements, months or cost of goods sold, and no matched payouts. The button says what to take out first.",
            tone: "caution",
          },
          {
            p: "Amazon marketplaces can't be removed (they come from your account); switch them off instead.",
          },
        ],
      },
      {
        heading: "Disconnect an account",
        blocks: [
          {
            p: "Disconnecting deletes the saved keys. The account's channels are switched off and their orders and settlements are hidden, but anything already in your books stays and still shows. Connect the same seller account again and everything comes back. Connecting a different seller account in the same region makes new channels, so two sellers' data never mix.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Each marketplace you sell on is listed once, in its own currency",
              "Marketplaces you don't sell on show **Switched off**",
              "A channel with a problem shows **Needs attention** with the reason, and Home lists it",
            ],
          },
        ],
      },
    ],
    related: ["connect-amazon", "connect-walmart", "connect-noon", "connect-ebay", "orders"],
  },
  {
    slug: "orders",
    category: "marketplaces",
    title: "Orders: find, filter and read every order",
    summary:
      "Every order from every marketplace in one list, with tabs, search and badges for refunds, claims and replacements. Orders are for running the business; they don't post to your books.",
    sections: [
      {
        heading: "Bring orders in",
        blocks: [
          { where: "Commerce → Orders" },
          {
            p: "The first time, an admin picks **Bring in orders placed from** (the start of your financial year by default, at most two years back). After that orders arrive every five minutes. A large first sync of thousands of Amazon orders takes a few hours, on its own, because Amazon only allows so many requests.",
          },
          { p: "**Bring in new orders** fetches the latest straight away." },
        ],
      },
      {
        heading: "Find an order",
        blocks: [
          {
            list: [
              "Tabs: **All**, **Open**, **Shipped**, **Cancelled**, **Refunded**.",
              "Search by order number, SKU, ASIN or product title.",
              "Filter by marketplace and by the dates it was placed.",
              "A sales card per marketplace and currency; click one to see only that marketplace.",
            ],
          },
        ],
      },
      {
        heading: "Badges",
        blocks: [
          {
            table: {
              head: ["Badge", "Means"],
              rows: [
                [
                  "Refunded / Partly refunded",
                  "Everything, or part, of what the buyer paid came back",
                ],
                ["A-to-z claim / Chargeback", "The buyer claimed through Amazon or their card"],
                ["Replaced / Replacement", "A replacement was sent; each links to the other"],
              ],
            },
          },
          {
            note: "Amazon refunds and claims come from its Finances API, so your Amazon app needs the Finance and Accounting role.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "The order page",
        blocks: [
          {
            p: "Items with SKU and ASIN, shipping, tax, discounts and the total, who ships it, Prime, Business and Replacement, each refund, and **Open in Seller Central**. Amazon orders also have **Create invoice** and the review request box.",
          },
          {
            p: "**No buyer details are kept on orders**: only the ship-to country and region, which sales tax needs.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Orders from each switched-on marketplace, newest first",
              "Refunded orders show a red badge and appear under **Refunded**",
              "Home's glance shows orders, units and sales for the last 7, 30 or 90 days",
            ],
          },
        ],
      },
    ],
    related: ["buyer-invoices", "review-requests", "how-bookalyze-works"],
  },
];
