/**
 * One page per feature (/features/<slug>): what it does, how it works, which plans include it
 * (worked out from the app's billing catalogue in packages/core), questions and guides. Keep it
 * true to the app: the guides in content/guides are the detail; docs/STATUS.md says what's done.
 */

import type { ModuleKey } from "@bookalyze/core";

export type FeatureSlug =
  | "review-requests"
  | "amazon-invoices"
  | "settlements-and-payouts"
  | "bank-reconciliation"
  | "stock-and-cost-of-goods"
  | "reorder"
  | "channel-profit"
  | "profit-after-ads"
  | "listing-watch"
  | "bookkeeping"
  | "multi-company";

/** Moving pictures of the app (components/previews.tsx) a page can show. */
export type FeaturePicture =
  | "reviews"
  | "invoice"
  | "settlement"
  | "bank"
  | "lots"
  | "reorder"
  | "profit"
  | "transactions"
  | "companies";

export type Feature = {
  slug: FeatureSlug;
  /** The feature's name, as in the app. */
  name: string;
  /** One line for cards, the Features page and search results. */
  tagline: string;
  /** The page's opening paragraph. */
  intro: string;
  /** The app module it belongs to: the plans that include it come from the billing catalogue. */
  module: ModuleKey;
  picture?: FeaturePicture;
  /** What it does, in a few groups. */
  sections: readonly { title: string; body: string; points: readonly string[] }[];
  /** How it works, in three steps. */
  steps: readonly { title: string; body: string }[];
  faq: readonly { q: string; a: string }[];
  /** Guides to read next (slugs in content/guides); the first is the "How it works" button. */
  guides: readonly string[];
};

