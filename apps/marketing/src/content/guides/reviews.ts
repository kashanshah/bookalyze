import type { Guide } from "./types";

/** Review requests: Amazon's own Request a Review, by hand, in bulk and automatically. */
export const REVIEW_GUIDES: readonly Guide[] = [
  {
    slug: "automatic-review-requests",
    category: "reviews",
    title: "Automatic review requests: ask every buyer, at the right time",
    summary:
      "Switch it on once and Bookalyze asks every eligible Amazon buyer for a review on the day you choose after delivery, skipping refunds, claims and anyone you leave out. It's Amazon's own Request a Review, so it's within Amazon's rules.",
    sections: [
      {
        heading: "Why it matters",
        blocks: [
          {
            p: "Most happy buyers never leave a review unless they're asked. Amazon's **Request a Review** asks them in their own language, but only one order at a time in Seller Central, and only between 5 and 30 days after delivery. Few sellers keep that up by hand. Bookalyze does it every hour, for every marketplace, on its own.",
          },
          {
            list: [
              "**Amazon's own request only.** One standard Amazon message per order; no custom emails, nothing against Amazon's rules.",
              "**Never twice.** An order already asked, here or in Seller Central, is never asked again.",
              "**Never the unhappy ones.** Refunded orders, A-to-z claims and chargebacks are checked with Amazon just before sending, and skipped.",
            ],
          },
        ],
      },
      {
        heading: "Before you switch it on",
        blocks: [
          {
            p: "Your Amazon app needs two roles: **Buyer Solicitation** (to send requests) and **Finance and Accounting** (to check refunds). If you added a role after connecting, authorise the app again and replace the refresh token on the channel's page.",
          },
          {
            note: "The Connect Amazon guide shows how to add roles and get a new refresh token.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "Set it up",
        blocks: [
          { where: "Review requests → Automatic requests" },
          {
            steps: [
              {
                title: 'Turn on "Ask every buyer automatically"',
                body: "Off, requests only go out when you ask from the list. On, new orders are planned as they ship.",
              },
              {
                title: "Choose the days after delivery",
                body: "From 5 to 25, counted from Amazon's latest delivery date. Most sellers ask after **7 to 10 days**, once the buyer has used the product.",
              },
              {
                title: "Choose the time of day and the days of the week",
                body: "In your company's time zone. On other days, requests wait for the next chosen day, never past Amazon's window.",
              },
              {
                title: "Choose marketplaces and who shipped",
                body: "Every Amazon marketplace, or some; orders Amazon shipped (FBA), orders you shipped, or both.",
              },
              {
                title: "Choose what to skip",
                body: "Refunded orders (also A-to-z claims and chargebacks), replacement orders, Amazon Business orders, orders with a coupon or promotion, and any SKUs you list.",
              },
              {
                title: "Choose where to start",
                body: "**Only new deliveries**, or **also recent orders**: every order still inside Amazon's 30-day window is asked too.",
              },
            ],
          },
          {
            p: "Saving plans the requests straight away. Nothing is sent from the settings screen itself.",
          },
        ],
      },
      {
        heading: "How it runs",
        blocks: [
          {
            list: [
              "Every hour, Bookalyze sends the requests that are due, about one a second, as Amazon allows.",
              "Each order's window is Amazon's: from 5 days after the earliest delivery date to 30 days after the latest. For FBA orders, where Amazon doesn't give delivery dates, Bookalyze estimates them from the purchase date and lets Amazon's own answer decide.",
              "If Amazon says an order isn't ready yet, it's tried again a day later, up to five times.",
              "Orders left out by these settings can still be asked by hand.",
            ],
          },
        ],
      },
      {
        heading: "What you should see",
        blocks: [
          {
            check: [
              "Review requests shows cards for **ready to ask now**, **scheduled** and **requested lately**",
              "The **Scheduled** tab lists upcoming orders with the day each will be asked",
              "After the next hourly run, sent orders move to **Requested**",
              "A refunded order shows under **Left out** with the reason",
              "Each order's page has a Review request box with its status",
            ],
          },
        ],
      },
    ],
    related: ["review-requests", "connect-amazon", "orders"],
  },
  {
    slug: "review-requests",
    category: "reviews",
    title: "Ask for reviews by hand or in bulk",
    summary:
      "See every Amazon order you can ask for a review, ask one, a selection, or every ready order at once, and leave out the ones you'd rather not ask.",
    sections: [
      {
        heading: "The Requests page",
        blocks: [
          { where: "Review requests → Requests" },
          {
            table: {
              head: ["Tab", "What's in it"],
              rows: [
                ["To ask", "Orders inside Amazon's window, not asked yet"],
                ["Scheduled", "Orders automatic requests will ask, with the day"],
                ["Requested", "Orders asked, with when and how (automatic, by hand, in bulk)"],
                ["Left out", "Orders you chose not to ask, or skipped by a setting, with why"],
              ],
            },
          },
          {
            p: "Filter by marketplace with the chips above the list.",
          },
        ],
      },
      {
        heading: "Ask",
        blocks: [
          {
            list: [
              "**Ask now** on one order.",
              "Tick several and **Ask** them together, or **Don't ask** to leave them out (with Undo).",
              "**Ask all N ready** asks every order whose window is open, 30 at a time, carrying on until done.",
              "**Put back** returns a left-out order to To ask.",
              "On an order's page: **Ask for a review now**, and **Check with Amazon** to see if it's eligible.",
            ],
          },
          {
            note: 'If Amazon says "not yet" to an order you asked by hand, nothing is recorded: ask again in a few days.',
            tone: "tip",
          },
        ],
      },
      {
        heading: "Who can do what",
        blocks: [
          {
            p: "Owners and admins send requests and change settings. Members can see the lists.",
          },
        ],
      },
    ],
    related: ["automatic-review-requests", "connect-amazon"],
  },
];
