import type { Guide } from "./types";

/** Banking: statements from any bank, rules, duplicates and transfers, reconciling. */
export const BANKING_GUIDES: readonly Guide[] = [
  {
    slug: "upload-bank-statements",
    category: "banking",
    title: "Upload bank statements from any bank",
    summary:
      "For banks without a live connection: upload the statement CSV, match its columns once, and every later upload reuses them. The same file twice adds nothing twice.",
    sections: [
      {
        heading: "Upload",
        blocks: [
          { where: "Banking → Bank accounts → Upload a statement" },
          {
            steps: [
              { title: "Choose the account and the file", body: "Any CSV your bank exports." },
              {
                title: "Match the columns, the first time",
                body: "Date, description, one amount column or separate money out and money in, reference, and an optional **balance** column. A five-row preview and the date range show you've got it right.",
              },
              {
                title: "Upload",
                body: "Later uploads to the same account reuse the columns (**Change columns** to adjust).",
              },
            ],
          },
          {
            p: "A file holding several accounts has an account-number column: pick the one you want. Only the last four digits are kept, never the number.",
          },
        ],
      },
      {
        heading: "Nothing twice",
        blocks: [
          {
            list: [
              "The same statement, or one that overlaps, only adds what's new.",
              "Two identical lines on the same day (two coffees) are both kept.",
              "Rules categorise matching lines as they arrive, and possible duplicates are flagged, just as with Wise.",
            ],
          },
        ],
      },
      {
        heading: "Bank balance beside the books",
        blocks: [
          {
            p: 'With a balance column, each account shows **what the bank says** next to **its balance in Bookalyze**: "Matches", or "The bank has X more". Reconcile to find the difference.',
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The account's card shows the last upload and its balance",
              "New lines on Accounting → Transactions, uncategorised unless a rule caught them",
              "Uploading the same file again says nothing new was added",
            ],
          },
        ],
      },
    ],
    related: ["connect-wise", "bank-rules", "duplicates-and-transfers", "reconcile"],
  },
  {
    slug: "bank-rules",
    category: "banking",
    title: "Bank rules: categorise the routine automatically",
    summary:
      "A rule puts every bank line whose description contains some words into a category, as it arrives. Bookalyze also suggests rules for payees you keep categorising the same way.",
    sections: [
      {
        heading: "Make a rule",
        blocks: [
          { where: "Banking → Rules" },
          {
            list: [
              "**When the description contains** some words (case and spacing don't matter)",
              "**Money** in, out or either, and optionally **on** one bank or card account",
              "**Amount from / up to**, if it should only catch some sizes",
              "**Put it in** a category, and optionally a customer or vendor",
            ],
          },
          {
            p: "The form counts the uncategorised transactions it would catch: **Save and categorize N** applies it to them straight away. Rules run in order; the first that matches wins.",
          },
          {
            note: "In a transaction's dialog, **Make a rule** opens the form filled in from it.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "Suggested rules",
        blocks: [
          {
            p: "When you've categorised the same payee the same way by hand at least three times in the last year, it appears under **Suggested for you**. Make this rule opens it filled in; the X turns it down for good.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Rule-categorised transactions show a wand on the Transactions list",
              "They stay unreviewed, so you still tick them",
              "Each rule says how many transactions it has categorised",
            ],
          },
        ],
      },
    ],
    related: ["transactions", "upload-bank-statements", "connect-wise"],
  },
  {
    slug: "duplicates-and-transfers",
    category: "banking",
    title: "Possible duplicates and transfers between your accounts",
    summary:
      "A bank line that looks like a transaction already in your books is flagged, never merged on its own. Money out of one of your accounts and into another is suggested as a transfer.",
    sections: [
      {
        heading: "Possible duplicates",
        blocks: [
          {
            p: "Everything the bank sends is posted. One that looks like a transaction already in the books (same account, same amount, within five days) is highlighted as **Possible duplicate of JE-…**.",
          },
          {
            list: [
              "**Merge** keeps the one that was there first; the bank link and receipts move to it.",
              "**Not a duplicate** keeps both, and that pair isn't flagged again.",
              "Tick two transactions yourself and **Merge** them, when they match.",
            ],
          },
        ],
      },
      {
        heading: "Transfers",
        blocks: [
          {
            p: "Money out of one bank, card or cash account and into another within five days, both uncategorised, is suggested as a transfer: the exact amount in one currency, or within 3% between currencies.",
          },
          {
            list: [
              "**Match as transfer** makes the two one transfer, dated when the money left.",
              "**Not a transfer** turns the pair down.",
              "**Unmatch** puts both back as they were.",
              "Ticking two transactions offers **Match** when they can be a transfer.",
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Banners on Transactions count possible duplicates and transfers, with **Show only these**",
              "After merging, one transaction is left, with its receipts",
              "A matched transfer shows both accounts, and neither side is income or expense",
            ],
          },
        ],
      },
    ],
    related: ["transactions", "currencies", "reconcile"],
  },
  {
    slug: "reconcile",
    category: "banking",
    title: "Reconcile an account against its statement",
    summary:
      "Enter the statement's date and ending balance, tick what's on it, and finish when the difference is zero. Reconciled transactions are locked until you undo.",
    sections: [
      {
        heading: "Reconcile",
        blocks: [
          { where: "Accounting → Reconcile" },
          {
            steps: [
              {
                title: "Choose the account",
                body: "Each bank, card and cash account shows the date it's reconciled through.",
              },
              { title: "Enter the statement", body: "Its date and ending balance." },
              {
                title: "Tick each line on the statement",
                body: "Search, filter and tick all shown. The bar keeps the statement, cleared and the difference in view; a balance column shows where the books and the statement part ways.",
              },
              { title: "Finish at zero", body: "Finish is enabled once the difference is zero." },
            ],
          },
        ],
      },
      {
        heading: "After",
        blocks: [
          {
            list: [
              "Reconciled transactions show a lock and open read-only.",
              "**Undo** the latest reconciliation to change one.",
              "The account's history lists every reconciliation.",
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Difference **0.00** and Finish enabled",
              'The account\'s "reconciled through" date moves to the statement date',
              "Banking → Bank accounts says the bank and the books **Match**",
            ],
          },
        ],
      },
    ],
    related: ["upload-bank-statements", "close-the-books", "books-agree-with-marketplaces"],
  },
];
