import type { Guide } from "./types";

/** Listings: watch a listing for changes, and Amazon prices beside cost and fees. */
export const LISTING_GUIDES: readonly Guide[] = [
  {
    slug: "listing-watch",
    category: "reviews",
    title: "Listing watch: know when a listing changes",
    summary:
      "Watch any ASIN on a connected Amazon marketplace: price, featured offer, sellers, best seller rank, title, description, photos and what reviewers mention. One email digest when something changes.",
    sections: [
      {
        heading: "Watch a listing",
        blocks: [
          { where: "Commerce → Listing watch → Watch a product" },
          {
            steps: [
              {
                title: "Pick the marketplace and the ASIN",
                body: "Yours or anyone's, on a marketplace you've connected.",
              },
              {
                title: "Choose what to compare",
                body: "Price (with shipping), the featured offer and its price, how many sellers, best seller rank, title, bullets, description, photos, and review topics.",
              },
              {
                title: "How often",
                body: "Daily (the default), weekly, or hourly. Hourly checks only the price, featured offer and sellers.",
              },
              {
                title: "Email",
                body: "Switch it on and name one or two addresses. Your own email is filled in.",
              },
            ],
          },
          {
            p: "The first look is the starting point and sends nothing. After that, each change is added to the product's timeline, and the addresses get one digest with every product that changed.",
          },
        ],
      },
      {
        heading: "Reading a change",
        blocks: [
          {
            list: [
              "Each product in the digest has its photo, title, marketplace and ASIN, and up to four changes.",
              "Best seller rank shows a green ▲ when it improves and a red ▼ when it drops, per category. It's reported when it moves by at least 5 places and about 10%.",
              "Review topics are what buyers mention, how many reviews say it, how it moves the star rating, and up to three quotes.",
            ],
          },
        ],
      },
      {
        heading: "Limits",
        blocks: [
          {
            list: [
              "Up to 200 watched products, 25 of them hourly.",
              "Only Amazon's official API is used, so the overall star average, total review count, Amazon's Choice and \"bought in the past month\" aren't available.",
              "Review topics come only for Amazon.com, .co.uk, .de, .fr, .it, .es and .co.jp, and only for a child ASIN of a brand you sell. Amazon.ae isn't offered.",
            ],
          },
          {
            note: "Your Amazon app needs the **Product Listing** and **Pricing** roles, and **Selling Partner Insights** for review topics.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The list shows each product's latest price, featured offer, sellers and rank",
              "The product page lists how often it's checked and who's emailed",
              "A change appears on the timeline after the next check",
            ],
          },
        ],
      },
    ],
    related: ["amazon-prices", "connect-amazon", "are-you-losing-money"],
  },
  {
    slug: "amazon-prices",
    category: "reviews",
    title: "Amazon prices beside cost and fees",
    summary:
      "Every linked SKU's Amazon price next to what a unit costs you. Change a price and see Amazon's fees, your profit and margin before you send it, then whether Amazon applied it.",
    sections: [
      {
        heading: "The list",
        blocks: [
          { where: "Inventory → Prices" },
          {
            p: "Every SKU linked to a product, on each switched-on Amazon marketplace: the price on the listing, its **cost** and the last change. **Check Amazon for prices** reads them again.",
          },
          {
            p: "**Cost** is the landed cost of the next unit to sell (the oldest stock lot with units left), times the units in the listing, with bundles added up. In another currency it's converted at today's rate.",
          },
        ],
      },
      {
        heading: "Change a price",
        blocks: [
          { where: "Inventory → Prices → Change price (owners and admins)" },
          {
            steps: [
              { title: "Type the new price", body: "The dialog reads the listing again first." },
              {
                title: "Compare",
                body: "Amazon's own fee estimate (FBA or not), your cost, and the profit and margin now and at the new price.",
              },
              {
                title: "Update on Amazon",
                body: 'Only "your price" changes; any sale price and minimum or maximum stay. A change of 30% or more asks you to tick that you mean it.',
              },
            ],
          },
          {
            note: "The first time, Bookalyze may ask for your Merchant Token: Seller Central → Settings → Account Info.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "Applied or not",
        blocks: [
          {
            table: {
              head: ["Status", "Means"],
              rows: [
                ["Updating", "Sent; Amazon usually applies it within minutes"],
                ["Applied", "The listing now shows the new price"],
                [
                  "Not changed",
                  "Amazon refused or didn't apply it within a day; the reason is shown",
                ],
              ],
            },
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [
          {
            list: [
              "Sale prices with dates.",
              "Changing several prices at once.",
              "Shipping templates for orders you ship yourself.",
              "Walmart, Noon and eBay prices.",
            ],
          },
        ],
      },
    ],
    related: ["landed-cost-and-lots", "channel-profit", "are-you-losing-money", "listing-watch"],
  },
];
