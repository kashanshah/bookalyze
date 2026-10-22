import type { Guide } from "./types";

/** Getting started: how the money moves, the company, the team, moving in, the first week. */
export const START_GUIDES: readonly Guide[] = [
  {
    slug: "how-bookalyze-works",
    category: "start",
    title: "How Bookalyze works: the path your money takes",
    summary:
      "Orders tell you what sold; settlements and payouts tell you what you were paid. Here's what comes in from each marketplace, what posts to your books and when, and why every payout passes through a clearing account on its way to your bank.",
    sections: [
      {
        heading: "Orders aren't money yet",
        blocks: [
          {
            p: "Orders arrive from Amazon, Walmart, Noon and eBay every half hour, with their items, refunds and claims. They're for running the business: searching, invoicing buyers, asking for reviews, counting units for cost of goods sold. **Orders never post to your books.** The marketplace's own money report does.",
          },
          {
            table: {
              head: ["Marketplace", "What posts", "Into"],
              rows: [
                [
                  "Amazon",
                  "Each settlement, as one entry",
                  "Your clearing account (e.g. Amazon Clearing)",
                ],
                ["Walmart", "Each settlement, as one entry", "A Walmart balance account"],
                ["Noon", "Each country's month, as one entry", "A Noon balance account"],
                ["eBay", "Each site's month, as one entry", "An eBay balance account"],
              ],
            },
          },
        ],
      },
      {
        heading: "Why a clearing account",
        blocks: [
          {
            p: "A settlement holds sales, refunds, fees, advertising, tax and amounts held back, and ends with what the marketplace pays you. The entry puts each group on its own account and the payout on the **clearing account**: money that's yours but not in the bank yet.",
          },
          {
            p: "When the payout lands, Bookalyze finds the deposit in your bank and **matches** it: the deposit moves to the clearing account, which goes back to zero. Your sales are counted once, from the settlement, and the deposit isn't counted as income a second time.",
          },
          {
            note: "If you used to categorise marketplace deposits as sales (the way many people do in Wave), matching moves them for you. That's the double counting the clearing account removes.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "What runs on its own",
        blocks: [
          {
            list: [
              "**Every half hour:** orders from every connected marketplace.",
              "**Every day:** settlements and marketplace money, Wise bank lines, exchange rates.",
              "**If you switch it on:** new settlements and months posted automatically, and deposits with exactly one exact match matched for you.",
              "**Every hour:** automatic review requests, if you use them.",
              "**Every month, by you:** cost of goods sold, once the month is over.",
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Commerce → Settlements lists your settlements as **Ready to post**, then **In books**",
              "After matching, the clearing account's balance is close to zero (only payouts still on their way)",
              "Home's **Needs your attention** lists anything waiting on you",
            ],
          },
        ],
      },
    ],
    related: ["your-first-week", "how-payouts-post", "match-payouts"],
  },
  {
    slug: "create-your-company",
    category: "start",
    title: "Create your company",
    summary:
      "Name, country, main currency, time zone and financial year, then switch on the parts the business needs. Each company you run is completely separate, with its own books, team and connections.",
    sections: [
      {
        heading: "The set-up wizard",
        blocks: [
          {
            p: "After signing up, the wizard asks a few questions. Each one has a hint; nothing is hard to change later except the main currency, which every amount is reported in.",
          },
          {
            steps: [
              {
                title: "Name and business type",
                body: "The name you trade under, and what kind of business it is.",
              },
              {
                title: "Country and region",
                body: "Where the company is registered. It picks the right sales tax pack and the compliance calendar.",
              },
              {
                title: "Main currency",
                body: "What your books are kept in: usually your country's currency. Marketplaces and banks in other currencies are converted at each day's rate.",
              },
              {
                title: "Time zone and language format",
                body: "Dates and the daily jobs follow your time zone.",
              },
              {
                title: "When does your financial year end?",
                body: "Any month and day. A company in its first year can have a short first year.",
              },
            ],
          },
        ],
      },
      {
        heading: "Switch on what you need",
        blocks: [
          { where: "Settings → Features" },
          {
            p: "Each part of Bookalyze is a feature you can switch on or off: Accounting, Banking, Entity & compliance, Commerce, Inventory and Review requests. Some need others (Commerce needs Accounting; Inventory and Review requests need Commerce), and the page says so.",
          },
          {
            note: "A company that only keeps books can leave Commerce off. The sidebar only shows what's on.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "Another company",
        blocks: [
          {
            p: "Use the company switcher to add another. A Canadian corporation and a Dubai trading licence each get their own currency, tax, financial year, team and connections, and one company can never see another's data.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Home greets you with the getting-started steps",
              "Accounting → Chart of accounts has a ready-made chart you can edit",
              "Settings shows your country, currency and financial year",
            ],
          },
        ],
      },
    ],
    related: ["invite-your-team", "your-first-week", "move-from-wave"],
  },
  {
    slug: "invite-your-team",
    category: "start",
    title: "Invite your team and your accountant",
    summary:
      "Invite people to one company at a time, as an owner, admin or member. Your accountant can look after one company without seeing the others.",
    sections: [
      {
        heading: "Roles",
        blocks: [
          {
            table: {
              head: ["Role", "What they can do"],
              rows: [
                ["Owner", "Full control, including deleting the company"],
                [
                  "Admin",
                  "Change settings and features, invite or remove people, manage connections and posting",
                ],
                ["Member", "Use the books and features, but not change settings"],
              ],
            },
          },
          {
            note: "A read-only or accountant role isn't there yet: a member can post entries. Give people the role they need.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "Invite someone",
        blocks: [
          { where: "Settings → Team members" },
          {
            steps: [
              {
                title: "Enter their email and choose a role",
                body: "They get an email invitation to this company only.",
              },
              {
                title: "They accept",
                body: "With a new account, or the one they already have. They then see this company in their switcher.",
              },
            ],
          },
          {
            p: "Every change anyone makes is recorded in the company's audit log: who, what and when.",
          },
        ],
      },
    ],
    related: ["create-your-company", "company-profile-and-documents"],
  },
  {
    slug: "move-from-wave",
    category: "start",
    title: "Move from Wave (or QuickBooks, Xero, Zoho Books, Sage)",
    summary:
      "Bring your history in from one CSV of journal lines, with your customers and vendors and Wave's receipt files. It runs in your browser, can be undone, and the file is never stored.",
    sections: [
      {
        heading: "Export from your old software",
        blocks: [
          {
            p: "Bookalyze reads one file of journal lines: one row per line of each transaction. The import wizard shows the export steps for Wave, QuickBooks, Xero, Zoho Books and Sage, and works with any other program that can export the same.",
          },
          {
            note: "From Wave: Settings → Data export → Accounting transactions (CSV).",
            tone: "tip",
          },
        ],
      },
      {
        heading: "Import",
        blocks: [
          { where: "Accounting → Import (owners and admins)" },
          {
            steps: [
              {
                title: "Choose the program and the file",
                body: "The file is read in your browser; nothing is uploaded until you confirm.",
              },
              {
                title: "Check the columns",
                body: "Bookalyze guesses the date, account, debit and credit (or amount) columns, with a live preview.",
              },
              {
                title: "Match the accounts",
                body: "Each old account is matched to yours by code or name, or created with the right type.",
              },
              {
                title: "Review and import",
                body: "Rows that don't balance or have a bad date are listed with their line numbers and left out. Dates in a closed period are blocked, and you're warned if the books already have entries in those dates.",
              },
            ],
          },
          {
            p: "On the review step, add Wave's customer and vendor lists too: emails, phones and addresses fill in the contacts (bank account numbers are never read).",
          },
        ],
      },
      {
        heading: "Receipts from Wave",
        blocks: [
          {
            p: "Wave exports receipts as files named like **2026-03-14-Office_Depot.pdf**. Upload them on the Import page: each is attached to the transaction within 3 days that best matches the name. Anything unclear goes to the Receipts inbox, so nothing is attached to the wrong line.",
          },
        ],
      },
      {
        heading: "Import twice, or undo",
        blocks: [
          {
            list: [
              "Importing the same file again only adds what's new.",
              "**Undo** on the import list removes that import's entries, and its accounts and contacts if nothing else uses them.",
              "Undo is refused if an imported entry was edited since, or falls in a closed period.",
            ],
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [
          {
            list: [
              "Amounts are taken in your main currency (Wave exports converted amounts).",
              "Wave's separate bills file isn't read; bills reach the books through the transactions file.",
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The import list shows the batch with how many entries it added",
              "Accounting → Reports → Trial balance agrees with your old software's for the same date",
              "Matched receipts show a file icon on their transactions",
            ],
          },
        ],
      },
    ],
    related: ["transactions", "receipts", "chart-of-accounts"],
  },
  {
    slug: "your-first-week",
    category: "start",
    title: "Your first week: from sign-up to the first matched payout",
    summary:
      "A checklist that gets a selling business fully set up: company, bank, marketplaces, posting, the first matched payout, and stock.",
    sections: [
      {
        heading: "Day 1: the company and the bank",
        blocks: [
          {
            check: [
              "Create the company (country, main currency, financial year)",
              "Switch on Commerce, and Inventory if you hold stock",
              "Connect Wise, or upload a statement from your bank",
              "Moving from Wave? Import your history",
            ],
          },
        ],
      },
      {
        heading: "Day 2: your marketplaces",
        blocks: [
          {
            check: [
              "Commerce → Channels → Add a channel: Amazon, Walmart, Noon or eBay",
              "Paste the keys (each marketplace's guide shows where to get them)",
              "Switch off any marketplace you don't sell on",
              "Choose the day to bring orders in from",
            ],
          },
        ],
      },
      {
        heading: "Day 3: payouts in your books",
        blocks: [
          {
            check: [
              "Choose how each marketplace posts: an account for sales, fees, refunds, ads and tax, and the clearing or balance account",
              "Post the first settlement or month",
              "Match its payout to the bank deposit",
              "Switch on automatic posting once it looks right",
            ],
          },
        ],
      },
      {
        heading: "Days 4 and 5: stock and cost of goods",
        blocks: [
          {
            check: [
              "Inventory → Products: link each marketplace SKU to its product",
              "Add opening stock, or your purchase orders and deliveries",
              "Post last month's cost of goods sold",
              "Look at Commerce → Channel profit",
            ],
          },
        ],
      },
      {
        heading: "Extras worth an hour",
        blocks: [
          {
            list: [
              "Turn on automatic review requests (Amazon).",
              "Set up the invoice-requests forwarding address, and your brand for invoices.",
              "Add bank rules for the routine lines.",
            ],
          },
        ],
      },
    ],
    related: ["how-bookalyze-works", "connect-amazon", "how-payouts-post", "match-payouts"],
  },
];
