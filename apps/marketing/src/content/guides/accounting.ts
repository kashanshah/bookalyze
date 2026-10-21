import type { Guide } from "./types";

/** Accounting: the everyday books, tax, currencies and closing a period. */
export const ACCOUNTING_GUIDES: readonly Guide[] = [
  {
    slug: "transactions",
    category: "accounting",
    title: "Transactions: review, categorise, split, copy, remove",
    summary:
      "Every line that moves money in or out of a bank, card or cash account, in one list. Categorise straight on the list, split across categories, copy one that repeats, and tick it reviewed.",
    sections: [
      {
        heading: "The list",
        blocks: [
          { where: "Accounting → Transactions" },
          {
            list: [
              "Filter by account (its balance shows), category, money in or out, transfers, reviewed or not, and search.",
              "On a wide screen, click a date, description or amount to change it, and pick the account or category from a dropdown. Enter saves; Escape cancels.",
              "On a phone, tap a row to open it.",
              "The **…** menu: edit, **Copy as a new transaction**, see the journal entry, **Make a rule**, **Remove**.",
            ],
          },
        ],
      },
      {
        heading: "Add one",
        blocks: [
          {
            list: [
              "**Income**, **Expense** or **Transfer** between your accounts.",
              "Split an amount across several categories. A negative split goes the other way, such as fees taken out of a payout.",
              "Add a customer or vendor, or a new one on the spot.",
              "Typing a category that doesn't exist offers **Add as a new category**.",
              'Money back on something you bought: pick the expense under "Return on an expense" and it lowers that expense.',
            ],
          },
          {
            note: "An account in another currency asks for the exchange rate, filled in for the day. A transfer between currencies asks for the amount sent and the amount received.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "Editing is safe",
        blocks: [
          {
            p: "Your books keep a full history. Changing a transaction reverses the old entry and posts the corrected one; removing reverses it. The review tick and receipts carry over. Transactions in a closed period or a finished reconciliation are read-only.",
          },
        ],
      },
      {
        heading: '"Account not chosen"',
        blocks: [
          {
            p: 'Imported lines with no bank or card (Wave\'s "Unknown Account") are highlighted with **Choose account**. A banner counts them, with **Show only these**.',
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Every transaction either ticked reviewed or still to look at",
              "No uncategorised lines left at month end",
              "A paperclip on transactions that have receipts",
            ],
          },
        ],
      },
    ],
    related: ["bank-rules", "receipts", "duplicates-and-transfers", "journal-entries"],
  },
  {
    slug: "receipts",
    category: "accounting",
    title: "Receipts: upload, email in, attach",
    summary:
      "Drop receipts into the inbox, or email them to your company's receipts address, then attach each to its transaction. PDFs and photos up to 20 MB.",
    sections: [
      {
        heading: "Get receipts in",
        blocks: [
          { where: "Accounting → Receipts" },
          {
            list: [
              "**Upload** PDFs and images (including iPhone HEIC photos), up to 20 MB each.",
              "**Email them** to your receipts address (Copy is beside it). Up to 10 files per email; small logos in the email are left out.",
              "Or attach one straight from a transaction's **Receipts and files**.",
            ],
          },
        ],
      },
      {
        heading: "Attach",
        blocks: [
          {
            p: "Each receipt in the inbox has **Attach**: search for the transaction and pick it. An emailed receipt shows who sent it and offers a one-click search for the sender's name. Files stay attached when a transaction is edited, and can be added even in a closed period.",
          },
          {
            p: "Tick several receipts, or **Select all**, to delete them together. Files already attached are kept.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "An empty inbox once everything is attached",
              "A paperclip and count on transactions with receipts",
              "Emailed receipts arriving within a minute or two, with the sender",
            ],
          },
        ],
      },
    ],
    related: ["transactions", "move-from-wave", "invoice-requests"],
  },
  {
    slug: "customers-and-vendors",
    category: "accounting",
    title: "Customers and vendors",
    summary:
      "Keep the people you're paid by and pay, and see what you've received from or paid to each one, this year and all time.",
    sections: [
      {
        heading: "The list",
        blocks: [
          { where: "Accounting → Customers & vendors" },
          {
            p: "Tabs for everyone, customers, vendors and archived, with search, and money received and paid beside each. One contact can be both.",
          },
        ],
      },
      {
        heading: "A contact",
        blocks: [
          {
            list: [
              "Email, phone, tax number, address and notes.",
              "Totals for this financial year and all time.",
              "Recent transactions, and a link to all of them on Transactions.",
              "Archive one you no longer use; its history stays.",
            ],
          },
          {
            note: 'Add a customer or vendor while entering a transaction or a bank rule: "+ Add a new customer/vendor".',
            tone: "tip",
          },
        ],
      },
    ],
    related: ["transactions", "bank-rules", "move-from-wave"],
  },
  {
    slug: "journal-entries",
    category: "accounting",
    title: "Journal entries",
    summary:
      "For anything that isn't money in or out of a bank: depreciation, accruals, corrections. Debits and credits with a live balance check; entries can mix currencies.",
    sections: [
      {
        heading: "Make an entry",
        blocks: [
          { where: "Accounting → Journal entries → New entry" },
          {
            steps: [
              { title: "Date and description", body: "The date must be in an open period." },
              {
                title: "Lines",
                body: "An account and a debit or credit on each. The totals update as you type; **Balance with last line** fills the difference.",
              },
              { title: "Post", body: "Entries are numbered JE-0001, JE-0002 and so on." },
            ],
          },
          {
            p: "A line on an account in another currency asks for the exchange rate. Totals are always in your main currency.",
          },
        ],
      },
      {
        heading: "Change one",
        blocks: [
          {
            p: "Posted entries aren't edited in place. **Delete** reverses an entry on its own date; **Reverse** lets an accountant choose the date. Both stay in the journal, so the history is complete.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Debits equal credits before Post is allowed",
              "A reversed entry shows which entry reversed it",
              "Entries in a closed period show a **Closed period** badge",
            ],
          },
        ],
      },
    ],
    related: ["chart-of-accounts", "close-the-books", "currencies"],
  },
  {
    slug: "chart-of-accounts",
    category: "accounting",
    title: "Your chart of accounts",
    summary:
      "Every company starts with a ready-made chart. Add, rename and archive accounts; Bookalyze adds the marketplace accounts it needs when you set up posting.",
    sections: [
      {
        heading: "The chart",
        blocks: [
          { where: "Accounting → Chart of accounts" },
          {
            p: "Tabs for assets, liabilities, equity, income and expenses, grouped by kind, with each account's balance. Codes run from 1000 to 6000.",
          },
          {
            list: [
              "**Add an account** with what it's for, a name and an optional code. A bank, card or cash account can have its own currency.",
              "**Edit** the name or code. **Archive** one you no longer use; its history stays.",
              "You can also add a category from any category dropdown.",
            ],
          },
          {
            note: "Give a bank, card or cash account the currency the bank holds. Changing it later doesn't convert the amounts already in it.",
            tone: "caution",
          },
        ],
      },
    ],
    related: ["journal-entries", "how-payouts-post", "move-from-wave"],
  },
  {
    slug: "sales-tax",
    category: "accounting",
    title: "Sales tax: rates, registrations, tax on transactions",
    summary:
      "Start with your country's rates in one click (Canada's GST/HST, QST and PST, or UAE VAT), add your registration, and pick the tax on each category. Amounts include tax, as on a receipt.",
    sections: [
      {
        heading: "Set up",
        blocks: [
          { where: "Accounting → Sales tax" },
          {
            steps: [
              {
                title: "Use the starter for your country",
                body: "Creates the tax account and the usual rates for your country (and province in Canada).",
              },
              {
                title: "Add your registration",
                body: "The authority, your number, how often you file, and since when.",
              },
              {
                title: "Adjust rates",
                body: "Add, rename or archive. A rate in use keeps its percentage.",
              },
            ],
          },
          {
            p: "Not registered? Set nothing up and no tax picker appears.",
          },
        ],
      },
      {
        heading: "Tax on transactions",
        blocks: [
          {
            p: "Choose the tax beside each category. Amounts include tax, so **113.00 with HST 13%** is split into 100.00 of sales and 13.00 of tax collected, and the form says so as you type. Tax you paid is split out only when you can claim it back.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "A tax liability account (usually 2200) on your chart",
              "Reports → Sales tax shows collected, claimable and what you owe",
              "The filing periods follow your registration",
            ],
          },
        ],
      },
    ],
    related: ["sales-tax-report", "uae-vat-threshold", "buyer-invoices"],
  },
  {
    slug: "currencies",
    category: "accounting",
    title: "Currencies, exchange rates and transfers between currencies",
    summary:
      "Your books are kept in one main currency. Accounts, marketplaces and entries in other currencies are converted at each day's rate, and a transfer between currencies records what the bank really gave you.",
    sections: [
      {
        heading: "Your main currency",
        blocks: [
          {
            p: "Chosen when the company is created, and fixed once it has entries. Every report is in it.",
          },
        ],
      },
      {
        heading: "Exchange rates",
        blocks: [
          {
            p: "Rates come from the Bank of Canada every weekday and are filled in for you. The UAE dirham is fixed to the US dollar, so its rate is exact. The rate follows the date until you type your own.",
          },
          {
            note: "Not yet: rates for currencies the Bank of Canada doesn't publish, such as the Saudi riyal and the Egyptian pound. Type the rate your bank used.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "Transfers between currencies",
        blocks: [
          {
            p: "Moving money from a USD account to a CAD one asks for the **amount sent** and the **amount received**, and shows the bank's rate. The side in your main currency sets the value, so your books carry the real rate, not an estimate.",
          },
        ],
      },
      {
        heading: "Payouts in another currency",
        blocks: [
          {
            p: "A settlement in AED that lands in a CAD bank account is matched like any other. The small difference between the rate on the settlement date and the rate the bank gave is posted as an exchange gain or loss.",
          },
        ],
      },
    ],
    related: ["amazon-ae-payout-into-cad", "match-payouts", "duplicates-and-transfers"],
  },
  {
    slug: "close-the-books",
    category: "accounting",
    title: "Close the books",
    summary:
      "Lock everything up to a date so nothing can be posted, changed or removed in a finished period. Usually the end of a financial year or tax filing period.",
    sections: [
      {
        heading: "Close",
        blocks: [
          { where: "Settings → Company settings → Close the books (owners and admins)" },
          {
            p: "Pick the date, or use the quick picks: the end of last financial year, or the end of last month.",
          },
          {
            list: [
              "Nothing can be dated on or before it: not transactions, journal entries, imports or postings.",
              "Transactions in it open read-only; receipts can still be attached.",
              "New entries and reversals default to the first open day.",
            ],
          },
        ],
      },
      {
        heading: "Reopen",
        blocks: [
          {
            p: "Move the date back, or **Reopen all periods** (it asks for a second click). Every change is in the audit log.",
          },
        ],
      },
      {
        heading: "Before you close",
        blocks: [
          {
            check: [
              "Every bank, card and cash account reconciled to the date",
              "Every settlement and marketplace month in the books, and every payout matched",
              "Cost of goods sold posted for each month",
              "Sales tax report agrees with what you filed",
            ],
          },
        ],
      },
    ],
    related: ["month-end-for-sellers", "reconcile", "financial-reports"],
  },
];
