import type { Guide } from "./types";

/** Your company: profile, registration numbers, people, documents, and the compliance calendar. */
export const COMPANY_GUIDES: readonly Guide[] = [
  {
    slug: "company-profile-and-documents",
    category: "company",
    title: "Company profile, registration numbers, people and documents",
    summary:
      "Everything about the company in one place: its details, registration numbers and licences, the people and owners, and a vault for its documents with expiry dates.",
    sections: [
      {
        heading: "Profile",
        blocks: [
          { where: "Entity & compliance → Profile" },
          {
            list: [
              "**Details:** where it's incorporated, when, and its registered address (owners and admins). The name, type and year end are changed in Settings.",
              "**Registration numbers:** the kinds your country uses (a business number, a trade licence, a TRN), with expiry dates for licences.",
              "**People:** directors, officers and shareholders, with their title, ownership and dates.",
            ],
          },
          {
            p: "The registered address and tax number are what buyer invoices print.",
          },
        ],
      },
      {
        heading: "Documents",
        blocks: [
          { where: "Entity & compliance → Documents" },
          {
            p: "Upload articles, licences, certificates and agreements with a name, a kind and an expiry date. They're kept apart from receipts. A document with an expiry date appears on the compliance calendar.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Your registered address, needed before the first buyer invoice",
              "Licence and document expiries on the compliance calendar",
            ],
          },
        ],
      },
    ],
    related: ["compliance-calendar", "buyer-invoices", "brand-and-invoice-numbers"],
  },
  {
    slug: "compliance-calendar",
    category: "company",
    title: "The compliance calendar and reminders",
    summary:
      "Filing dates worked out from your country, year end, registrations and documents, with email reminders 30, 7 and 1 days before, and on the day.",
    sections: [
      {
        heading: "What's worked out for you",
        blocks: [
          { where: "Entity & compliance → Compliance calendar" },
          {
            table: {
              head: ["Where", "Dates"],
              rows: [
                [
                  "Canadian corporations",
                  "T2 balance due (2 months after year end), T2 return (6 months), annual return (federal and Ontario)",
                ],
                ["UAE", "Corporate tax return 9 months after year end, once its TRN is added"],
                [
                  "Sales tax",
                  "A return for each period of your registration; UAE VAT 28 days after",
                ],
                ["Licences and documents", "Their expiry dates"],
              ],
            },
          },
          {
            p: "Add your own items, once or repeating monthly, quarterly or yearly. Tick each one done. Overdue items show at the top, and Home's **Coming up** shows the next 60 days.",
          },
          {
            note: "The calendar is a reminder, not advice. Check the dates with your accountant; your situation may differ.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "Reminders",
        blocks: [
          {
            p: "Owners and admins get one email digest for items due in 30, 7 or 1 days, or today.",
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [
          {
            list: [
              "Saudi Arabia, Egypt, the US and Mexico's company filings (add them as your own items).",
            ],
          },
        ],
      },
    ],
    related: ["company-profile-and-documents", "sales-tax", "close-the-books"],
  },
];
