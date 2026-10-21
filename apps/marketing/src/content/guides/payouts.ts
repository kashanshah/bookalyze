import type { Guide } from "./types";

/** Payouts in the books: posting each marketplace's money and matching it to the bank. */
export const PAYOUT_GUIDES: readonly Guide[] = [
  {
    slug: "how-payouts-post",
    category: "payouts",
    title: "How payouts post to your books",
    summary:
      "Choose an account for each kind of money (sales, refunds, fees, ads, tax, held back) and a clearing or balance account for the payout, pick the day posting starts, then post by hand or automatically. The same idea for Amazon, Walmart, Noon and eBay.",
    sections: [
      {
        heading: "One entry per payout period",
        blocks: [
          {
            p: "Each marketplace sends its money differently, but they all post the same way: **one entry** per Amazon or Walmart settlement, or per Noon country's or eBay site's month. Each kind of money goes to its own account, and what the marketplace owes you goes to a **clearing** or **balance** account until it reaches your bank.",
          },
          {
            table: {
              head: ["Marketplace", "Choose accounts on", "Payout goes to"],
              rows: [
                [
                  "Amazon",
                  "Commerce → Settlements → How settlements post",
                  "A clearing account (ideally Money in transit)",
                ],
                [
                  "Walmart",
                  "Commerce → Settlements → Walmart → How Walmart posts",
                  "A Walmart balance account",
                ],
                [
                  "Noon",
                  "Commerce → Settlements → Noon → How Noon posts",
                  "A Noon balance account",
                ],
                [
                  "eBay",
                  "Commerce → Settlements → eBay → How eBay posts",
                  "An eBay balance account",
                ],
              ],
            },
          },
        ],
      },
      {
        heading: "Choose the accounts",
        blocks: [
          {
            steps: [
              {
                title: "Pick an account for each group",
                body: "Sales, refunds, promotions, the marketplace's fees, advertising, sales tax, reimbursements, held back and released, other. The first time, accounts are suggested from your chart's names; check them. Each list has **Add a new account**.",
              },
              {
                title: "Pick the clearing or balance account",
                body: "An asset, ideally of the **Money in transit** kind. It holds the payout until the bank deposit is matched.",
              },
              {
                title: "Choose when posting starts",
                body: "By default the start of your financial year. Settlements or months before it are listed but never posted.",
              },
              {
                title: "Save, then post",
                body: "Post one to see the entry, or **Post N ready**. Once it looks right, switch on **Post automatically**: the daily job posts what's ready.",
              },
            ],
          },
        ],
      },
      {
        heading: "Tax the marketplace collects",
        blocks: [
          {
            p: "Where Amazon or Walmart collects and pays sales tax for you, the tax the buyer paid and the tax the marketplace withheld are in the same group, so they cancel out. Map that group to your sales tax account; it never counts as income.",
          },
          {
            p: "**Tax on Amazon's fees** (VAT, GST/HST) has its own line: map it to your fees (a cost) if you're not registered, or to your recoverable tax account if you are.",
          },
        ],
      },
      {
        heading: "Change your mind",
        blocks: [
          {
            list: [
              "**Take out of books** reverses an entry on its own date.",
              "**Post again** reverses and reposts with the accounts as they are now, keeping a matched deposit matched.",
              "A Noon or eBay month, or a Walmart settlement, that changes after posting shows **Changed since posted**; Post again brings it up to date.",
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Each posted settlement or month says **In books** with its entry number (JE-…)",
              "The entry's lines add up: groups on their accounts, the payout on clearing",
              "Profit and loss shows sales, fees and ads on their own lines",
            ],
          },
        ],
      },
    ],
    related: ["match-payouts", "amazon-settlements", "noon-months", "how-bookalyze-works"],
  },
  {
    slug: "amazon-settlements",
    category: "payouts",
    title: "Amazon settlements: bring in, upload, post",
    summary:
      "Every Amazon settlement comes in on its own and reads line by line. Upload older ones, or rebuild years of history from one date range transaction report, then post each as one entry.",
    sections: [
      {
        heading: "Bring them in",
        blocks: [
          { where: "Commerce → Settlements" },
          {
            p: "The daily job brings in new settlement reports; **Bring in settlements** asks straight away. Amazon lists about the last 90 days, and rations requests hard, so a first look can take a few rounds. It needs the **Finance and Accounting** role.",
          },
        ],
      },
      {
        heading: "Older settlements",
        blocks: [
          {
            p: "**Upload settlement files** (admins) takes two kinds of file. Both are read in your browser.",
          },
          {
            table: {
              head: ["File", "Where in Seller Central", "Good for"],
              rows: [
                ["Flat File V2", "Payments → All statements", "One settlement per file"],
                [
                  "Date range transaction report",
                  "Payments → Reports Repository → Transaction, custom range",
                  "Every settlement back to the start, in one CSV, plus older orders",
                ],
              ],
            },
          },
          {
            p: "The transaction report has no reserve lines, so Bookalyze works out what Amazon **held back and released** from each payout, and the payouts still match your bank. Settlements already here are kept as they are.",
          },
        ],
      },
      {
        heading: "Read a settlement",
        blocks: [
          {
            p: "Each settlement's page groups its lines in plain names (\"Referral fee\", not \"Commission\") with subtotals: sales, refunds, promotions, Amazon fees, tax on Amazon's fees, advertising, tax Amazon collects and pays, reimbursements, held back and released, other. A settlement whose lines don't add up to Amazon's total says **Check**.",
          },
          {
            p: "A **negative settlement** (fees and refunds above sales, say a quiet month with the plan fee) shows **No payout**: Amazon charges your card or carries it into the next one.",
          },
        ],
      },
      {
        heading: "Post it",
        blocks: [
          {
            p: "With the accounts chosen (see How payouts post), **Post to books** makes one entry dated the period's last day, referenced with Amazon's settlement ID. A settlement in another currency (Amazon.ae in a Canadian company) posts at that day's rate and says so.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The list shows each settlement's period, marketplace, deposit date and amount",
              "**Ready to post**, then **In books · match deposit**, then **In books · deposit matched**",
              "Nothing earned left in the clearing account once deposits are matched",
            ],
          },
        ],
      },
    ],
    related: ["how-payouts-post", "match-payouts", "connect-amazon"],
  },
  {
    slug: "walmart-settlements",
    category: "payouts",
    title: "Walmart settlements: bring in, check, post",
    summary:
      "Walmart's settlement reports come in row by row. Bookalyze adds them up to Walmart's payout, posts only the ones that do, and posts a settlement again when Walmart corrects it.",
    sections: [
      {
        heading: "Bring them in",
        blocks: [
          {
            p: "On a Walmart country's channel page, **Bring in from Walmart** downloads every settlement report Walmart lists that isn't here yet. The daily job does the same once the country is connected. Each report's rows are kept as Walmart sent them, **without buyers' names or addresses**.",
          },
        ],
      },
      {
        heading: "How Walmart's rows are read",
        blocks: [
          {
            p: "Each row says what an amount is for. Bookalyze groups them: sales, refunds, Walmart's fees, WFS fees (fulfilment, storage, inbound, prep), advertising, shipping labels, tax (collected and withheld cancel out) and other.",
          },
          {
            note: "A settlement whose rows don't add up to Walmart's payout, or with an amount that can't be read, shows **Needs a look** with the reason, and never posts.",
            tone: "caution",
          },
          {
            note: "This reading was built from Walmart's published report layout. Check your first settlement against Seller Center before switching on automatic posting.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "Post and match",
        blocks: [
          { where: "Commerce → Settlements → Walmart" },
          {
            steps: [
              {
                title: "Choose how Walmart posts",
                body: "An account per group and a Walmart balance account; the day posting starts; automatic posting if you want it.",
              },
              {
                title: "Post",
                body: "Each settlement becomes one entry on its period's last day, in Walmart's currency at that day's rate.",
              },
              {
                title: "Match the payout",
                body: "Payouts to your bank lists the suggested deposit: Match, Not this one or Unmatch.",
              },
            ],
          },
          {
            p: "A settlement Walmart corrects shows **Changed since posted**; Post again brings it up to date.",
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [
          {
            list: [
              "Uploading Seller Center's report by hand.",
              "WFS's inventory ledger (returns and losses).",
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Each settlement with its sales, fees, WFS fees, advertising, labels and payout",
              "**Ready to post** for ones that add up; **Needs a look** with a reason for any that don't",
              "Walmart in Channel profit, beside Amazon",
            ],
          },
        ],
      },
    ],
    related: ["connect-walmart", "how-payouts-post", "match-payouts"],
  },
  {
    slug: "noon-months",
    category: "payouts",
    title: "Noon: transactions, months and the balance check",
    summary:
      "Noon keeps a balance instead of sending settlements. Bookalyze brings in every row of Noon's transaction view, posts each country's month as one entry, matches each payment to your bank and checks your books agree with Noon.",
    sections: [
      {
        heading: "Bring Noon's rows in",
        blocks: [
          { where: "Commerce → Settlements → Noon" },
          {
            p: "With Noon's API connected, **Bring in from Noon** reads a year back, a month at a time, then re-reads the last three weeks for late fees and updates. Without the API, upload Noon's **transaction view** (seller portal → Finance → Transaction view, CSV); everything else works the same.",
          },
          {
            p: "Rows are filed by currency: AED to Noon UAE, SAR to Noon KSA, EGP to Noon Egypt. Bringing the same rows in again refreshes them; nothing counts twice.",
          },
        ],
      },
      {
        heading: "How Noon's rows are grouped",
        blocks: [
          {
            table: {
              head: ["Noon's type", "Goes to"],
              rows: [
                ["Order", "Sales, with referral, fulfilment and other fees split out"],
                ["Order Update", "Returns and order changes"],
                ["Statement Fee", "Advertising (when it says so), else Noon's fees"],
                ["Balance Transfer", "Moved to another Noon contract"],
                ["Payment", "Not earnings: the payout to your bank"],
              ],
            },
          },
        ],
      },
      {
        heading: "Post each month",
        blocks: [
          {
            p: "Once a month is over, **Post** makes one entry on its last day (reference like NOON-2026-09), each group to its account and what the month earned to the Noon balance. A month whose rows change later shows **Changed since posted**.",
          },
          {
            note: "Noon's fees include VAT. Today that VAT posts with the fees, as a cost, which is right if you're not VAT-registered. Splitting it out as recoverable input VAT isn't built yet.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "Payouts and the balance check",
        blocks: [
          {
            p: "Each payment row finds the bank deposit of the same amount, a few days either side. **Match** moves it into the Noon balance, so it stops counting as income. The **balance check** compares the Noon balance in your books with what Noon's rows say it owes; when everything is posted and matched it says **Your books agree with Noon**.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Each country's months with sales, fees, advertising and what they earned",
              "Paid out to your bank shown on its own, not as a loss",
              "The balance check reads **Your books agree with Noon**",
            ],
          },
        ],
      },
    ],
    related: ["connect-noon", "how-payouts-post", "match-payouts", "noon-fbn-stock"],
  },
  {
    slug: "ebay-months",
    category: "payouts",
    title: "eBay money: months, payouts and the Seller Hub report",
    summary:
      "eBay's transactions come from its Finances API a month at a time. Each site's month posts as one entry and each payout is matched to your bank. Seller Hub's transaction report fills in history, or stands in where the API can't be used yet.",
    sections: [
      {
        heading: "Bring eBay's money in",
        blocks: [
          { where: "Commerce → Settlements → eBay" },
          {
            p: "Once eBay is connected, a year of rows comes in a month at a time, and the last three weeks are read again for late changes. Each row sits on its order's eBay site. Sales have their fees split out; transfers and withdrawals are money moved, not earnings.",
          },
        ],
      },
      {
        heading: "Seller Hub's transaction report",
        blocks: [
          {
            p: "Upload Seller Hub → Payments → Reports → **Transaction report** (CSV) to fill in history. Rows on days eBay's API already brought in are left out, and the API replaces report rows when it reads those days, so nothing counts twice.",
          },
          {
            note: "eBay asks UK and EU sellers' finance requests to be digitally signed, which Bookalyze doesn't do yet. Until then, those sellers upload the report.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "Post and match",
        blocks: [
          {
            p: "With How eBay posts set up, each site's month posts on its last day (reference like EBAY-2026-09). **Payouts to your bank** suggests each payout's deposit; only payouts eBay says were sent can be matched.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Each eBay site's months with sales, refunds, fees, ads and labels",
              "Payouts listed with their bank deposit, matched",
              "eBay sites in Channel profit, each in its own column",
            ],
          },
        ],
      },
    ],
    related: ["connect-ebay", "how-payouts-post", "match-payouts"],
  },
  {
    slug: "match-payouts",
    category: "payouts",
    title: "Match each payout to its bank deposit",
    summary:
      "Matching pairs a marketplace payout with the deposit in your bank and moves that deposit to the clearing or balance account, so your sales are counted once. Works in any bank account and any currency.",
    sections: [
      {
        heading: "Why it matters",
        blocks: [
          {
            p: "The posted settlement already counts your sales and fees. If the bank deposit is also categorised as sales, the same money is counted twice. Matching moves the deposit to the clearing account instead: clearing goes back to zero and income is right.",
          },
        ],
      },
      {
        heading: "Find and match",
        blocks: [
          {
            p: "A posted settlement or month shows the possible deposits: the exact amount, in any of your bank accounts, from a few days before the marketplace's date to ten days after, closest first, with where each is categorised now.",
          },
          {
            list: [
              "**Match** moves it. Its bank link, receipts and reviewed tick stay with it.",
              "**Not this one** turns a deposit down for this payout.",
              "**Unmatch** puts the deposit back as it was.",
              "**Match N deposits** matches every payout with exactly one possible deposit, in one go.",
            ],
          },
        ],
      },
      {
        heading: "Another currency",
        blocks: [
          {
            p: "An Amazon.ae payout in dirhams that lands in a Canadian dollar account is offered when it's within 10% of the market rate on the deposit date. You see the bank's rate, how far it is from the market and the exchange difference, then **Match at this rate**: the difference goes to gain or loss on foreign exchange. Converted payouts are never matched in bulk or by the daily job.",
          },
        ],
      },
      {
        heading: "When Amazon charged you",
        blocks: [
          {
            p: "A negative Amazon settlement is matched to the money Amazon took from your card or bank the same way, so the fees aren't counted twice. If Amazon carried the balance into the next settlement instead, there's nothing to match.",
          },
        ],
      },
      {
        heading: "Automatically",
        blocks: [
          {
            p: "With automatic posting on, the daily job matches deposits that have exactly one exact fit and are still uncategorised or only in the sales account. Anything else waits for you.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The settlement says **deposit matched**, with the date and bank account",
              "The deposit now shows the clearing account as its category",
              "The clearing account's balance is only what's still on its way",
            ],
          },
        ],
      },
    ],
    related: ["how-payouts-post", "amazon-ae-payout-into-cad", "books-agree-with-marketplaces"],
  },
];
