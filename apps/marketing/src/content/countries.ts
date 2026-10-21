import type { MarketplaceSlug } from "./marketplaces";

/**
 * The countries we sell to: where Amazon meets Walmart (the US, Canada, Mexico) and where Amazon
 * meets Noon (the UAE, Saudi Arabia, Egypt). Each gets a page at /sellers/<slug>. Only claim what
 * the app does for that country (tax packs, calendars, rates: see docs/STATUS.md).
 */

export type Country = {
  slug: string;
  name: string;
  /** "in the UAE", "in Canada". */
  inName: string;
  flag: string;
  currency: string;
  currencyName: string;
  marketplaces: readonly { slug: MarketplaceSlug; sites: string }[];
  /** The page's headline and lead. */
  title: string;
  lead: string;
  /** What's particular about selling there, and what Bookalyze does about it. */
  points: readonly { title: string; body: string }[];
  faq: readonly { q: string; a: string }[];
};

export const COUNTRIES: readonly Country[] = [
  {
    slug: "united-states",
    name: "United States",
    inName: "in the United States",
    flag: "🇺🇸",
    currency: "USD",
    currencyName: "US dollars",
    marketplaces: [
      { slug: "amazon", sites: "Amazon.com" },
      { slug: "walmart", sites: "Walmart Marketplace, WFS or seller-fulfilled" },
      { slug: "ebay", sites: "eBay US" },
    ],
    title: "Accounting for Amazon and Walmart sellers in the United States",
    lead: "Amazon.com and Walmart Marketplace in one set of books: every settlement posted, every payout matched to your bank, and what each channel really earned after fees, ads and cost of goods.",
    points: [
      {
        title: "Marketplace facilitator tax, kept out of your income",
        body: "Amazon and Walmart collect and pay sales tax for you in most states. Bookalyze puts the tax buyers paid and the tax the marketplace withheld in the same group, so they cancel out instead of inflating your sales.",
      },
      {
        title: "Amazon and Walmart side by side",
        body: "Channel profit shows Amazon.com, Walmart US and eBay US in their own columns: sales, refunds, fees, WFS and FBA fees, advertising, cost of goods sold, your own costs and profit.",
      },
      {
        title: "FBA and WFS stock beside yours",
        body: "What Amazon and Walmart hold for you, next to the stock lots in your books and your own warehouse count, so a gap shows up before your accountant finds it.",
      },
      {
        title: "Your bank, matched",
        body: "Connect Wise and it syncs every day, or upload statements from any US bank. Each marketplace payout finds its deposit and the deposit stops counting as income twice.",
      },
    ],
    faq: [
      {
        q: "Does Bookalyze file my state sales tax?",
        a: "No. It keeps marketplace-collected tax out of your sales and shows what each marketplace collected, and you can add your own sales tax rates for direct sales. Filing stays with you or your accountant.",
      },
      {
        q: "I also sell on Amazon.ca.",
        a: "Add it on the same connection: Amazon's North America account covers Amazon.com, Amazon.ca and Amazon.com.mx, each a channel in its own currency.",
      },
    ],
  },
  {
    slug: "canada",
    name: "Canada",
    inName: "in Canada",
    flag: "🇨🇦",
    currency: "CAD",
    currencyName: "Canadian dollars",
    marketplaces: [
      { slug: "amazon", sites: "Amazon.ca and Amazon.com" },
      { slug: "walmart", sites: "Walmart Canada" },
      { slug: "ebay", sites: "eBay Canada" },
    ],
    title: "Accounting for Amazon and Walmart sellers in Canada",
    lead: "Made for Canadian sellers: Amazon.ca, Amazon.com and Walmart Canada in your books in Canadian dollars, with GST/HST, Bank of Canada exchange rates and your corporation's filing dates.",
    points: [
      {
        title: "GST/HST ready",
        body: "Start sales tax in one click for your province: HST, GST, QST and BC PST rates, tax split out of every sale and purchase, Amazon's GST/HST on its fees recoverable when you're registered, and a sales tax report per filing period.",
      },
      {
        title: "US dollars without the headache",
        body: "Sell on Amazon.com and get paid in US dollars? Each settlement posts at the Bank of Canada rate of its day, and a payout into your Canadian account is matched with the exchange gain or loss posted for you.",
      },
      {
        title: "Your corporation's calendar",
        body: "T2 balance and return due dates, and your annual return for a federal (CBCA) or Ontario corporation, with email reminders before each one.",
      },
      {
        title: "Moving from Wave",
        body: "Bring your Wave history, customers, vendors and receipt files in one import, and keep going from where you left off.",
      },
    ],
    faq: [
      {
        q: "Does it know the small supplier threshold?",
        a: "Yes. Home tells you when your marketplace sales over the last 12 months approach or pass $30,000, so you know when GST/HST registration applies.",
      },
      {
        q: "My bank is RBC (or TD, or Scotiabank).",
        a: "Upload its statements in CSV; Bookalyze remembers the columns, skips anything already in, and flags look-alike duplicates. Wise syncs on its own.",
      },
    ],
  },
  {
    slug: "mexico",
    name: "Mexico",
    inName: "in Mexico",
    flag: "🇲🇽",
    currency: "MXN",
    currencyName: "Mexican pesos",
    marketplaces: [
      { slug: "amazon", sites: "Amazon.com.mx" },
      { slug: "walmart", sites: "Walmart Mexico" },
    ],
    title: "Accounting for Amazon and Walmart sellers in Mexico",
    lead: "Amazon.com.mx and Walmart Mexico in books kept in pesos: every settlement posted, every payout matched, and profit per channel after fees and cost of goods.",
    points: [
      {
        title: "Books in pesos, or in dollars",
        body: "Keep your company in MXN, or sell into Mexico from a US or Canadian company: each settlement posts in pesos at the day's rate.",
      },
      {
        title: "Walmart Mexico and Amazon.com.mx together",
        body: "Both marketplaces in Channel profit, each in its own column, with your own costs counted against the channel they belong to.",
      },
      {
        title: "Your tax rates",
        body: "Add your IVA rates to your company and every transaction splits the tax out, with a report of what you collected and what you can claim back.",
      },
    ],
    faq: [
      {
        q: "Is the app in Spanish?",
        a: "Not yet. The app is in English today; your books, currency and tax rates are your own.",
      },
    ],
  },
  {
    slug: "uae",
    name: "United Arab Emirates",
    inName: "in the UAE",
    flag: "🇦🇪",
    currency: "AED",
    currencyName: "UAE dirhams",
    marketplaces: [
      { slug: "amazon", sites: "Amazon.ae" },
      { slug: "noon", sites: "Noon UAE, FBN or FBP" },
    ],
    title: "Accounting for Amazon.ae and Noon sellers in the UAE",
    lead: "Amazon.ae and Noon UAE in one set of books in dirhams: settlements and Noon months posted, payouts matched to your bank, FBA and FBN stock checked, and bilingual tax invoices for your buyers.",
    points: [
      {
        title: "Amazon.ae and Noon, finally in one place",
        body: "Amazon pays by settlement, Noon keeps a balance. Bookalyze posts both properly, matches each payout to your bank to the fils, and checks your books agree with Noon.",
      },
      {
        title: "VAT, ready for the FTA",
        body: "Start UAE VAT in one click: 5% and zero-rated, tax split out of each transaction, a VAT report per period, and your VAT return and corporate tax return in the compliance calendar.",
      },
      {
        title: "Know when to register",
        body: "Home watches your marketplace sales over the last 12 months against AED 187,500 (voluntary) and AED 375,000 (mandatory), and tells you before you cross them.",
      },
      {
        title: "Arabic and English tax invoices",
        body: "A buyer asks for a tax invoice? Create it from the order in seconds, in Arabic and English on one PDF with your TRN and letterhead, and send it through Amazon.",
      },
    ],
    faq: [
      {
        q: "My company isn't VAT registered yet.",
        a: 'Then invoices say so ("Invoice", not "Tax invoice"), VAT inside Amazon\'s and Noon\'s fees counts as a cost, and Home tells you as you approach the threshold.',
      },
      {
        q: "Can a Canadian company sell on Amazon.ae?",
        a: "Yes. AED settlements post at the day's rate through the dirham's peg to the US dollar, and AED payouts into a Canadian account are matched with the exchange difference.",
      },
    ],
  },
  {
    slug: "saudi-arabia",
    name: "Saudi Arabia",
    inName: "in Saudi Arabia",
    flag: "🇸🇦",
    currency: "SAR",
    currencyName: "Saudi riyals",
    marketplaces: [
      { slug: "amazon", sites: "Amazon.sa" },
      { slug: "noon", sites: "Noon KSA, FBN or FBP" },
    ],
    title: "Accounting for Amazon.sa and Noon sellers in Saudi Arabia",
    lead: "Amazon.sa and Noon KSA in books kept in riyals: each payout posted and matched to your bank, profit per channel after fees and cost of goods, and Arabic invoices for your buyers.",
    points: [
      {
        title: "Both marketplaces, properly posted",
        body: "Amazon.sa's settlements and Noon KSA's months each post as one entry, split into sales, refunds, fees, advertising and tax, with every payout matched.",
      },
      {
        title: "VAT threshold watch",
        body: "Home watches your marketplace sales over the last 12 months against SAR 375,000 and tells you as you approach it. Add your 15% VAT rate and every transaction splits the tax out.",
      },
      {
        title: "Arabic invoices",
        body: "Invoices from the order in Arabic and English, with your letterhead and registration number.",
      },
    ],
    faq: [
      {
        q: "Does it connect to ZATCA for e-invoicing?",
        a: "No. Bookalyze makes invoices for marketplace buyers as PDFs; it isn't a ZATCA e-invoicing solution.",
      },
    ],
  },
  {
    slug: "egypt",
    name: "Egypt",
    inName: "in Egypt",
    flag: "🇪🇬",
    currency: "EGP",
    currencyName: "Egyptian pounds",
    marketplaces: [
      { slug: "amazon", sites: "Amazon.eg" },
      { slug: "noon", sites: "Noon Egypt, FBN or FBP" },
    ],
    title: "Accounting for Amazon.eg and Noon sellers in Egypt",
    lead: "Amazon.eg and Noon Egypt in books kept in pounds: what each payout holds, posted and matched to your bank, and what you really made on each product.",
    points: [
      {
        title: "Every fee, in its place",
        body: "Referral and fulfilment fees, advertising, refunds and subsidies, each to the account you choose, so you see where the money goes.",
      },
      {
        title: "Stock that adds up",
        body: "Your purchases costed with freight and duties, sold first-in first-out, with FBN's returns and losses from Noon's own ledger.",
      },
      {
        title: "Arabic invoices",
        body: "Invoices from the order in Arabic and English, with your letterhead.",
      },
    ],
    faq: [
      {
        q: "Does it connect to the ETA e-invoicing system?",
        a: "No. Bookalyze keeps your books and makes PDF invoices for marketplace buyers; it isn't an ETA e-invoicing integration.",
      },
    ],
  },
];

export function country(slug: string) {
  return COUNTRIES.find((c) => c.slug === slug);
}
