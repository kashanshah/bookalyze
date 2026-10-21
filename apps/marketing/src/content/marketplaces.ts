/**
 * What each marketplace connection does: where it works, how it connects, what comes in, and what
 * it does in the books. Shown on Home, Features, each marketplace's page and the country pages.
 * Keep it true to the app: update it when a connection gains a country or a feature
 * (docs/STATUS.md says what's done).
 */

export type MarketplaceSlug = "amazon" | "walmart" | "noon" | "ebay";

export type Marketplace = {
  slug: MarketplaceSlug;
  name: string;
  /** One line for cards and search results. */
  tagline: string;
  where: string;
  connect: string;
  brings: readonly string[];
  /** The marketplace page's opening paragraph. */
  intro: string;
  /** How connecting it works, step by step. */
  steps: readonly { title: string; body: string }[];
  /** What it does, in a few groups. */
  sections: readonly { title: string; body: string; points: readonly string[] }[];
  faq: readonly { q: string; a: string }[];
  /** Guides to read next (slugs in content/guides). */
  guides: readonly string[];
};

export const MARKETPLACES: readonly Marketplace[] = [
  {
    slug: "amazon",
    name: "Amazon",
    tagline: "Settlements posted, payouts matched, FBA stock costed.",
    where:
      "Seller Central in North America, Europe, the Middle East and the Far East: Amazon.com, Amazon.ca, Amazon.com.mx, Amazon.ae, Amazon.sa, Amazon.eg and more",
    connect: "Connect your own Selling Partner API app. Bookalyze walks you through each step.",
    brings: [
      "Orders, refunds, fees and every settlement",
      "Each settlement posted as one clean entry",
      "Each payout matched to its bank deposit",
      "FBA inventory: returns back into stock, losses written off",
      "Review requests, automatic or hundreds at once",
      "Listing watch and prices with fees and profit",
    ],
    intro:
      "An Amazon payout is never just sales. It's sales less referral fees, FBA fees, refunds, promotions, advertising, tax Amazon collects and pays, reserves held back and released. Bookalyze reads every settlement line by line, posts it as one entry split the way your accountant wants, and finds the deposit in your bank.",
    steps: [
      {
        title: "Create your Selling Partner app",
        body: "In Seller Central → Apps and Services → Develop Apps, register a private app for your own account, with the roles for the features you'll use: orders, finances, review requests, invoices, FBA stock, listings and prices. The Connect Amazon guide has the full list.",
      },
      {
        title: "Paste three values",
        body: "In Commerce → Channels → Add a channel → Amazon, choose your region and paste the app's client ID, client secret and the refresh token Amazon gives you. Bookalyze checks them with Amazon before saving them, encrypted.",
      },
      {
        title: "Your marketplaces appear",
        body: "Every marketplace your account sells on becomes a channel, in its own currency. Switch off any you don't use, pick the day to bring orders in from, and the daily job takes it from there.",
      },
    ],
    sections: [
      {
        title: "Settlements, posted and matched",
        body: "Each settlement report Amazon makes comes in on its own, and you can upload older ones, or Amazon's date range transaction report to rebuild years of history in one file.",
        points: [
          "Sales, refunds, promotions, Amazon fees, advertising, tax, reimbursements and amounts held back, each to the account you choose",
          "One entry per settlement, dated the period's last day, in the settlement's currency",
          "The payout found in any bank account, even in another currency, with the exchange difference posted for you",
          "Negative settlements matched to the charge Amazon took",
          "Post new settlements and match exact deposits automatically, every day",
        ],
      },
      {
        title: "Orders and customers",
        body: "Orders arrive every five minutes from every marketplace you sell on, with their items, refunds, A-to-z claims, chargebacks and replacements.",
        points: [
          "Search by order number, SKU, ASIN or title",
          "Bilingual Arabic and English tax invoices from the order, sent to the buyer through Amazon",
          "Buyers' invoice requests collected from a forwarding address, so none are missed",
          "No buyer names, emails or addresses kept on orders",
        ],
      },
      {
        title: "FBA stock and cost of goods sold",
        body: "Amazon's FBA inventory ledger comes in month by month, so returns go back into stock at cost and lost or damaged units are written off.",
        points: [
          "Every SKU Amazon holds, sold or not, ready to link to your products",
          "Multi-packs and bundles counted per product",
          "Your stock against what Amazon holds, product by product",
          "Each listing's price next to its cost, Amazon's fee estimate and profit, and price changes sent to Amazon",
        ],
      },
      {
        title: "Reviews and listings",
        body: "The jobs that eat an afternoon, done in the background.",
        points: [
          "Amazon's own Request a Review, at the right time, by hand, in bulk or automatically",
          "Eligibility checked with Amazon on each order, refunded and claimed orders skipped",
          "Listing watch: one email when a watched listing's price, featured offer, sellers or rank change",
        ],
      },
    ],
    faq: [
      {
        q: "Why my own Selling Partner app?",
        a: "Amazon lets a seller authorise a private app for their own account, which means your data goes straight from Amazon to your Bookalyze company and no one else's app sits in between. It takes about ten minutes, and Bookalyze shows each step.",
      },
      {
        q: "Can I bring in years of settlements?",
        a: "Yes. Amazon's API lists the last 90 days of settlement reports, so for anything older upload the flat files from Seller Central, or one date range transaction report covering every settlement since you started.",
      },
      {
        q: "I sell on Amazon.ae but my company books in Canadian dollars.",
        a: "That works. Each settlement posts in dirhams at that day's rate, and when the payout lands in a Canadian dollar account, Bookalyze matches it at the bank's rate and posts the exchange gain or loss.",
      },
    ],
    guides: ["connect-amazon", "amazon-settlements", "match-payouts", "fba-inventory-ledger"],
  },
  {
    slug: "walmart",
    name: "Walmart",
    tagline: "Orders, settlements and WFS stock, for the US, Canada and Mexico.",
    where:
      "Walmart Marketplace in the United States, Canada and Mexico, shipped by WFS, by you, or both",
    connect:
      "Connect each country with an API key from Walmart's Developer Portal. Bookalyze checks what it can see.",
    brings: [
      "Orders, the ones you ship and WFS's",
      "Every settlement report, kept row by row",
      "Each settlement posted as one entry",
      "Each payout matched to its bank deposit",
      "WFS stock: what Walmart holds to sell",
      "Walmart in Channel profit, beside Amazon",
    ],
    intro:
      "Walmart pays out against a reconciliation report with a row for every amount: product prices, commissions, WFS fulfilment and storage fees, advertising, shipping labels, tax collected and withheld. Bookalyze keeps every row, adds them up to Walmart's payout, and only posts a settlement once it does.",
    steps: [
      {
        title: "Add your Walmart countries",
        body: "In Commerce → Channels → Add a channel → Walmart, choose the US, Canada or Mexico and say who ships: Walmart Fulfillment Services, you, or both. Each country is its own channel in its own currency.",
      },
      {
        title: "Create an API key",
        body: "Signed in to Walmart's Developer Portal with your Seller Center account, create a client ID and secret. Give it access to Orders, Reports and Inventory.",
      },
      {
        title: "Connect and test",
        body: "Paste the key on the country's channel page. Bookalyze checks it with Walmart, shows what the key can see, warns about anything missing, and saves it encrypted.",
      },
    ],
    sections: [
      {
        title: "Settlements in the books",
        body: "Every settlement report Walmart lists comes in and is kept as Walmart sent it, without the buyers' names or addresses.",
        points: [
          "Sales, refunds, Walmart's fees, WFS fees, advertising, shipping labels and sales tax, each to your own account",
          "A settlement that doesn't add up to Walmart's payout says why, and never posts",
          "One entry per settlement into a Walmart balance account, at the day's rate",
          "Payouts matched to their bank deposits, by hand or every day on their own",
          "A settlement Walmart corrects is posted again",
        ],
      },
      {
        title: "Orders",
        body: "Walmart's purchase orders arrive with their lines, charges and tax, whoever ships them.",
        points: [
          "Seller-fulfilled and WFS orders, every five minutes",
          "Cancelled, partly shipped and shipped read from each line",
          "Only the ship-to country and state kept, never the buyer",
          "Linked SKUs feed cost of goods sold",
        ],
      },
      {
        title: "WFS stock",
        body: "What Walmart Fulfillment Services holds for you, beside your own stock lots.",
        points: [
          "Sellable and held units per SKU, brought in daily",
          "A Walmart column on Stock, next to Amazon and Noon",
          "Unlinked WFS SKUs shown with their stock, ready to link",
        ],
      },
    ],
    faq: [
      {
        q: "Do I need a separate key for each country?",
        a: "Yes. Walmart's US, Canada and Mexico seller accounts are separate, so each country's channel has its own key. Connect only the countries you sell in.",
      },
      {
        q: "Can I see Walmart next to Amazon?",
        a: "Yes. Channel profit has a column for each Walmart country, in its currency, beside every Amazon marketplace, Noon country and eBay site, and an All channels column in your main currency.",
      },
      {
        q: "What about WFS returns and lost units?",
        a: "What WFS holds comes in today. Its inventory ledger (returns, losses, found units) is next, the way Amazon's and Noon's already work.",
      },
    ],
    guides: ["connect-walmart", "walmart-settlements", "match-payouts", "stock-overview"],
  },
  {
    slug: "noon",
    name: "Noon",
    tagline: "Every transaction, each month posted, FBN stock checked.",
    where:
      "Noon in the UAE, Saudi Arabia and Egypt, fulfilled by Noon (FBN), by you (FBP), or both",
    connect: "Connect with a key file from Noon's partner portal. Bookalyze shows you how.",
    brings: [
      "Every transaction, row by row, a year back",
      "Each country's month posted as one entry",
      "Each payout matched to its bank deposit",
      "FBN stock: returns and losses, checked day by day",
      "Every report Noon offers, each with a check",
    ],
    intro:
      "Noon doesn't send a settlement report. It keeps a balance, charges fees with VAT inside them, transfers between contracts and pays out when it's due. Bookalyze brings in every row of Noon's transaction view, posts each country's month as one entry to a Noon balance, matches each payment to your bank, and checks that your books agree with Noon.",
    steps: [
      {
        title: "Add your Noon countries",
        body: "In Commerce → Channels → Add a channel → Noon, choose the UAE, Saudi Arabia or Egypt and who ships: Noon (FBN), you (FBP) or both.",
      },
      {
        title: "Make a service account key",
        body: "In Noon's partner portal: User & Access → API Users → Add Service Account, with a role that can download reports, and no IP whitelist. Download the key file.",
      },
      {
        title: "Upload the key file",
        body: "On the Noon channel's page, choose the key file. Bookalyze signs in to Noon with it, lists the reports it can download, and saves it encrypted. One key covers every Noon country.",
      },
    ],
    sections: [
      {
        title: "Noon's money in your books",
        body: "A year of transactions comes in by API, a month at a time, and the last three weeks are read again so late fees and updates are caught.",
        points: [
          "Sales, returns, Noon's fees, advertising, shipping credits and subsidies, each to your account",
          "Each country's month as one entry once the month is over",
          "A month Noon changes after you posted it shows as changed, and posts again in a click",
          "Payments matched to bank deposits, to the fils",
          "A balance check: your books against what Noon says it owes",
        ],
      },
      {
        title: "Orders, FBN and FBP",
        body: "Every order Noon charges, fulfilled by Noon or by you, made from its transaction rows.",
        points: [
          "Returns recorded as refunds on the order",
          "Linked partner SKUs and bundles feed cost of goods sold",
          "Noon's other reports listed, each with a check of its columns",
        ],
      },
      {
        title: "FBN stock, checked",
        body: "Noon's FBN inventory ledger and its summary, side by side.",
        points: [
          "Returns back into stock at cost, losses written off",
          "What Noon holds beside your stock lots",
          "The days and products where Noon's two stock reports disagree",
        ],
      },
    ],
    faq: [
      {
        q: "Does it handle VAT in Noon's fees?",
        a: "Noon's fees include VAT. Today that VAT posts with the fees as a cost, which is right for a seller not registered for VAT. Splitting it out as recoverable input VAT for registered sellers is on the way.",
      },
      {
        q: "Can I start without the API?",
        a: "Yes. Upload the transaction view from Noon's seller portal (Finance → Transaction view) and everything works the same; connect the key later.",
      },
      {
        q: "I sell on Noon and Amazon.ae.",
        a: "Both sit in the same company, each in its own column on Channel profit, with stock from FBA and FBN beside your own.",
      },
    ],
    guides: ["connect-noon", "noon-months", "match-payouts", "noon-fbn-stock"],
  },
  {
    slug: "ebay",
    name: "eBay",
    tagline: "Orders, fees and payouts from every eBay site you sell on.",
    where: "eBay in the United States, Canada, the UK, Australia, Germany, France, Italy and Spain",
    connect: "Connect in one click on eBay's own page. Access is read-only.",
    brings: [
      "Orders, ready for cost of goods sold",
      "Fees, refunds and payouts, month by month",
      "Each site's month posted as one entry",
      "Each payout matched to its bank deposit",
      "Or upload Seller Hub's transaction report",
    ],
    intro:
      "eBay's money comes as transactions: sales with their fees, refunds, ad fees, shipping labels and payouts. Bookalyze reads them from eBay's Finances API, posts each site's month as one entry and matches each payout to the deposit in your bank.",
    steps: [
      {
        title: "Add your eBay sites",
        body: "In Commerce → Channels → Add a channel → eBay, add each site you sell on, in its own currency.",
      },
      {
        title: "Connect eBay",
        body: "On a site's page, choose Connect eBay. You agree on eBay's own page, with read-only access to orders and finances. One connection covers every site.",
      },
      {
        title: "Choose how eBay posts",
        body: "Pick an account for sales, refunds, fees, advertising, shipping labels and credits, and an eBay balance account. Then post months by hand or automatically.",
      },
    ],
    sections: [
      {
        title: "eBay's money",
        body: "A year of rows comes in a month at a time, and recent weeks are read again for late changes.",
        points: [
          "Sales with their fees split out, refunds, disputes, ads and labels",
          "Each site's month as one entry to an eBay balance",
          "Payouts matched to bank deposits",
          "Seller Hub's transaction report upload for history, without counting anything twice",
        ],
      },
      {
        title: "Orders",
        body: "Orders from the Fulfillment API on every site, up to two years back.",
        points: [
          "Linked SKUs feed cost of goods sold",
          "Only the ship-to country and region kept",
          "Open any order in Seller Hub",
        ],
      },
    ],
    faq: [
      {
        q: "Does it work for UK and EU sellers?",
        a: "Orders work for every site. eBay asks UK and EU sellers' finance requests to be digitally signed, which is coming; until then, upload Seller Hub's transaction report for those sites.",
      },
    ],
    guides: ["connect-ebay", "ebay-months", "match-payouts"],
  },
];

export function marketplace(slug: string) {
  return MARKETPLACES.find((m) => m.slug === slug);
}

/** The marketplaces named in headlines: the three we lead with. */
export const LEAD_MARKETPLACES = "Amazon, Walmart and Noon";
