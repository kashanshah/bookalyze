import type { Guide } from "./types";

/**
 * Worked examples: real jobs from start to finish, each with the checks that prove it worked.
 * The numbers in them are made up, and say so.
 */
export const PLAYBOOK_GUIDES: readonly Guide[] = [
  {
    slug: "are-you-losing-money",
    category: "playbooks",
    title: "Are you losing money? Find the channel or product that is",
    summary:
      "A marketplace can look busy and still lose money once fees, ads, refunds and the real cost of each unit are counted. Here's how to find where, in about half an hour.",
    sections: [
      {
        heading: "Before you start",
        blocks: [
          {
            check: [
              "Your marketplaces' settlements or months are in Bookalyze (they don't need to be posted)",
              "Your SKUs are linked to products",
              "Landed costs on your deliveries, or opening stock with its cost",
              "Cost of goods sold posted for the months you'll look at",
            ],
          },
        ],
      },
      {
        heading: "1. Which marketplace",
        blocks: [
          { where: "Commerce → Channel profit" },
          {
            p: "Pick the last three or six months. Read each column down to **Profit** and the margin. A channel with healthy sales and a thin or negative profit is the place to look.",
          },
          {
            list: [
              "**Fees** high against net sales? Check the fulfilment fees on your biggest SKUs.",
              "**Advertising** eating the margin? Compare it with the extra sales.",
              "**Refunds** high? Look at which orders on Commerce → Orders → Refunded.",
              "**Your own costs**: count prep, storage and software against the channels they serve, so the comparison is fair.",
            ],
          },
        ],
      },
      {
        heading: "2. Which product",
        blocks: [
          { where: "Inventory → Prices" },
          {
            p: "Each Amazon listing's price beside its landed cost. Open **Change price** on a suspect to see Amazon's fee estimate and the profit and margin at today's price, without changing anything.",
          },
          {
            note: "A 2-pack or a bundle is costed with every unit in it, so the margin is the real one.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "3. Decide",
        blocks: [
          {
            list: [
              "Raise the price, and watch the listing with **Listing watch** to see how competitors move.",
              "Cut the ad spend on that product or channel.",
              "Reorder less of it: **Reorder** shows how many it really sells.",
              "Or stop selling it there, and switch the channel off if nothing else sells.",
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Every channel's profit, after cost of goods and your own costs",
              "A margin for each listing you checked",
              "Next month's Channel profit showing the change",
            ],
          },
        ],
      },
    ],
    related: ["channel-profit", "amazon-prices", "landed-cost-and-lots", "cost-of-goods-sold"],
  },
  {
    slug: "month-end-for-sellers",
    category: "playbooks",
    title: "Month end for marketplace sellers, in order",
    summary:
      "The monthly close for a selling business, step by step, with the check after each. Most months it takes under an hour once automatic posting is on.",
    sections: [
      {
        heading: "The steps",
        blocks: [
          {
            steps: [
              {
                title: "Bring everything in",
                body: "Bank lines (Wise syncs daily; upload other banks' statements), settlements, Noon and eBay months, and the stock ledgers.",
              },
              {
                title: "Post the money",
                body: "Every settlement and marketplace month that ended in the month. Check: none left **Ready to post**.",
              },
              {
                title: "Match the payouts",
                body: "Each payout to its bank deposit. Check: the clearing and balance accounts hold only payouts still on their way.",
              },
              {
                title: "Categorise and review",
                body: "Every bank line categorised and ticked. Settle possible duplicates and transfers. Check: Transactions shows nothing uncategorised.",
              },
              {
                title: "Receipts",
                body: "Attach what's in the receipts inbox. Check: the inbox is empty.",
              },
              {
                title: "Stock",
                body: "Record deliveries and their landed costs, link new SKUs, then post the month's cost of goods sold. Check: the month is **Posted** for each marketplace.",
              },
              {
                title: "Reconcile",
                body: "Each bank, card and cash account against its statement. Check: the difference is 0.00.",
              },
              {
                title: "Read the month",
                body: "Channel profit and Profit and loss. Check: nothing surprising you can't explain.",
              },
              {
                title: "Close",
                body: "At a filing period or year end, run the sales tax report and close the books through the last day.",
              },
            ],
          },
        ],
      },
      {
        heading: "Done when",
        blocks: [{ check: ["Home says **You're all caught up**"] }],
      },
    ],
    related: [
      "books-agree-with-marketplaces",
      "close-the-books",
      "match-payouts",
      "cost-of-goods-sold",
    ],
  },
  {
    slug: "amazon-ae-payout-into-cad",
    category: "playbooks",
    title: "An Amazon.ae payout in dirhams, deposited in Canadian dollars",
    summary:
      "A Canadian company selling on Amazon.ae: the settlement posts in AED, the payout lands in a CAD bank account at the bank's rate, and the small difference is an exchange loss or gain.",
    sections: [
      {
        heading: "The example",
        blocks: [
          {
            note: "The numbers here are made up to show the steps.",
            tone: "caution",
          },
          {
            p: "A settlement ends on October 3 and pays **AED 10,000.00**. Bookalyze posts it in dirhams, valued at that day's rate, say **1 AED = 0.3720 CAD**, so the payout is worth **CAD 3,720.00** on your clearing account. The bank deposits **CAD 3,689.40** two days later.",
          },
        ],
      },
      {
        heading: "Match it",
        blocks: [
          { where: "Commerce → Settlements → the settlement → Match" },
          {
            p: "Deposits in another currency are offered when they're within 10% of the market rate on Amazon's deposit date. The candidate shows the bank's rate, how far it is from the market, and the exchange difference. **Match at this rate**.",
          },
          {
            table: {
              head: ["Account", "Debit", "Credit"],
              rows: [
                ["Bank (CAD)", "3,689.40", ""],
                ["Loss on foreign exchange", "30.60", ""],
                ["Amazon.ae clearing (AED 10,000.00)", "", "3,720.00"],
              ],
            },
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The clearing account back at zero, in dirhams and in Canadian dollars",
              'The settlement page says "valued at 1 AED = … CAD"',
              "Profit and loss shows the exchange loss on its own line",
            ],
          },
          {
            note: "Converted deposits are never matched in bulk or automatically: you confirm each one.",
            tone: "tip",
          },
        ],
      },
    ],
    related: ["match-payouts", "currencies", "amazon-settlements"],
  },
  {
    slug: "alibaba-to-fba",
    category: "playbooks",
    title: "From an Alibaba order to FBA sales and cost of goods sold",
    summary:
      "The whole path of a batch of stock: the purchase order from the Alibaba receipt, the freight paid to a forwarder, the delivery's landed cost, and the cost of the units that sold.",
    sections: [
      {
        heading: "The example",
        blocks: [
          {
            note: "The numbers here are made up to show the steps, in a company kept in US dollars.",
            tone: "caution",
          },
          {
            p: "500 mugs from an Alibaba supplier at **USD 2.00** each (USD 1,000.00), shipped by a forwarder for **USD 250.00**, sent to Amazon's warehouse. In October, 120 sell.",
          },
        ],
      },
      {
        heading: "The steps",
        blocks: [
          {
            steps: [
              {
                title: "The order from the receipt",
                body: "Inventory → Purchase orders → New → **Fill in from an Alibaba receipt**. Check the supplier, the mug line and the total, then **Save draft** and **Mark as sent**.",
              },
              {
                title: "Pay the supplier",
                body: "Payments → **Record a payment**, or link the bank line with **Already in my books**.",
              },
              {
                title: "Record the delivery",
                body: "**Record a delivery** for the 500 when they arrive at Amazon.",
              },
              {
                title: "Pay the forwarder for that delivery",
                body: "Record a payment to the forwarder, for the delivery. It goes on the landed cost as freight.",
              },
              {
                title: "Check the landed cost",
                body: "The lot shows 500 mugs at **USD 2.50** each: 2.00 from the supplier and 0.50 of freight.",
              },
              {
                title: "Post October's cost of goods sold",
                body: "Inventory → Cost of goods sold → **Post** for Amazon: 120 × 2.50 = **USD 300.00**.",
              },
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Stock lots: 380 of 500 left",
              "Channel profit for October shows cost of goods sold USD 300.00",
              "Inventory → Prices shows a cost of 2.50 on the mug's listing (5.00 on a 2-pack)",
              "Stock compares your 380 with what Amazon holds",
            ],
          },
        ],
      },
    ],
    related: ["purchase-orders", "supplier-payments", "landed-cost-and-lots", "cost-of-goods-sold"],
  },
  {
    slug: "uae-vat-threshold",
    category: "playbooks",
    title: "Approaching the UAE VAT threshold",
    summary:
      "Registration becomes required once taxable sales pass AED 375,000 over 12 months. Bookalyze tells you when you're close; here's what changes when you register.",
    sections: [
      {
        heading: "Watching the threshold",
        blocks: [
          {
            p: "For a UAE company that isn't registered, Home compares your last 12 months of marketplace sales (after refunds) with the thresholds: from **AED 187,500** you may register, from 80% of **AED 375,000** you're warned, and past it registration is due.",
          },
          {
            note: "The rule: register within 30 days of passing AED 375,000 over the last 12 months, or of expecting to in the next 30. Confirm with the FTA or your tax adviser.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "Once you're registered",
        blocks: [
          {
            steps: [
              {
                title: "Add the registration",
                body: "Accounting → Sales tax: the UAE starter adds VAT 5% and zero-rated, and the tax account. Add your TRN, quarterly or monthly, and the date.",
              },
              {
                title: "Add the TRN to the company",
                body: "Entity & compliance → Profile → Registration numbers.",
              },
              {
                title: "Tax on new transactions",
                body: "Pick VAT on taxed categories; tax you pay is split out to claim back.",
              },
              {
                title: "Invoices change",
                body: "Buyer invoices become **Tax invoices** (فاتورة ضريبية) with your TRN.",
              },
            ],
          },
          {
            p: "The compliance calendar adds a VAT return 28 days after each period.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The threshold line leaves Home",
              "A new invoice says Tax invoice and shows your TRN",
              "Reports → Sales tax has your first period",
            ],
          },
        ],
      },
    ],
    related: ["sales-tax", "buyer-invoices", "compliance-calendar", "home-needs-attention"],
  },
  {
    slug: "books-agree-with-marketplaces",
    category: "playbooks",
    title: "Prove your books agree with the marketplaces and the bank",
    summary:
      "Every check Bookalyze offers, in one list: settlements that balance, marketplace balances, stock compared, bank against books, and reconciliation.",
    sections: [
      {
        heading: "The checks",
        blocks: [
          {
            table: {
              head: ["Check", "Where", "Passes when"],
              rows: [
                [
                  "Each settlement adds up",
                  "Commerce → Settlements",
                  "No settlement says **Check**",
                ],
                ["Walmart's reports read", "Settlements → Walmart", "None says **Needs a look**"],
                ["Noon's balance", "Settlements → Noon", "**Your books agree with Noon**"],
                ["Clearing at zero", "Balance sheet", "Only payouts still on their way"],
                ["Stock compared", "Inventory → Stock", "**Matches** for each product"],
                ["Noon's stock reports", "Stock movements", "Noon's two reports agree"],
                ["Bank against books", "Banking → Bank accounts", "**Matches**"],
                ["Reconciled", "Accounting → Reconcile", "Difference 0.00 through the month end"],
              ],
            },
          },
        ],
      },
      {
        heading: "When one doesn't pass",
        blocks: [
          {
            list: [
              "A settlement that says Check: open it; the groups show where the lines and Amazon's total part ways.",
              "Clearing not at zero: a payout not matched yet, or a deposit categorised as sales.",
              "Stock off: months not posted, units lost outside a marketplace, or a delivery not recorded.",
              "Bank off: a missing statement, or a transaction entered twice.",
            ],
          },
        ],
      },
    ],
    related: ["month-end-for-sellers", "reconcile", "stock-overview", "match-payouts"],
  },
];
