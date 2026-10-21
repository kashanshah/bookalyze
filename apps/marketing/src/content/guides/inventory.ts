import type { Guide } from "./types";

/** Stock and cost of goods: products, buying, landed cost, FIFO, marketplace stock, reordering. */
export const INVENTORY_GUIDES: readonly Guide[] = [
  {
    slug: "products-and-skus",
    category: "inventory",
    title: "Products and SKUs: link every listing to what it holds",
    summary:
      "A product is the thing you buy and sell. Each marketplace SKU links to one, with how many units a listing holds, so a 2-pack or a bundle counts the right stock.",
    sections: [
      {
        heading: "Link your SKUs",
        blocks: [
          { where: "Inventory → Products" },
          {
            p: "Above the list, **SKUs that aren't linked to a product yet**: every SKU seen on orders, and every SKU Amazon or Walmart holds stock for, even if it's never sold.",
          },
          {
            list: [
              "**Create product** makes a product named after the listing, with the SKU linked as one unit.",
              "**Link to…** links it to a product you already have.",
              "**Bundle** links one listing to several products, with how many of each it holds.",
            ],
          },
          {
            note: "A 2-pack is the same product with **2 units** per listing. Edit the product to change the units on a link.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "A product",
        blocks: [
          {
            list: [
              "Name, your own SKU (optional) and notes.",
              "Its marketplace SKUs: link, unlink, or change units.",
              "Optional **weight of one**, for splitting freight by weight.",
              "Reorder settings: lead time, minimum order, units in a carton.",
              "Archive one you've stopped selling.",
            ],
          },
          {
            p: "The list shows each product's SKUs, units sold in the last 30 days, and how many are on order.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              'No SKUs left in "not linked yet" for anything you sell',
              "Packs show **×2** (or their units) on their badge, and bundles say **bundle**",
              "Units sold looks right for your best seller",
            ],
          },
        ],
      },
    ],
    related: ["purchase-orders", "cost-of-goods-sold", "reorder"],
  },
  {
    slug: "purchase-orders",
    category: "inventory",
    title: "Purchase orders and deliveries",
    summary:
      "Draft an order to your supplier, send it, and record each delivery as it arrives. Fill one in from an Alibaba.com receipt, and type the cost of one, the line total or the order total.",
    sections: [
      {
        heading: "Make an order",
        blocks: [
          { where: "Inventory → Purchase orders → New purchase order" },
          {
            list: [
              "Supplier (one of your vendors), currency, order date, expected date, their reference and notes.",
              "Lines of product × quantity × cost. Type the **cost of one** or the **line total**, and the other is worked out; or type the order **total** and it's spread over the lines.",
              "Orders are numbered PO-0001, PO-0002 and so on.",
            ],
          },
          {
            note: "**Fill in from an Alibaba receipt**: drop in the receipt PDF from the order's page on Alibaba.com. It's read in your browser and never uploaded; it fills the supplier, currency, date, lines and costs, and lists what to check. Nothing is saved until **Save draft**.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "The life of an order",
        blocks: [
          {
            table: {
              head: ["Status", "What you can do"],
              rows: [
                ["Draft", "Edit, delete, **Mark as sent**"],
                ["Ordered", "**Record a delivery**, **Cancel order**, record payments"],
                ["Partly received", "Record the rest"],
                ["Received", "Settle the difference (when purchases are in the books)"],
                ["Cancelled", "Nothing; the number stays accounted for"],
              ],
            },
          },
        ],
      },
      {
        heading: "Deliveries",
        blocks: [
          {
            p: "**Record a delivery** fills in everything still to come; lower a number for a partial delivery. A delivery in another currency asks for the exchange rate. Each delivery has its own **landed cost** page, where freight and duty are added and a wrong arrival date can be changed.",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Products shows **N on order** for sent orders",
              "A partial delivery leaves the order **Partly received**",
              "The order's lines add up to the supplier's total to the cent",
            ],
          },
        ],
      },
    ],
    related: ["supplier-payments", "landed-cost-and-lots", "alibaba-to-fba", "reorder"],
  },
  {
    slug: "supplier-payments",
    category: "inventory",
    title: "Paying suppliers, and purchases in your books",
    summary:
      "Record what you pay against each order, with an optional payment plan. Switch on purchases in the books and payments wait on Supplier deposits until the stock arrives.",
    sections: [
      {
        heading: "Payments on an order",
        blocks: [
          { where: "Inventory → Purchase orders → an order → Payments" },
          {
            list: [
              "**Add a payment plan** (optional): parts as a percentage or a fixed amount, such as 30% upfront and the balance before shipping.",
              "**Record a payment**: a percentage or an amount, to the supplier or to anyone else (a freight forwarder, a customs broker).",
              "**A new payment** adds it to Transactions; **Already in my books** links one that came in from the bank.",
              "One bank payment can be split across orders.",
            ],
          },
          {
            p: "A payment to someone else **for a delivery** also goes on that delivery's landed cost, at the rate you actually paid.",
          },
        ],
      },
      {
        heading: "Purchases in the books",
        blocks: [
          { where: "Inventory → Purchase orders → Put purchases in the books (admins)" },
          {
            steps: [
              {
                title: "Payments go to Supplier deposits",
                body: "Paid, but not in stock yet: an asset, not an expense.",
              },
              {
                title: "Each delivery moves its landed cost into Inventory",
                body: "On the day it arrived. A cost or rate changed later posts the correction.",
              },
              {
                title: "Settle the difference",
                body: "Once everything has arrived, what's left (usually exchange rates that moved between paying and receiving) goes to exchange gains or losses. **Undo** reverses it.",
              },
            ],
          },
          {
            note: "Choose the date to start from. Orders before it stay as they were.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The order shows paid, still to pay, and a progress bar",
              '"Supplier deposits for this order" shows paid in, into stock, and what\'s left',
              "After settling, nothing is left on deposits for the order",
            ],
          },
        ],
      },
    ],
    related: ["purchase-orders", "landed-cost-and-lots", "currencies"],
  },
  {
    slug: "landed-cost-and-lots",
    category: "inventory",
    title: "Landed cost and FIFO stock lots",
    summary:
      "What a unit really cost you: the supplier's price plus its share of freight, duty, brokerage and prep. Each delivery becomes stock lots, and sales use the oldest first.",
    sections: [
      {
        heading: "Add the extra costs",
        blocks: [
          { where: "Purchase orders → an order → a delivery's landed cost" },
          {
            list: [
              "**Freight**, **duty and import taxes**, **customs brokerage**, **prep and labelling**, **other**: each in its own currency and rate.",
              "Split each by **units**, **value** or **weight**. Freight is split by weight when products have one.",
              "A live preview shows each product's order price, extra cost and cost of one.",
              "**Pay or link** records the payment for a cost not paid yet.",
            ],
          },
        ],
      },
      {
        heading: "Stock lots",
        blocks: [
          { where: "Inventory → Stock lots" },
          {
            p: 'Each delivery line is a lot: that product\'s units from that delivery, at landed cost in your main currency. The list shows units left ("38 of 50 left"), the cost of one, and the average per product.',
          },
          {
            p: "Cost of goods sold takes units from the **oldest lot first** (FIFO). A lot's cost is shared to the cent, so nothing is lost or made up.",
          },
          {
            note: "A delivery whose units are already in a posted month's cost of goods sold can't have its costs changed until that month is undone.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "The lots' cost adds up to what you paid for the goods and the extras",
              "Inventory → Prices shows the landed cost beside each listing",
              "Channel profit uses these costs once the month is posted",
            ],
          },
        ],
      },
    ],
    related: ["cost-of-goods-sold", "supplier-payments", "amazon-prices", "alibaba-to-fba"],
  },
  {
    slug: "cost-of-goods-sold",
    category: "inventory",
    title: "Cost of goods sold, month by month",
    summary:
      "Add your opening stock once, then post each month's cost of goods sold per marketplace at FIFO cost. Returns come back into stock; losses are written off.",
    sections: [
      {
        heading: "Opening stock, once",
        blocks: [
          { where: "Inventory → Stock lots → Add opening stock" },
          {
            p: "For stock you already had: product, how many, the cost of one, and the day you counted. It posts to Inventory against Opening balance equity, and sets the month cost of goods sold starts from.",
          },
        ],
      },
      {
        heading: "Each month",
        blocks: [
          { where: "Inventory → Cost of goods sold" },
          {
            table: {
              head: ["Status", "Means"],
              rows: [
                ["Ready", "The cost at FIFO is worked out; **Post** it"],
                ["Posted", "In the books, with its entry; **Undo** on the latest month"],
                [
                  "Needs attention",
                  "A SKU sold that isn't linked, or more sold than the lots hold",
                ],
                [
                  "Waiting",
                  "An earlier month posts first, or the marketplace's stock ledger isn't in yet",
                ],
                ["In progress", "The current month"],
              ],
            },
          },
          {
            p: "Each posting is one entry on the month's last day: Cost of goods sold, Inventory losses and write-offs, and Inventory the other way. Months post in order, across marketplaces.",
          },
        ],
      },
      {
        heading: "Returns and losses",
        blocks: [
          {
            p: "With Amazon's or Noon's stock ledger brought in, customer returns come back as stock at that month's cost, and lost or damaged units are written off (found ones come back).",
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Every finished month **Posted** for each marketplace",
              "Inventory on the balance sheet agrees with Stock lots",
              "Channel profit shows cost of goods for posted months",
            ],
          },
        ],
      },
    ],
    related: ["landed-cost-and-lots", "fba-inventory-ledger", "noon-fbn-stock", "channel-profit"],
  },
  {
    slug: "fba-inventory-ledger",
    category: "inventory",
    title: "Amazon's FBA inventory ledger: returns, losses and write-offs",
    summary:
      "Amazon's own record of every unit it shipped, got back, lost or found. Bookalyze brings it in daily so cost of goods sold counts returns and losses.",
    sections: [
      {
        heading: "Bring it in",
        blocks: [
          { where: "Inventory → Stock movements" },
          {
            list: [
              "**Bring in from Amazon** asks Amazon for the report a month at a time, then daily on its own.",
              "Or **Upload a ledger file**: Seller Central → Reports → Fulfillment → Inventory Ledger, Detailed view.",
              'Each marketplace shows how far it\'s in ("In through Sep 30").',
            ],
          },
          {
            note: "Needs the **Amazon Fulfillment** role on your Amazon app.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "What it changes",
        blocks: [
          {
            table: {
              head: ["Movement", "In your books"],
              rows: [
                [
                  "Customer return",
                  "Back into stock at the month's cost, out of cost of goods sold",
                ],
                ["Lost, damaged, disposed", "Taken from the oldest lots and written off"],
                ["Found", "Back into stock"],
                ["Removals, receipts, transfers", "Nothing: you still own the units"],
              ],
            },
          },
          {
            p: "A month's cost of goods sold waits until the ledger is in through the month's end. Before the ledger starts (Amazon keeps about 18 months), refunds in the date range transaction report count as returns.",
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [
          {
            list: [
              "Amazon's reimbursements stay on the settlement, where they're posted.",
              "Where removed units went.",
            ],
          },
        ],
      },
    ],
    related: ["cost-of-goods-sold", "stock-overview", "amazon-settlements"],
  },
  {
    slug: "noon-fbn-stock",
    category: "inventory",
    title: "Noon FBN stock: the ledger, the summary and the check",
    summary:
      "Noon's FBN inventory ledger feeds cost of goods sold like Amazon's. Its summary shows what Noon holds, and Bookalyze checks the two reports agree.",
    sections: [
      {
        heading: "Bring it in",
        blocks: [
          { where: "Inventory → Stock movements" },
          {
            list: [
              "With a Noon key that can download reports, the ledger and summary come in daily.",
              "Or **Upload a ledger file**: Noon's detailed ledger, its daily summary or its summary for a period. Each row goes to its country.",
            ],
          },
        ],
      },
      {
        heading: "What you'll find",
        blocks: [
          {
            list: [
              "**At Noon** beside your lots in \"Your stock against Amazon's and Noon's\".",
              "**Noon's numbers checked**: the products where Noon's summary and its ledger disagree, or that they agree.",
              "**Movements not counted yet**: any of Noon's movement types Bookalyze doesn't read yet.",
              "**Noon's summaries in**, each with Remove.",
            ],
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [{ list: ["Stock you ship yourself (FBP)."] }],
      },
    ],
    related: ["cost-of-goods-sold", "stock-overview", "noon-months", "connect-noon"],
  },
  {
    slug: "stock-overview",
    category: "inventory",
    title: "Stock in one place: your books against Amazon, Noon, Walmart and your count",
    summary:
      "One row per product: units in your books, what Amazon, Noon and Walmart hold, what you counted yourself, and the difference.",
    sections: [
      {
        heading: "The page",
        blocks: [
          { where: "Inventory → Stock" },
          {
            table: {
              head: ["Column", "Where it comes from"],
              rows: [
                ["In the books", "Units left in your lots, less sales in months not posted yet"],
                ["Amazon", "FBA: sellable, reserved, inbound, unsellable and being looked for"],
                ["Noon", "FBN's latest summary"],
                ["Walmart", "WFS: sellable and held"],
                ["At hand", "Your own latest **Count**: you, a warehouse or a 3PL"],
                ["Difference", "The books less everything counted"],
              ],
            },
          },
          {
            p: '"Matches" at zero; a difference of one or two is quiet, a bigger one a warning. Counting doesn\'t change the books.',
          },
        ],
      },
      {
        heading: "When there's a difference",
        blocks: [
          {
            list: [
              "Months not posted yet? Post cost of goods sold.",
              "Units lost or used outside a marketplace? **Take out of stock**.",
              "Units filed under the wrong product? **Move to another product**.",
              "Stock arrived that isn't recorded? Record the delivery or add opening stock.",
            ],
          },
        ],
      },
    ],
    related: ["stock-taken-out", "fba-inventory-ledger", "books-agree-with-marketplaces"],
  },
  {
    slug: "stock-taken-out",
    category: "inventory",
    title: "Take stock out by hand, move it, or put it back",
    summary:
      "For units no marketplace accounts for: samples, gifts, the owner's own use, breakages. Take them out to a category, or move them to the right product.",
    sections: [
      {
        heading: "Take out of stock",
        blocks: [
          { where: "Inventory → Stock lots → a lot → Take out of stock" },
          {
            list: [
              "How many, the day they left, and a note.",
              "Where the cost goes: **Inventory losses and write-offs** (the default, for lost or thrown away), **Owner drawings** (the owner took or sold them privately), or any expense or equity category.",
            ],
          },
          {
            p: "It posts the lot's cost to that category, out of Inventory, on the day.",
          },
        ],
      },
      {
        heading: "Move to another product",
        blocks: [
          {
            p: "For units that are really another product (a mixed-up label): they leave this lot and become a lot of the other product, at the same cost. Nothing posts.",
          },
        ],
      },
      {
        heading: "Put back",
        blocks: [
          {
            p: "Each take-out or move shows under its lot with **Put back**, which reverses it.",
          },
        ],
      },
    ],
    related: ["stock-overview", "landed-cost-and-lots", "cost-of-goods-sold"],
  },
  {
    slug: "reorder",
    category: "inventory",
    title: "Reorder: when to order and how many",
    summary:
      "For each product: how many it sells a day, when it runs out, the last day to order, and how many to order, with Order now and Order soon.",
    sections: [
      {
        heading: "The list",
        blocks: [
          { where: "Inventory → Reorder" },
          {
            table: {
              head: ["Status", "Means"],
              rows: [
                ["Order now", "Stock and what's on order are at or below the reorder point"],
                ["Order soon", "The last day to order is within two weeks"],
                ["Enough stock", "Nothing to do yet"],
                ["Not selling", "No sales lately"],
              ],
            },
          },
          {
            p: "**Order N** opens a new purchase order with the product and quantity filled in.",
          },
        ],
      },
      {
        heading: "The maths",
        blocks: [
          {
            list: [
              "**Sales a day:** half the last 7 days, 30% the last 30, 20% the last 90.",
              "**Safety stock:** covers ups and downs in sales over the lead time.",
              "**Reorder point:** sales a day × lead time, plus safety stock.",
              "**Order:** enough for the lead time and the days an order should last, less stock and what's on order, raised to the minimum order and rounded up to whole cartons.",
            ],
          },
        ],
      },
      {
        heading: "Settings",
        blocks: [
          {
            p: "Lead time and days each order lasts for the company (45 and 60 to start), and per product its own lead time, minimum order and units in a carton.",
          },
        ],
      },
      {
        heading: "Not yet",
        blocks: [
          {
            list: [
              "Leaving out days you were out of stock.",
              "Seasons.",
              "Stock per location (FBA against your warehouse).",
            ],
          },
        ],
      },
    ],
    related: ["purchase-orders", "products-and-skus", "home-needs-attention"],
  },
];
