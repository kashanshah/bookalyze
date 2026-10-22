import type { Guide } from "./types";

/**
 * Advertising and profit: what ads really cost each product, in Bookalyze's words (docs/ADS.md is
 * the design). Synthetic numbers only. Keep the screen names as the app shows them.
 */
export const ADVERTISING_GUIDES: readonly Guide[] = [
  {
    slug: "profit-after-ads",
    category: "advertising",
    title: "Profit by product, after ads: what every product really makes",
    summary:
      "Each product's profit after the marketplace's fees, what it cost you and its ads, per marketplace. The products losing money come first, each with how far its ads can go before they stop paying.",
    sections: [
      {
        heading: "Why it matters",
        blocks: [
          {
            p: "On Amazon, a product can sell every day and still lose money. Its price has to cover the referral fee, the fulfilment fee, refunds, the landed cost of the unit **and** the ads that sold it. Amazon's ads console shows ACOS per campaign, but it doesn't know what your product cost or what Amazon's fees left you, so it can't tell you whether the ads made or lost money. Bookalyze knows both.",
          },
          { where: "Commerce → Channel profit → By product" },
        ],
      },
      {
        heading: "What you need first",
        blocks: [
          {
            check: [
              "The marketplace connected, with its orders coming in (each product's units and sales come from its orders)",
              "Its settlements (Amazon, Walmart) or transactions (Noon, eBay) brought in for the period: they tell Bookalyze what the marketplace leaves you from each sale",
              "Its SKUs linked to products (Inventory → Products), and each product with a cost: a delivery with its landed cost, or opening stock",
              "For ad spend per product: Amazon Ads connected on the marketplace's channel page (see Connect Amazon Ads)",
            ],
          },
          {
            note: "Without Amazon Ads, the page still works: it shows each product's profit before ads, and the advertising in your books as one line for the marketplace, not split by product.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "The summary at the top",
        blocks: [
          {
            table: {
              head: ["Card", "What it tells you"],
              rows: [
                [
                  "Profit after ads",
                  "Every marketplace together, in your main currency, for the products with a cost",
                ],
                [
                  "Ad spend and TACOS",
                  "What ads cost, and that as a share of all sales. Under about 10% is light; over 20% means sales lean hard on ads",
                ],
                [
                  "Products losing money",
                  "How many lost money after their ads in the period, and how much they lost together",
                ],
                [
                  "Ads with no sales",
                  "Spend on products whose ads sold nothing in the period, and how many products have no cost yet",
                ],
              ],
            },
          },
        ],
      },
      {
        heading: "Each product's row",
        blocks: [
          {
            table: {
              head: ["Column", "How it's worked out"],
              rows: [
                [
                  "Units, Sales",
                  "Order lines bought in the period, cancelled orders left out; sales less promotions",
                ],
                [
                  "Profit before ads",
                  "Sales × what the marketplace left you per sale (its keep rate, below), less units × the product's cost. Underneath: per unit",
                ],
                ["Ad spend", "Each day's spend on the product from the ads reports"],
                [
                  "ACOS / break-even",
                  "ACOS is ad spend over the sales the ads brought. Break-even ACOS is profit before ads over sales: the most ACOS can be before each sale from ads loses money. Red when ACOS is above it",
                ],
                ["TACOS", "Ad spend over all the product's sales, from ads or not"],
                [
                  "Profit after ads",
                  "Profit before ads less ad spend; underneath, per unit and as a margin of sales",
                ],
              ],
            },
          },
          {
            p: "Click a row for the rest: what the marketplace left you, the product cost, sales and orders from ads, return on ad spend (ROAS), the share of sales that came without ads, clicks, impressions, cost per click, **break-even cost per click** and how many clicks buy.",
          },
        ],
      },
      {
        heading: "The verdicts, worst first",
        blocks: [
          {
            table: {
              head: ["Verdict", "What it means", "Where to look"],
              rows: [
                [
                  "Losing money",
                  "It loses money before ads: the price doesn't cover the fees and the cost",
                  "The price, the fulfilment fee (size tier), the landed cost. Ads only make it worse",
                ],
                [
                  "Ads eat the profit",
                  "Profitable on its own, but its ads cost more than that profit",
                  "Bids above the break-even cost per click; campaigns with high ACOS",
                ],
                [
                  "Ads with no sales",
                  "Ad spend and no sales from the ads in the period",
                  "Pause or rethink those campaigns; check the listing is buyable",
                ],
                [
                  "Ads cost more than they earn",
                  "Still profitable overall, but ACOS is above break-even: each sale from ads loses money and organic sales pay for it",
                  "Fine for a launch or to defend rank, on purpose and for a while",
                ],
                [
                  "Cost missing",
                  "Not linked to a product, or the product has no cost yet",
                  "Inventory → Products: link the SKU; add a delivery or opening stock",
                ],
                ["Healthy", "Profitable after ads, ACOS under break-even", "Room to grow"],
              ],
            },
          },
        ],
      },
      {
        heading: "Sponsored Brands, and ads not tied to one product",
        blocks: [
          {
            p: "Sponsored Brands campaigns promote a brand or several products, and Amazon reports their cost per campaign, not per product. Bookalyze keeps them as their own line under each marketplace's products: counted in the marketplace's total and its TACOS, not split into any product, so no product looks worse for a campaign that wasn't about it.",
          },
          {
            note: "On Profit and loss by product you can choose to share Sponsored Brands out by each product's sales from ads instead (marked as estimated). See Profit and loss by product, line by line.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "The keep rate: fees, refunds and the rest, shared by sales",
        blocks: [
          {
            p: "Marketplaces don't say what each product's fees were in a way that adds up to the payout, but their settlements do say what the marketplace left you overall. Bookalyze takes the marketplace's money in the period (fees, refunds, promotions, reimbursements and everything else, with the advertising in it taken out) over its sales: that's the **keep rate**, shown under the marketplace's name. Each product's share is its sales × the keep rate.",
          },
          {
            note: "A marketplace with no settlements in the period (a new one) uses the last 90 days. With none in 90 days either, profit shows as — until some come in.",
          },
          {
            note: "A product with a much bigger fulfilment fee than average (a large, light item) leaves less than the keep rate says. Check it on Inventory → Prices, where Amazon's own fee estimate for the listing is.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "Download it",
        blocks: [
          {
            p: "**Download CSV** gives every column for every product, including the details behind the click, plus each marketplace's Sponsored Brands line, for the same period and marketplace.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Every product that sold or ran ads in the period, worst first",
              "A profit before and after ads for every product with a cost",
              "ACOS next to break-even ACOS on every advertised product",
              "Sponsored Brands as its own line",
              "Advertising in your books next to the ads reports' total, at the bottom of each marketplace",
            ],
          },
        ],
      },
    ],
    related: [
      "sku-profit-and-loss",
      "acos-tacos-break-even",
      "connect-amazon-ads",
      "fix-products-losing-money",
      "ads-in-your-books",
    ],
  },
  {
    slug: "sku-profit-and-loss",
    category: "advertising",
    title: "Profit and loss by product, line by line",
    summary:
      "For any period, every product's exact profit and loss: units sold and returned, sales, promotions, refunds, each marketplace fee, storage, cost of goods and ads, from the marketplaces' own rows. Each amount is marked when it's estimated.",
    sections: [
      {
        heading: "What it's for",
        blocks: [
          {
            p: 'Profit by product answers "which products lose money after ads?" quickly, sharing each marketplace\'s fees by sales. This page goes further: it reads the fees the marketplace charged **on each order of each product**, so you see exactly what a product made or lost, line by line, for any dates you choose.',
          },
          { where: "Commerce → Channel profit → By product → Profit and loss, line by line" },
        ],
      },
      {
        heading: "Where each line comes from",
        blocks: [
          {
            table: {
              head: ["Line", "Where it comes from", "Actual or estimated"],
              rows: [
                [
                  "Units sold and returned",
                  "The product's order lines bought in the period; returns from the orders' refunds",
                  "Actual",
                ],
                [
                  "Gross sales, promotions and coupons",
                  "The marketplace's rows for the order, else the order itself",
                  "Actual",
                ],
                [
                  "Refunds",
                  "The marketplace's refund rows on the order; before they're in, the order's refunds",
                  "Actual once settled",
                ],
                [
                  "Referral, fulfilment and other fees",
                  "Amazon's settlements by product and order, Noon's transactions, Walmart's settlement reports, eBay's finances (shared over an order's products by item price)",
                  "Actual once settled; estimated before",
                ],
                [
                  "Storage and account fees",
                  "Storage, the selling plan and other fees on no product, shared by units sold",
                  "Estimated (shared out)",
                ],
                [
                  "Cost of goods",
                  "The cost posted for the month on Cost of goods sold; for months not posted, the next unit's landed cost",
                  "Actual once the month is posted",
                ],
                [
                  "Ad spend",
                  "Each day's spend on the product in the ads reports",
                  "Estimated for the last 14 days (the marketplace can still give them sales)",
                ],
              ],
            },
          },
          {
            p: "A product's period is its order lines bought in it, and **every amount on those orders counts there**, even a refund or a fee settled weeks later. So a period's units and what they cost always go together, and a period's figures can still move a little until its orders are settled.",
          },
        ],
      },
      {
        heading: 'Estimates, and "x% actual"',
        blocks: [
          {
            p: "An order the marketplace hasn't settled yet has no fees of its own. Bookalyze estimates them at the rates the product's settled orders show (else the marketplace's), and marks them **≈**. When nothing on a marketplace is settled by product yet, the whole marketplace share is estimated by its keep rate (see Profit by product, after ads). Each product, and the period, shows how much of its amounts is actual.",
          },
          {
            note: "Amazon settlements brought in before this page existed don't have their amounts by product yet. On Commerce → Settlements, Bring in settlements fills those Amazon still lists (about 90 days); for older ones, upload their flat files again. Nothing in your books changes.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "One product: the waterfall",
        blocks: [
          {
            p: "Open a product for its waterfall, from gross sales down to profit, with every marketplace together in your main currency (each amount at its own day's exchange rate). Below it, **By channel** shows each marketplace in its own currency, the amounts as the marketplace has them.",
          },
        ],
      },
      {
        heading: "Ads and Sponsored Brands",
        blocks: [
          {
            p: "Ad spend comes from the ads reports. Without Amazon Ads connected, ad cost says \"not connected yet\": the page still works, and the advertising in the marketplace's settlements is its own line, not split by product. Sponsored Brands has no spend per product, so it's its own line by default; choose **Shared by ad sales** to share it by each product's sales from ads (marked estimated).",
          },
        ],
      },
      {
        heading: "Download it",
        blocks: [
          {
            p: "**Download CSV** gives every line for every product: every marketplace together in your main currency, then each marketplace in its own, with the profit, margin, per unit, TACOS, the share that's actual and how much is estimated. On a product's page, the CSV is that product only.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Every product that sold in the period, worst profit first",
              "Sales, fees and refunds, cost of goods and ads adding up to each product's profit",
              "≈ beside amounts that are estimated, and the share that's actual",
              "A product's waterfall, and its lines on each marketplace in that marketplace's currency",
            ],
          },
        ],
      },
    ],
    related: ["profit-after-ads", "ads-in-your-books", "fix-products-losing-money"],
  },
  {
    slug: "connect-amazon-ads",
    category: "advertising",
    title: "Connect Amazon Ads",
    summary:
      "Give Bookalyze read access to your Amazon Ads reports on Amazon's own page, once per region. Ad spend per product then comes in every day, 60 days back to start.",
    sections: [
      {
        heading: "Before you start",
        blocks: [
          {
            check: [
              "Your Amazon marketplace is a channel in Bookalyze (Commerce → Channels)",
              "You're the company's owner or an admin in Bookalyze",
              "You can sign in to Amazon with the login you use for Campaign Manager (Seller Central → Advertising) on that marketplace",
            ],
          },
        ],
      },
      {
        heading: "Connect",
        blocks: [
          {
            steps: [
              {
                title: "Open the marketplace",
                body: "Commerce → Channels → your Amazon marketplace (Amazon.ca, say). Find **Amazon Ads**.",
              },
              {
                title: "Connect Amazon Ads",
                body: "Amazon's own page opens. Sign in there and allow Bookalyze to read your advertising data. Bookalyze never sees your password or one-time codes.",
              },
              {
                title: "Back in Bookalyze",
                body: "You land on the marketplace's page, connected, with your ads account's name. The first reports are asked for straight away: about 60 days of spend, in a few minutes.",
              },
              {
                title: "Optional: bring them in now",
                body: "**Bring in ads now** asks Amazon and waits up to about 45 seconds. What isn't ready comes in by itself within minutes.",
              },
            ],
          },
        ],
      },
      {
        heading: "One sign-in per region",
        blocks: [
          {
            p: "Amazon Ads splits the world into three regions. One sign-in covers every marketplace in its region, so connecting Amazon.ca also covers Amazon.com and Mexico if the same login advertises there; Amazon.ae (with the UK, Europe, Saudi Arabia and India) is the Europe region and needs its own sign-in from the Amazon.ae channel.",
          },
          {
            table: {
              head: ["Region", "Marketplaces"],
              rows: [
                ["North America", "Amazon.ca, Amazon.com, Mexico, Brazil"],
                [
                  "Europe",
                  "Amazon.ae, Saudi Arabia, the UK, Germany, France, Italy, Spain, the Netherlands, Sweden, Poland, Turkey, Egypt, India",
                ],
                ["Far East", "Japan, Australia, Singapore"],
              ],
            },
          },
        ],
      },
      {
        heading: "What Bookalyze reads, and how often",
        blocks: [
          {
            list: [
              "Your ads profiles (one per marketplace), to match each to its channel",
              "Sponsored Products, per advertised SKU per day: spend, impressions, clicks, and the sales, orders and units Amazon attributes to the ads within 7 days of a click",
              "Sponsored Brands, per campaign per day: the same, within 14 days",
              "Every day, the last 15 days again, because Amazon still moves sales between days for 14 days after a click; the first time, the last 60 days",
            ],
          },
          {
            p: "It never changes a campaign, a bid or a budget, and it doesn't read keywords, search terms or placements: those stay in your ads tools.",
          },
        ],
      },
      {
        heading: "If something's wrong",
        blocks: [
          {
            table: {
              head: ["You see", "Do this"],
              rows: [
                [
                  '"This login has no ads account for Amazon.ca"',
                  "You signed in with a login that doesn't advertise there. Connect again with the login you use for that marketplace's Campaign Manager",
                ],
                [
                  '"Amazon refused: this ads account hasn\'t allowed Bookalyze…"',
                  "The login lost access to the ads account. Connect again",
                ],
                [
                  '"Amazon is making the reports"',
                  "Nothing to do: they come in by themselves within minutes",
                ],
                [
                  "Connect Amazon Ads is greyed out",
                  "Only owners and admins can connect; or this server doesn't have Bookalyze's Amazon Ads app keys yet",
                ],
              ],
            },
          },
        ],
      },
      {
        heading: "Disconnect",
        blocks: [
          {
            p: "**Disconnect** on the marketplace's page deletes the sign-in. Ad spend already brought in stays. You can also remove Bookalyze's access from Amazon's side, in your Amazon account's Login with Amazon settings.",
          },
        ],
      },
    ],
    related: ["profit-after-ads", "connect-amazon", "ads-data-and-limits"],
  },
  {
    slug: "acos-tacos-break-even",
    category: "advertising",
    title: "ACOS, TACOS, break-even ACOS and cost per click, with an example",
    summary:
      "The five numbers that say whether ads make or lose money, how each is worked out, and one product's month worked through from sales to profit after ads.",
    sections: [
      {
        heading: "The numbers",
        blocks: [
          {
            table: {
              head: ["Number", "Formula", "Read it as"],
              rows: [
                ["ACOS", "Ad spend ÷ sales from ads", "What each sale from ads cost in ads"],
                ["TACOS", "Ad spend ÷ all sales", "How much the product leans on ads overall"],
                [
                  "ROAS",
                  "Sales from ads ÷ ad spend",
                  "ACOS turned over: sales per unit of ad spend",
                ],
                [
                  "Break-even ACOS",
                  "Profit before ads ÷ sales",
                  "The highest ACOS before each sale from ads loses money. It's the margin before ads",
                ],
                [
                  "Break-even cost per click",
                  "Profit before ads per unit × the share of clicks that buy",
                  "The most a click can cost and still pay for itself",
                ],
              ],
            },
          },
        ],
      },
      {
        heading: "One product's month",
        blocks: [
          {
            p: "A cutting board sells for **$50.00**. The marketplace leaves you 70% of each sale after its fees and refunds (**$35.00**), and each board's landed cost is **$15.00**. So each board makes **$20.00** before ads, a 40% margin: its **break-even ACOS is 40%**.",
          },
          {
            table: {
              head: ["This month", "Amount"],
              rows: [
                ["Units, sales", "100 boards, $5,000.00"],
                ["Profit before ads", "100 × $20.00 = $2,000.00"],
                ["Ad spend", "$1,200.00 on 1,000 clicks: $1.20 a click"],
                ["Sales from ads", "48 boards, $2,400.00"],
                ["ACOS", "$1,200 ÷ $2,400 = 50%, above the 40% break-even"],
                ["TACOS", "$1,200 ÷ $5,000 = 24%"],
                ["Profit after ads", "$2,000 − $1,200 = $800.00, $8.00 a board, 16%"],
              ],
            },
          },
          {
            p: "The board is still profitable, but its verdict is **Ads cost more than they earn**: the 48 boards from ads made 48 × $20 = $960 before ads and cost $1,200 in ads, so the ads lost $240. The 52 boards sold without ads made $1,040 and paid for that.",
          },
          {
            p: "4.8% of clicks bought (48 of 1,000), so the **break-even cost per click** is $20.00 × 4.8% = **$0.96**. Paying $1.20 a click loses $0.24 on every click. Bring bids down towards $0.96, or raise the price, or lower the cost, and the ads start paying for themselves.",
          },
        ],
      },
      {
        heading: "Why ACOS alone misleads",
        blocks: [
          {
            list: [
              "A 30% ACOS is great for a product with a 50% margin and a loss for one with a 20% margin: compare it with that product's break-even, not with a rule of thumb",
              "ACOS ignores sales without ads; TACOS shows whether ads grow the product or just buy sales it would have had",
              "A rising TACOS with flat sales means you're paying for sales you used to get for free",
            ],
          },
          {
            note: "Amazon counts a sale as from an ad for 7 days after the click (14 for Sponsored Brands). Ads in the last days of a period can claim sales in the next, so look at whole months, not days.",
            tone: "caution",
          },
        ],
      },
    ],
    related: ["profit-after-ads", "fix-products-losing-money", "amazon-prices"],
  },
  {
    slug: "ads-in-your-books",
    category: "advertising",
    title:
      "Ad spend in your books and in the ads reports: why they differ, and why nothing counts twice",
    summary:
      "Amazon charges ads from your payouts or your card; the ads reports say what was spent each day. How Channel profit and Profit by product use each, and how to make your books complete.",
    sections: [
      {
        heading: "Two records of the same ads",
        blocks: [
          {
            table: {
              head: ["", "Your books", "The ads reports"],
              rows: [
                [
                  "What it is",
                  "What the marketplace charged: \"Cost of Advertising\" in Amazon's settlements, the advertising fee in Noon's statements, or a card payment",
                  "What each campaign and product spent, day by day",
                ],
                ["When", "When charged (at a threshold, or monthly)", "The day of the click"],
                ["Per product", "No", "Yes (Sponsored Products)"],
                [
                  "Used for",
                  "Channel profit's Advertising row, your profit and loss",
                  "Profit by product, TACOS, break-even",
                ],
              ],
            },
          },
        ],
      },
      {
        heading: "How Bookalyze keeps them apart",
        blocks: [
          {
            list: [
              "**Channel profit** counts the advertising in your books, as before. The ads reports' total shows below Profit as **Ad spend in the ads reports**, with **TACOS**, for comparison only, never added in",
              "**Profit by product** takes the advertising in your books *out* of what the marketplace leaves you, then takes each product's own spend from the reports off its profit. So ads are counted once, from the reports",
              "At the bottom of each marketplace on Profit by product: the advertising in your books, the ads reports' total, and the difference",
            ],
          },
        ],
      },
      {
        heading: "Why the difference",
        blocks: [
          {
            list: [
              "**Timing**: Amazon charges ads when your balance reaches a threshold or at month end, so a charge can land in the next period",
              "**Paid by card**: when Amazon charges ads to a card, they aren't in the settlements at all. They're in your books as a card payment, in an expense category",
              "**Noon** takes ads inside a statement fee, once a statement is in",
              "**Credits** and promotional ad credits reduce what's charged, not what's spent",
            ],
          },
        ],
      },
      {
        heading: "When Amazon charges your card",
        blocks: [
          {
            steps: [
              {
                title: "Categorise the card payments",
                body: 'Put Amazon\'s advertising charges on your card in an expense category such as "Advertising" (a rule can do it every time).',
              },
              {
                title: "Count it against the marketplace",
                body: "Commerce → Channel profit → Your own costs: set that category against the marketplace (Amazon.ca). Channel profit then takes it off that marketplace's profit.",
              },
              {
                title: "Check",
                body: "Over a few months, the advertising in your books and the ads reports' total should be close.",
              },
            ],
          },
        ],
      },
    ],
    related: ["profit-after-ads", "channel-profit", "how-payouts-post"],
  },
  {
    slug: "ads-data-and-limits",
    category: "advertising",
    title: "Advertising data in Bookalyze: what's read, what's kept, and the edge cases",
    summary:
      "Every field Bookalyze keeps about your ads, which marketplaces are covered, and how it handles time zones, currencies, attribution, bundles, missing costs and the rest.",
    sections: [
      {
        heading: "What's kept, per marketplace, day, campaign and product",
        blocks: [
          {
            list: [
              "The marketplace (channel) and the ads account it came from",
              "The day, in the ads account's time zone",
              "The kind of ad: Sponsored Products, Sponsored Brands (later: Sponsored Display, eBay Promoted Listings)",
              "The campaign's ID and its name that day",
              "The seller SKU and the marketplace's own listing ID (ASIN); none for Sponsored Brands",
              "Spend in the ads account's currency, and in your main currency at Bookalyze's exchange rate for that day",
              "Impressions and clicks",
              "Sales, orders and units the marketplace attributes to the ads, and its attribution window (7 or 14 days)",
            ],
          },
          {
            p: "No keywords, search terms, placements, bids, budgets or shopper details. Nothing about ads is posted to your books.",
          },
        ],
      },
      {
        heading: "Which marketplaces",
        blocks: [
          {
            table: {
              head: ["Marketplace", "Ad spend per product"],
              rows: [
                ["Amazon (every marketplace)", "Yes, from the Amazon Ads API"],
                [
                  "Noon",
                  "Not yet: upload of Ad Manager's export is next. Until then its advertising fee shows per marketplace",
                ],
                ["eBay", "Not yet: Promoted Listings through eBay's Marketing API is planned"],
                ["Walmart", "Not yet: Walmart Connect once API access is available"],
              ],
            },
          },
        ],
      },
      {
        heading: "Edge cases, and what Bookalyze does",
        blocks: [
          {
            table: {
              head: ["Case", "What happens"],
              rows: [
                [
                  "Ads ran, nothing sold",
                  "The product still has a row: its loss is the spend. Verdict: Ads with no sales",
                ],
                [
                  "Ads claim more than the period's sales",
                  "Attribution reaches 7 or 14 days ahead; the share of sales without ads stops at 0%",
                ],
                [
                  "Different time zones",
                  "Ad days are the ads account's; order days are your company's. A day's edge can differ by hours",
                ],
                [
                  "Amazon changes past days",
                  "The last 15 days are fetched again every day and replace what was there",
                ],
                [
                  "A campaign renamed or deleted",
                  "Each day keeps the name it had; a deleted campaign's past spend stays",
                ],
                ["The same product in several ad groups", "Added together per day and campaign"],
                [
                  "An ASIN with no SKU in a report",
                  "The SKU is found from the marketplace's own list of your SKUs; otherwise kept by ASIN",
                ],
                ["Several SKUs for one ASIN (FBA and FBM)", "Each SKU has its own row"],
                [
                  "A bundle or multipack",
                  "Its cost adds up each product × units; its ads stay on the bundle's SKU",
                ],
                [
                  "A SKU not linked to a product",
                  "Sales and ads show; profit shows as — with Cost missing",
                ],
                [
                  "A marketplace with no settlements yet",
                  "The keep rate comes from the last 90 days, else profit shows as —",
                ],
                [
                  "No exchange rate for a day",
                  "Left out of the main-currency summary, with a note",
                ],
                [
                  "A marketplace switched off, or ads disconnected",
                  "Everything brought in stays and shows; nothing new comes in",
                ],
                [
                  "Spend older than Amazon keeps",
                  "The first sync goes back 60 days; Amazon keeps about 60 days of Sponsored Brands and 95 of Sponsored Products",
                ],
              ],
            },
          },
        ],
      },
    ],
    related: ["profit-after-ads", "connect-amazon-ads", "ads-in-your-books"],
  },
  {
    slug: "fix-products-losing-money",
    category: "playbooks",
    title: "Find and fix the products losing money, once a month",
    summary:
      "A 30-minute monthly routine on Profit by product: which products lose money after ads, why, and what to change for each verdict.",
    sections: [
      {
        heading: "Before you start",
        blocks: [
          {
            check: [
              "Last month's settlements or transactions are in for each marketplace",
              "Amazon Ads is connected on each Amazon marketplace you advertise in",
              "No product shows Cost missing (link SKUs, add costs first)",
            ],
          },
        ],
      },
      {
        heading: "1. Look at last month",
        blocks: [
          { where: "Commerce → Channel profit → By product, period: last month" },
          {
            p: "Read the cards: profit after ads, TACOS, how many products lost money and how much. Then each marketplace's table, worst first.",
          },
        ],
      },
      {
        heading: "2. Act on each verdict",
        blocks: [
          {
            table: {
              head: ["Verdict", "First move", "Then"],
              rows: [
                [
                  "Losing money",
                  "Check its price and fees on Inventory → Prices (Amazon's fee estimate); raise the price or lower the landed cost",
                  "Stop its ads until it makes money before ads; if it can't, sell through and stop reordering",
                ],
                [
                  "Ads eat the profit",
                  "Bring bids down to its break-even cost per click (open the row)",
                  "Move budget to its campaigns with the lowest ACOS",
                ],
                [
                  "Ads with no sales",
                  "Pause the campaigns spending on it",
                  "Check the listing is buyable and in stock",
                ],
                [
                  "Ads cost more than they earn",
                  "Decide if it's on purpose (a launch, defending rank) and for how long",
                  "If not, lower bids towards break-even",
                ],
              ],
            },
          },
        ],
      },
      {
        heading: "3. Check next month",
        blocks: [
          {
            check: [
              "Fewer products losing money, and less lost",
              "TACOS steady or lower with sales steady or higher",
              "ACOS under break-even ACOS on the products you changed",
            ],
          },
        ],
      },
    ],
    related: ["profit-after-ads", "acos-tacos-break-even", "are-you-losing-money"],
  },
];