export const FEATURES: readonly Feature[] = [
  {
    slug: "review-requests",
    name: "Amazon review requests",
    tagline: "Ask every Amazon buyer for a review at the right time, automatically.",
    intro:
      "Most happy buyers never leave a review unless they're asked. Amazon's own Request a Review asks them in their own language, but Seller Central only lets you do it one order at a time, between 5 and 30 days after delivery. Bookalyze asks every eligible buyer for you, by hand, hundreds at once or automatically every day, and never the ones who asked for a refund.",
    module: "reviews",
    picture: "reviews",
    sections: [
      {
        title: "Within Amazon's rules",
        body: "Bookalyze sends Amazon's own standard request, one per order. No custom emails, nothing Amazon could object to.",
        points: [
          "Amazon's Request a Review, in the buyer's language",
          "Never twice: an order already asked, here or in Seller Central, isn't asked again",
          "Refunds, A-to-z claims and chargebacks checked with Amazon just before sending, and skipped",
          "Inside Amazon's window only: from 5 days after delivery to 30 days after",
        ],
      },
      {
        title: "Automatic, on your schedule",
        body: "Switch it on once. Every hour, the requests that are due go out, for every Amazon marketplace you sell on.",
        points: [
          "Choose how many days after delivery to ask, from 5 to 25",
          "Choose the time of day and the days of the week, in your time zone",
          "Choose marketplaces, and orders Amazon shipped (FBA), you shipped, or both",
          "Leave out refunds, replacements, Amazon Business orders, promotions and any SKUs you list",
          "Start with new deliveries only, or every recent order still inside Amazon's window",
        ],
      },
      {
        title: "By hand or in bulk",
        body: "One list of every order you can ask, with what's scheduled, what's been asked and what's left out, and why.",
        points: [
          "Ask one order, a selection, or every ready order at once",
          "Leave an order out, with Undo, and put it back later",
          "Check with Amazon whether an order is eligible",
          "Each order shows its review request and when it went",
        ],
      },
    ],
    steps: [
      {
        title: "Connect Amazon",
        body: "Your Selling Partner app with the Buyer Solicitation role (and Finance and Accounting, to check refunds). The Connect Amazon guide walks you through it.",
      },
      {
        title: "Choose when to ask",
        body: "In Review requests → Automatic requests: the days after delivery, the time and days, marketplaces, and what to leave out.",
      },
      {
        title: "Let it run",
        body: "Requests go out every hour as they fall due. See what's scheduled and what was asked on the Requests page.",
      },
    ],
    faq: [
      {
        q: "Is it allowed by Amazon?",
        a: "Yes. It's Amazon's own Request a Review, the same button as in Seller Central, sent through Amazon's API. Bookalyze doesn't write to buyers itself.",
      },
      {
        q: "Can I use it without the accounting?",
        a: "Yes. Review requests only is its own plan: connect your Amazon store, its orders come in, and you ask for reviews. The books and settlements aren't included until you want them.",
      },
      {
        q: "Will a buyer who got a refund be asked?",
        a: "No, if you leave refunds out (the default). Bookalyze checks each order with Amazon just before sending and skips refunds, A-to-z claims and chargebacks.",
      },
      {
        q: "What about orders Amazon shipped (FBA)?",
        a: "They're asked too. Amazon doesn't give delivery dates for them, so Bookalyze estimates the window from the purchase date and lets Amazon's own answer decide.",
      },
    ],
    guides: ["automatic-review-requests", "review-requests", "connect-amazon"],
  },
  {
    slug: "amazon-invoices",
    name: "Amazon invoices",
    tagline: "Tax invoices from the order in seconds, in English and Arabic, sent through Amazon.",
    intro:
      "Buyers ask for invoices, and in many countries you have to give one. Bookalyze draws a tax invoice (or a plain invoice when you're not registered) from the Amazon order in seconds, with your brand and numbering, in English and Arabic, and sends it to the buyer through Amazon without leaving the order.",
    module: "commerce",
    picture: "invoice",
    sections: [
      {
        title: "From the order, in seconds",
        body: "The items, shipping, discounts and total come from the order. Bookalyze asks Amazon for the buyer's name, company and tax number, and never keeps their email.",
        points: [
          "A tax invoice with your TRN or GST number when you're registered, a plain invoice when you're not",
          "English and Arabic on the same page, with Arabic names and addresses that read correctly",
          "Notes that Amazon already collected the payment, and any refund on the order",
          "Sent to the buyer through Amazon's messaging, or downloaded for Seller Central or email",
          "Correct the details later; the invoice keeps its number",
        ],
      },
      {
        title: "Buyers' requests, never missed",
        body: "Amazon emails you when a buyer asks for an invoice. Forward those emails to your company's own address and each request appears on its order, waiting for you.",
        points: [
          "Home says how many buyers are waiting for an invoice",
          "Each request shows on its order, beside Create invoice",
          "Sending the invoice to Amazon closes the request",
        ],
      },
      {
        title: "Your brand and numbering",
        body: "Your logo, accent colour, Arabic name, footer and letterhead on every invoice, with a live preview.",
        points: [
          "Invoice numbers in your format, with the year or month in them if you like",
          "One running number per company, so a number is never used twice",
          "Invoices already issued keep the brand they were drawn with",
        ],
      },
    ],
    steps: [
      {
        title: "Add your company's details",
        body: "Its registered address, your sales-tax registration if you have one, and your logo and letterhead if you'd like them.",
      },
      {
        title: "Create the invoice",
        body: "On an Amazon order: Create invoice. Check the buyer's details and save; the first is INV-0001 unless you choose a format.",
      },
      {
        title: "Send to Amazon",
        body: "The PDF goes to the buyer through Amazon's messaging, and the order shows when it was sent and by whom.",
      },
    ],
    faq: [
      {
        q: "Does the invoice post to my books?",
        a: "No. The settlement already records the sale, so the invoice is a document for the buyer, not a second sale.",
      },
      {
        q: "Which Amazon roles does it need?",
        a: "Buyer Communication to send through Amazon, and Tax Invoicing to fill in the buyer's details for you. Without Tax Invoicing you type them yourself.",
      },
      {
        q: "What about Walmart, Noon or eBay orders?",
        a: "Create and download the invoice the same way, and send it through the marketplace yourself; sending from Bookalyze is Amazon only for now.",
      },
    ],
    guides: ["buyer-invoices", "invoice-requests", "brand-and-invoice-numbers"],
  },
  {
    slug: "settlements-and-payouts",
    name: "Settlements and payouts",
    tagline: "Every marketplace payout posted line by line and matched to your bank.",
    intro:
      "A marketplace payout is never just sales: it's sales less fees, refunds, promotions, advertising, tax and amounts held back. Bookalyze reads every Amazon settlement, Walmart report, Noon and eBay month line by line, posts each as one clean entry split the way your accountant wants, and finds the deposit in your bank, in any currency.",
    module: "commerce",
    picture: "settlement",
    sections: [
      {
        title: "Posted, not typed",
        body: "Choose an account for each kind of money once. Then post by hand, or let new settlements post themselves every day.",
        points: [
          "Sales, refunds, fees, advertising, tax, reimbursements and amounts held back, each to its account",
          "One entry per settlement or month, in the marketplace's own currency",
          "Amazon's older settlements uploaded, or years rebuilt from one date range report",
          "Walmart posted only when its rows add up to Walmart's payout",
        ],
      },
      {
        title: "Matched to the bank",
        body: "Each payout is paired with its deposit, so your sales are counted once and the clearing account comes back to zero.",
        points: [
          "Matches in any bank account, even in another currency",
          "The exchange difference posted for you",
          "Exact matches made automatically every day",
          "Checks that your books agree with each marketplace's balance",
        ],
      },
    ],
    steps: [
      {
        title: "Connect a marketplace",
        body: "Amazon, Walmart, Noon or eBay. Settlements start coming in on their own.",
      },
      {
        title: "Choose the accounts",
        body: "Where sales, fees, refunds, ads, tax and held-back amounts go, and the day posting starts.",
      },
      {
        title: "Post and match",
        body: "By hand, or automatically every day. Each payout finds its bank deposit.",
      },
    ],
    faq: [
      {
        q: "Which marketplaces?",
        a: "Amazon (North America, Europe, the Middle East and the Far East), Walmart (US, Canada, Mexico), Noon (UAE, Saudi Arabia, Egypt) and eBay.",
      },
      {
        q: "Do orders post to my books too?",
        a: "No: orders are for running the business. What you were paid comes from the settlements, so nothing is counted twice.",
      },
    ],
    guides: ["how-payouts-post", "amazon-settlements", "match-payouts", "how-bookalyze-works"],
  },
  {
    slug: "bank-reconciliation",
    name: "Banking and reconciliation",
    tagline: "Every bank account in one place, agreeing with its statement.",
    intro:
      "Wise syncs on its own, in every currency you hold; any other bank comes in from its statement file. Rules sort the routine, duplicates are flagged before they reach your books, transfers between your own accounts are matched, and each account is reconciled against its statement.",
    module: "banking",
    picture: "bank",
    sections: [
      {
        title: "Bank lines in, sorted",
        body: "Every line that moves money in or out, in one list, ready to categorise and tick reviewed.",
        points: [
          "Wise synced daily with a read-only token, fees split out",
          "Statement uploads from any bank: match the columns once, reused every time",
          "The same file twice adds nothing twice",
          "Rules that categorise the routine, and suggest new rules",
          "Possible duplicates flagged, never merged on their own",
          "Transfers between your own accounts suggested",
        ],
      },
      {
        title: "Reconciled and locked",
        body: "Enter the statement's date and ending balance, tick what's on it, and finish when the difference is zero.",
        points: [
          "Reconciled transactions locked until you undo",
          "Close a period so nothing changes behind you",
        ],
      },
    ],
    steps: [
      {
        title: "Add your accounts",
        body: "Connect Wise, or add any bank and upload its statement.",
      },
      {
        title: "Sort the lines",
        body: "Categorise on the list, or let rules do it as lines arrive.",
      },
      { title: "Reconcile", body: "Against each statement, until the difference is zero." },
    ],
    faq: [
      {
        q: "Which banks connect live?",
        a: "Wise, today. Any other bank comes in from the statement file you download from it.",
      },
    ],
    guides: ["connect-wise", "upload-bank-statements", "bank-rules", "reconcile"],
  },
  {
    slug: "stock-and-cost-of-goods",
    name: "Stock and cost of goods sold",
    tagline: "What each sale really cost, down to freight and duties.",
    intro:
      "Bookalyze follows your stock from the supplier's purchase order to the marketplace's warehouse: each delivery's landed cost with its share of freight, duty and prep, FIFO stock lots, and each month's cost of goods sold per marketplace, with Amazon's and Noon's returns and losses counted.",
    module: "inventory",
    picture: "lots",
    sections: [
      {
        title: "From the supplier",
        body: "Purchase orders to your suppliers, delivered in parts and paid in instalments.",
        points: [
          "Fill in a purchase order from an Alibaba.com receipt",
          "Freight, duties, brokerage and prep added to each delivery's cost",
          "Each delivery becomes stock lots, and sales use the oldest first",
        ],
      },
      {
        title: "To the books",
        body: "Each month's cost of goods sold posted per marketplace at FIFO cost.",
        points: [
          "Every marketplace SKU linked to a product, with 2-packs and bundles counted right",
          "Amazon's FBA and Noon's FBN ledgers: returns back into stock, losses written off",
          "What Amazon, Noon and Walmart hold, beside your own stock and your own count",
        ],
      },
    ],
    steps: [
      { title: "Add your products", body: "Link each marketplace SKU to the product it holds." },
      {
        title: "Record what you buy",
        body: "Purchase orders and deliveries, with their landed cost.",
      },
      { title: "Post each month", body: "Cost of goods sold per marketplace, at FIFO cost." },
    ],
    faq: [
      {
        q: "Do I have to count my stock?",
        a: "Only once, for your opening stock. After that, deliveries, sales and the marketplaces' own ledgers keep it up to date, and you can compare it with a count any time.",
      },
    ],
    guides: ["products-and-skus", "landed-cost-and-lots", "cost-of-goods-sold", "alibaba-to-fba"],
  },
  {
    slug: "reorder",
    name: "Reorder planning",
    tagline: "When each product runs out, and how many to order.",
    intro:
      "For each product, Bookalyze works out how many it sells a day, when it runs out, the last day to order with your supplier's lead time, and how many to order, with minimums and cartons. One click turns a reorder line into a purchase order.",
    module: "inventory",
    picture: "reorder",
    sections: [
      {
        title: "Before you run out",
        body: "Order now and Order soon, worked out from how fast each product is really selling.",
        points: [
          "Days of stock left at the pace it's selling",
          "The last day to order, with each product's lead time",
          "How many to order, rounded to minimums and cartons",
          "One click from a reorder line to a purchase order",
        ],
      },
    ],
    steps: [
      {
        title: "Add lead times",
        body: "How long each supplier takes, and their minimum and carton size.",
      },
      { title: "Check Reorder", body: "Order now and Order soon, product by product." },
      { title: "Order", body: "Turn the line into a purchase order to the supplier." },
    ],
    faq: [
      {
        q: "Does it count stock at Amazon?",
        a: "Yes: your own stock and what Amazon, Noon and Walmart hold, together.",
      },
    ],
    guides: ["reorder", "purchase-orders", "stock-overview"],
  },
  {
    slug: "channel-profit",
    name: "Channel profit",
    tagline: "What each marketplace really makes, after every fee and cost.",
    intro:
      "A marketplace can look busy and still lose money once fees, ads, refunds and the real cost of each unit are counted. Channel profit shows a column per marketplace, in its own currency, from sales down to profit, and every listing's price beside its cost, fees and margin.",
    module: "commerce",
    picture: "profit",
    sections: [
      {
        title: "Per marketplace",
        body: "From sales down to profit after fees, ads, cost of goods and your own costs.",
        points: [
          "A column per marketplace, in its own currency",
          "All channels together in your main currency",
          "Your own costs per channel, such as software or agency fees",
          "Ad spend from Amazon Ads and TACOS beside each marketplace",
        ],
      },
      {
        title: "Per product, after ads",
        body: "By product: each product's profit after fees, cost and its own ads, the ones losing money first.",
        points: [
          "Break-even ACOS and break-even cost per click for every advertised product",
          "See Profit after ads",
        ],
      },
      {
        title: "Per listing",
        body: "Each linked SKU's Amazon price next to what a unit costs you.",
        points: [
          "See Amazon's fees, your profit and margin before you change a price",
          "Then see whether Amazon applied it",
        ],
      },
    ],
    steps: [
      { title: "Connect and post", body: "Marketplaces connected and settlements posted." },
      {
        title: "Add cost of goods",
        body: "Stock and cost of goods sold, for profit after the product's cost.",
      },
      { title: "Read the columns", body: "Channel profit, for any period." },
    ],
    faq: [
      {
        q: "Does it need stock to work?",
        a: "No, but without cost of goods it shows profit before the product's cost. Stock adds the real cost of each unit sold.",
      },
    ],
    guides: ["channel-profit", "profit-after-ads", "amazon-prices", "are-you-losing-money"],
  },
  {
    slug: "profit-after-ads",
    name: "Profit after ads",
    tagline: "Every product's real profit after fees, cost and ads. Find the ones losing money.",
    intro:
      "Plenty of Amazon sellers grow sales and lose money doing it. A product's price has to cover the marketplace's fees, refunds, the landed cost of the unit and the ads that sold it, and no one screen shows all four. Bookalyze brings your Amazon Ads spend in every day, per product, and sets it against what each product really earned, so you see which products make money, which lose it, and exactly how far each one's ads can go before they stop paying.",
    module: "commerce",
    picture: "profit",
    sections: [
      {
        title: "The real profit of every product",
        body: "Per marketplace, from sales down to profit after ads, in the marketplace's own currency, for any period.",
        points: [
          "Sales and units from your orders, cancelled orders left out",
          "What the marketplace left you after its fees, refunds and promotions, from its settlements",
          "The landed cost of each unit, bundles and multipacks included",
          "Each product's own ad spend, day by day, from Amazon Ads",
          "Profit before and after ads, per product and per unit, with the margin",
        ],
      },
      {
        title: "The products losing money, first",
        body: "Each product gets a plain verdict, and the worst come to the top.",
        points: [
          "Losing money: the price doesn't cover the fees and the cost, ads or not",
          "Ads eat the profit: profitable on its own, not after its ads",
          "Ads with no sales: spend that sold nothing",
          "Ads cost more than they earn: ACOS above the product's break-even",
          "How many products lost money in the period, and how much",
        ],
      },
      {
        title: "How far each product's ads can go",
        body: "The numbers your ads console can't give you, because it doesn't know your costs.",
        points: [
          "Break-even ACOS: the most ACOS can be before each ad sale loses money",
          "Break-even cost per click: the highest bid that still pays",
          "ACOS, TACOS and ROAS next to it, per product and per marketplace",
          "The share of sales that came without ads",
        ],
      },
      {
        title: "Ads counted once, and your books kept right",
        body: "Amazon charges ads from payouts or a card; the ads reports say what each day cost. Bookalyze uses each where it belongs.",
        points: [
          "Channel profit keeps counting the advertising in your books",
          "Profit by product uses each day's spend from the ads reports instead, never both",
          "The two side by side, with the difference and why",
          "Sponsored Brands kept as its own line, not spread over products it wasn't about",
          "Every column as a CSV, for your accountant or your own sheet",
        ],
      },
    ],
    steps: [
      {
        title: "Connect Amazon Ads",
        body: "On your Amazon marketplace's page, agree on Amazon's own page. Read-only; one sign-in per region.",
      },
      {
        title: "Link products and costs",
        body: "Your SKUs linked to products, and each product's landed cost from a delivery or opening stock.",
      },
      {
        title: "Read By product",
        body: "Commerce → Channel profit → By product: the losing products first, every month.",
      },
    ],
    faq: [
      {
        q: "How is this different from ACOS in Seller Central?",
        a: "ACOS says what ads cost against the sales they brought. It doesn't know your landed cost or what Amazon's fees left you, so it can't say whether those sales made money. Bookalyze compares each product's ACOS with its own break-even ACOS, and shows its profit after ads.",
      },
      {
        q: "Can Bookalyze change my campaigns or bids?",
        a: "No. It only reads the ads reports: spend, clicks, and the sales Amazon attributes to the ads. Keywords, search terms, bids and budgets stay in your ads tools.",
      },
      {
        q: "Will ad costs be counted twice with my settlements?",
        a: "No. Channel profit counts the advertising in your books. Profit by product takes that out of what the marketplace left you, then takes each product's own spend from the ads reports. The two totals show side by side, with the difference.",
      },
      {
        q: "What about Sponsored Brands?",
        a: "Amazon reports Sponsored Brands' cost per campaign, not per product, so it's its own line under each marketplace: in the marketplace's profit and TACOS, not spread over products.",
      },
      {
        q: "Which marketplaces?",
        a: "Amazon, every marketplace, through the Amazon Ads API. Noon (an upload of Ad Manager's export), eBay Promoted Listings and Walmart Connect are next. Until then their advertising shows per marketplace, from your books.",
      },
      {
        q: "How far back, and how fresh?",
        a: "60 days back when you connect, then every day. The last 15 days are fetched again daily, because Amazon keeps moving sales between days for 14 days after a click.",
      },
      {
        q: "What if a product has no cost yet?",
        a: "It still shows its sales and ads, marked Cost missing, with how to fix it: link its SKU to a product and add a delivery or opening stock with the cost.",
      },
      {
        q: "Does it work in several currencies?",
        a: "Yes. Each marketplace is in its own currency, and the summary is in your main currency at each day's exchange rate.",
      },
    ],
    guides: [
      "profit-after-ads",
      "connect-amazon-ads",
      "acos-tacos-break-even",
      "fix-products-losing-money",
      "ads-in-your-books",
      "ads-data-and-limits",
    ],
  },
  {
    slug: "listing-watch",
    name: "Listing watch",
    tagline: "An email when an Amazon listing's price, featured offer or rank changes.",
    intro:
      "Watch any ASIN on a connected Amazon marketplace, yours or a competitor's. Bookalyze checks it on a schedule and sends one email digest when something changes: price, featured offer, sellers, best seller rank, title, description, photos or what reviewers mention.",
    module: "commerce",
    sections: [
      {
        title: "What it watches",
        body: "Choose what matters for each listing, and who gets the email.",
        points: [
          "Price and the featured offer (Buy Box)",
          "The sellers on the listing",
          "Best seller rank",
          "Title, description and photos",
          "What reviewers mention",
        ],
      },
    ],
    steps: [
      { title: "Connect Amazon", body: "Any marketplace your account sells on." },
      { title: "Add an ASIN", body: "Choose what to watch, and daily, weekly or hourly." },
      { title: "Get the digest", body: "One email when something changes." },
    ],
    faq: [
      {
        q: "Can I watch a competitor's listing?",
        a: "Yes, any ASIN on a marketplace your Amazon account is connected to.",
      },
      {
        q: "How many listings can I watch?",
        a: "Up to 200 per company, 25 of them hourly (hourly checks the price, featured offer and sellers).",
      },
    ],
    guides: ["listing-watch", "connect-amazon"],
  },
  {
    slug: "bookkeeping",
    name: "Bookkeeping",
    tagline: "Real double-entry books, without having to think in debits and credits.",
    intro:
      "A Transactions screen to review and categorise in seconds, your own chart of accounts, receipts on every transaction, sales tax, any currency at each day's rate, and the standard reports ready for your accountant. Move your history in from Wave, QuickBooks, Xero, Zoho Books or Sage.",
    module: "accounting",
    picture: "transactions",
    sections: [
      {
        title: "Day to day",
        body: "Everything that moves money, in one list.",
        points: [
          "Categorise on the list, split across categories, copy one that repeats",
          "Receipts uploaded or emailed in, attached to their transactions",
          "Customers and vendors, with what you've received from or paid to each",
          "Journal entries for depreciation, accruals and corrections",
        ],
      },
      {
        title: "Tax, currencies and reports",
        body: "The parts an accountant checks first.",
        points: [
          "Sales tax: Canada's GST/HST, QST and PST, or UAE VAT, started in one click",
          "Any currency, converted at each day's rate",
          "Profit and loss, balance sheet, trial balance and general ledger",
          "Close a period so nothing changes behind you",
        ],
      },
    ],
    steps: [
      { title: "Create your company", body: "Country, main currency and financial year." },
      { title: "Bring your history", body: "From Wave or any spreadsheet, if you have one." },
      {
        title: "Keep it up",
        body: "Bank lines, receipts and marketplace entries arrive on their own.",
      },
    ],
    faq: [
      {
        q: "Can my accountant use it?",
        a: "Yes. Invite them to one company; they see only that company, and every report downloads as a spreadsheet.",
      },
    ],
    guides: ["transactions", "sales-tax", "financial-reports", "move-from-wave"],
  },
  {
    slug: "multi-company",
    name: "Every company you run",
    tagline: "One login for all of your businesses, each completely separate.",
    intro:
      "Run a Canadian corporation and a UAE free-zone company from one login. Each company has its own country, currency, tax, financial year, team and connections, its own plan, and nothing is ever shared between them.",
    module: "entity",
    picture: "companies",
    sections: [
      {
        title: "Separate by design",
        body: "Each company is its own set of books, people and connections.",
        points: [
          "Its own country, currency, tax and financial year",
          "Invite people to one company, as owner, admin or member",
          "Turn on only the parts each business uses",
          "A record of every change: who, what and when",
        ],
      },
      {
        title: "The company itself",
        body: "Everything about the company in one place.",
        points: [
          "Registration numbers, licences, people and owners",
          "A document vault with expiry dates",
          "A compliance calendar with email reminders before each filing date",
        ],
      },
    ],
    steps: [
      { title: "Create a company", body: "Name, country, currency and financial year." },
      { title: "Invite your team", body: "And your accountant, to just that company." },
      { title: "Add another", body: "Switch between companies from the sidebar." },
    ],
    faq: [
      {
        q: "Is the price per company?",
        a: "Yes. Each company has its own plan, so a side business can stay on Books while the main one is on Seller Plus.",
      },
    ],
    guides: ["create-your-company", "invite-your-team", "compliance-calendar"],
  },
];

export function feature(slug: string): Feature | undefined {
  return FEATURES.find((f) => f.slug === slug);
}
