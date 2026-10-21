import type { Guide } from "./types";

/** Reports and views: Home's list, Channel profit, the financial reports, your stake, sales tax. */
export const REPORT_GUIDES: readonly Guide[] = [
  {
    slug: "home-needs-attention",
    category: "reports",
    title: "Home: what needs your attention",
    summary:
      "One list of everything waiting on you, each line opening the page where it's done. When it's empty, you're caught up.",
    sections: [
      {
        heading: "What it lists",
        blocks: [
          {
            table: {
              head: ["Group", "For example"],
              rows: [
                [
                  "Syncs that stopped",
                  "A bank or marketplace connection that needs new keys, with the reason",
                ],
                [
                  "Books",
                  "Transactions to categorise or review, possible duplicates, suggested transfers",
                ],
                [
                  "Marketplaces",
                  "Settlements and months ready to post, payouts whose deposit was found, a marketplace with no posting set up",
                ],
                [
                  "Stock",
                  "SKUs not linked to a product, months of cost of goods sold to post, products to reorder now, Noon's stock reports disagreeing",
                ],
                ["Invoices", "Buyers waiting for an invoice"],
                [
                  "Sales tax",
                  "Your last 12 months of sales near or over your country's registration threshold",
                ],
              ],
            },
          },
          {
            p: "Each group only shows when its feature is on. Home also has a glance at orders, units and sales for the last 7, 30 or 90 days.",
          },
        ],
      },
      {
        heading: "The sales-tax threshold",
        blocks: [
          {
            p: "For a company that isn't registered in its own country, the last 12 months of marketplace sales (after refunds) are compared with the threshold: AED 375,000 required and 187,500 voluntary in the UAE, SAR 375,000 and 187,500 in Saudi Arabia, CAD 30,000 in Canada. It tells you when you can register, when you're getting close (80%), and when you're over.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [{ check: ["\"You're all caught up\" at the end of each month's close"] }],
      },
    ],
    related: ["month-end-for-sellers", "uae-vat-threshold", "your-first-week"],
  },
  {
    slug: "channel-profit",
    category: "reports",
    title: "Channel profit: what each marketplace really makes",
    summary:
      "A column per marketplace, in its own currency, from sales down to profit after fees, ads, cost of goods and your own costs. All channels together in your main currency.",
    sections: [
      {
        heading: "Reading it",
        blocks: [
          { where: "Commerce → Channel profit" },
          {
            table: {
              head: ["Row", "What it is"],
              rows: [
                [
                  "Sales, refunds, promotions",
                  "What buyers paid, what went back, discounts → **net sales**",
                ],
                [
                  "Marketplace fees, advertising, reimbursements, other",
                  "What the marketplace took or gave back",
                ],
                ["Net from the marketplace", "What the channel earned before your costs"],
                [
                  "Cost of goods sold",
                  "The landed cost of what sold, less returns (posted months)",
                ],
                ["Stock lost or written off", "Lost less found, when there is some"],
                ["Your own costs", "Expense categories you count against this channel"],
                ["Shared costs", "Costs not split by channel (All channels only)"],
                ["Profit and margin", "Profit, and profit over net sales"],
                [
                  "Sales tax, held back",
                  "Not profit; shown so the total agrees with what was paid out",
                ],
              ],
            },
          },
          {
            p: "Hover a cell to see what's in it. A settlement counts in the period its last day falls in. A channel switched off or disconnected still shows what it earned, tagged.",
          },
        ],
      },
      {
        heading: "Ads, and each product",
        blocks: [
          {
            p: "With Amazon Ads connected, two more rows show under Profit: **Ad spend in the ads reports** and **TACOS**, for comparison (Profit counts the advertising in your books, so nothing counts twice). **By product** opens each product's profit after fees, cost and ads.",
          },
        ],
      },
      {
        heading: "Your own costs",
        blocks: [
          { where: "Commerce → Channel profit → Your own costs" },
          {
            p: "For each expense category: **Not counted**, **Shared**, or counted against one channel (say, a prep centre against Amazon.com). Entries the marketplace rows already count are left out, so nothing is counted twice.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Net from the marketplace agrees with the settlements for the period",
              "Cost of goods sold filled in for every posted month",
              "The period presets include **Last 3 financial years**",
            ],
          },
        ],
      },
    ],
    related: [
      "profit-after-ads",
      "are-you-losing-money",
      "cost-of-goods-sold",
      "ads-in-your-books",
      "financial-reports",
    ],
  },
  {
    slug: "financial-reports",
    category: "reports",
    title: "Profit and loss, balance sheet, trial balance",
    summary:
      "The standard reports for any period of your financial year, ready to print or hand to your accountant, plus the general ledger and every transaction.",
    sections: [
      {
        heading: "The reports",
        blocks: [
          { where: "Accounting → Reports" },
          {
            table: {
              head: ["Report", "Shows"],
              rows: [
                [
                  "Profit and loss",
                  "Income, cost of goods and expenses for a period, with gross profit",
                ],
                ["Balance sheet", "What the company owns and owes on a day, and its equity"],
                ["Trial balance", "Every account's balance on a day; debits equal credits"],
                ["General ledger", "Every line on every account in a period"],
                ["Accounting transactions", "Every entry in a period"],
                ["Your stake", "What you put in, took out, and the company is worth"],
                ["Sales tax", "Collected, claimable and owing for each filing period"],
              ],
            },
          },
          {
            p: "Periods come from your financial year: this year, last year, quarters, months, the last three financial years, or any dates. Every report prints.",
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [{ list: ["Comparing periods side by side (last year, last quarter)."] }],
      },
    ],
    related: ["your-stake", "sales-tax-report", "close-the-books", "channel-profit"],
  },
  {
    slug: "your-stake",
    category: "reports",
    title: "Your stake: what you put in, took out, and the company is worth",
    summary:
      "The owner's view: money you put in, money you took out, what the company is worth today, and whether you're up or down overall, year by year.",
    sections: [
      {
        heading: "Reading it",
        blocks: [
          { where: "Accounting → Reports → Your stake" },
          {
            list: [
              "**Put in**: owner contributions.",
              "**Took out**: drawings and dividends, everything that went from the company to you.",
              "**Worth**: what it owns (cash, stock at cost, money on its way, everything else) less what it owes.",
              "**You're up or down** by worth less net put in: every year's profit added up.",
            ],
          },
          {
            p: "A table by financial year shows put in, took out, net and profit, and a check that worth equals net put in plus profit. Click any year's Put in or Took out to see the entries behind it.",
          },
        ],
      },
    ],
    related: ["financial-reports", "stock-taken-out"],
  },
  {
    slug: "sales-tax-report",
    category: "reports",
    title: "The sales tax report",
    summary:
      "Tax collected, tax you can claim back, and what you owe or get back, for each filing period your registration sets.",
    sections: [
      {
        heading: "Run it",
        blocks: [
          { where: "Accounting → Reports → Sales tax" },
          {
            p: "The periods follow your active registration (monthly, quarterly in your financial year, or yearly), starting at the last finished one. Each rate shows sales and tax collected, purchases and tax paid, and the total owing or refund.",
          },
          {
            note: "Edits and removals net out, so a corrected transaction counts once.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Every rate you charged or paid appears, with its sales or purchases",
              "The total owing (or refund) agrees with the return you file",
            ],
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [{ list: ["Filing the return from Bookalyze; you file with your tax authority."] }],
      },
    ],
    related: ["sales-tax", "uae-vat-threshold", "close-the-books"],
  },
];
