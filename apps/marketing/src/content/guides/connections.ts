import type { Guide } from "./types";

/**
 * How to get each connection's keys and tokens, step by step. The in-app dialogs carry the short
 * version (commerce/channels/amazon.tsx, walmart.tsx, noon.tsx; banking/accounts/
 * connect-wise-dialog.tsx); keep these in step with them.
 */
export const CONNECTION_GUIDES: readonly Guide[] = [
  {
    slug: "connect-amazon",
    category: "marketplaces",
    title: "Connect Amazon: get your Selling Partner API keys",
    summary:
      "Create a private Selling Partner API app for your own seller account, give it the roles Bookalyze needs, and paste its client ID, client secret and refresh token. About 15 minutes, plus Amazon's review of a new developer profile.",
    sections: [
      {
        heading: "What you'll need",
        blocks: [
          {
            p: "Amazon lets a seller build a **private app** that only reads their own account. Bookalyze uses yours, so your data goes from Amazon straight into your company. You'll paste four things into Bookalyze:",
          },
          {
            table: {
              head: ["Value", "Where it comes from"],
              rows: [
                ["Region", "North America, Europe (with the Middle East and India), or Far East"],
                ["LWA client ID", "Your app in Seller Central → Develop Apps"],
                ["LWA client secret", "The same place, next to the client ID"],
                ["Refresh token", "Made when you choose Authorize on the app"],
              ],
            },
          },
          {
            note: "You need to be the primary account holder, or a user with permission to manage apps, to do this in Seller Central.",
          },
        ],
      },
      {
        heading: "1. Register as a developer (first time only)",
        blocks: [
          {
            steps: [
              {
                title: "Open Develop Apps",
                body: "In Seller Central, open **Apps and Services → Develop Apps**. If you've never built an app, Amazon asks you to fill in a **developer profile** first.",
              },
              {
                title: "Choose a private developer",
                body: "Say you're building an app to integrate **your own business** with Amazon (a private developer), not one to sell to other sellers.",
              },
              {
                title: "Pick the roles you'll need",
                body: "Tick the roles in the table below. A role your profile doesn't have can't be given to an app later without updating the profile.",
              },
              {
                title: "Wait for Amazon",
                body: "Amazon reviews new developer profiles. It can take a few days; you'll get an email when it's approved.",
              },
            ],
          },
          {
            note: "Each Amazon region is a separate seller account. If you sell in North America and in the UAE, you make one app, and authorise it once for each region's account.",
            tone: "tip",
          },
        ],
      },
      {
        heading: "2. Which roles to give the app",
        blocks: [
          {
            p: "Bookalyze only asks Amazon for what each feature needs. Give the app the roles for the features you'll use; you can add more later.",
          },
          {
            table: {
              head: ["Role in Seller Central", "What Bookalyze uses it for"],
              rows: [
                ["Inventory and Order Tracking", "Orders and their items"],
                [
                  "Finance and Accounting",
                  "Settlements, refunds, and checking refunds before a review request",
                ],
                ["Buyer Solicitation", "Review requests (Amazon's own Request a Review)"],
                ["Buyer Communication", "Sending a buyer invoice through Amazon"],
                [
                  "Tax Invoicing",
                  "The buyer's name and tax number on an invoice (only if your profile has it)",
                ],
                ["Amazon Fulfillment", "FBA stock and the FBA inventory ledger"],
                ["Product Listing", "Listing watch, and changing prices"],
                ["Pricing", "Prices, offers and Amazon's fee estimates"],
                ["Selling Partner Insights", "Review topics on listing watch (some stores only)"],
              ],
            },
          },
          {
            note: "Don't tick a role your developer profile doesn't have (Tax Invoicing is the usual one). Amazon then refuses the whole connection check, and Bookalyze shows Amazon's own words so you can see which.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "3. Create the app and authorise it",
        blocks: [
          {
            steps: [
              {
                title: "Add a new app client",
                body: 'In **Develop Apps**, choose **Add new app client**. Name it ("Bookalyze" is fine), choose the **SP API** type and tick the roles from the table.',
              },
              {
                title: "Copy the LWA credentials",
                body: "Open the app's **LWA credentials** (View). Copy the **client ID** and the **client secret**.",
              },
              {
                title: "Authorise it for your account",
                body: "Choose **Authorize** on the app, then **Authorize app**. Amazon shows a **refresh token** once. Copy it.",
              },
            ],
          },
          {
            note: "Treat the client secret and refresh token like passwords. Paste them only into Bookalyze. If one leaks, rotate the secret in Develop Apps and authorise again.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "4. Paste them into Bookalyze",
        blocks: [
          { where: "Commerce → Channels → Add a channel → Amazon" },
          {
            steps: [
              {
                title: "Choose the region",
                body: "The region of the seller account you authorised: North America (Amazon.com, .ca, .com.mx), Europe (including Amazon.ae, .sa, .eg and India), or Far East.",
              },
              {
                title: "Paste the client ID, client secret and refresh token",
                body: "Bookalyze checks them with Amazon straight away and saves them encrypted. You won't see them again.",
              },
              {
                title: "Choose your marketplaces",
                body: "Every marketplace the account sells on becomes a channel in its own currency. Switch off the ones you don't use.",
              },
              {
                title: "Choose when orders start",
                body: "On Commerce → Orders, pick the day to bring orders in from (the start of your financial year is the default, up to two years back).",
              },
            ],
          },
          {
            check: [
              "The Amazon region shows **Connected** on Commerce → Channels",
              "Your marketplaces are listed, each in its currency",
              "Orders start arriving within minutes (a first sync of thousands takes a few hours, on its own)",
            ],
          },
        ],
      },
      {
        heading: "Changing roles later",
        blocks: [
          {
            p: "When you add a role to the app (say Buyer Solicitation, to start review requests), Amazon only applies it to a **new** refresh token. Choose Authorize again in Develop Apps, then on the channel's page choose **Replace credentials** and paste the new token.",
          },
        ],
      },
      {
        heading: "If something goes wrong",
        blocks: [
          {
            table: {
              head: ["You see", "What to do"],
              rows: [
                [
                  "Amazon refused the credentials",
                  "Check the client ID and secret were copied whole, and the refresh token is from Authorize, not the secret.",
                ],
                [
                  "A role is missing (Bookalyze names it)",
                  "Add the role to the app, authorise again, and paste the new refresh token.",
                ],
                [
                  "Access denied on Amazon.ae, .sa or .eg",
                  "Usually a role the developer profile lacks (Tax Invoicing, or Selling Partner Insights). Remove it from the app, or add it to the profile, then authorise again.",
                ],
              ],
            },
          },
        ],
      },
    ],
    related: ["channels", "orders", "amazon-settlements", "automatic-review-requests"],
  },
  {
    slug: "connect-walmart",
    category: "marketplaces",
    title: "Connect Walmart: create an API key",
    summary:
      "Add your Walmart countries, then create a client ID and secret in Walmart's Developer Portal for each one and paste them on the country's channel page. About 10 minutes.",
    sections: [
      {
        heading: "Before you start",
        blocks: [
          {
            p: "Walmart's US, Canada and Mexico seller accounts are separate, so each country is its own channel with **its own key**. Connect only the countries you sell in.",
          },
          { where: "Commerce → Channels → Add a channel → Walmart" },
          {
            steps: [
              {
                title: "Add the country",
                body: "Choose the United States, Canada or Mexico.",
              },
              {
                title: "Say who ships",
                body: "Walmart Fulfillment Services (WFS), you, or both. Bookalyze reads the matching order lists, and WFS stock when Walmart ships.",
              },
            ],
          },
        ],
      },
      {
        heading: "Create the key in Walmart's Developer Portal",
        blocks: [
          {
            steps: [
              {
                title: "Sign in to the Developer Portal",
                body: "Go to **developer.walmart.com** and sign in with the same login as your **Seller Center** account for that country.",
              },
              {
                title: "Open API key management",
                body: "Add a new key (or use an existing one) for your own account.",
              },
              {
                title: "Give it access to three areas",
                body: "**Orders**, **Reports** and **Inventory**. View only is enough: Bookalyze never changes anything on Walmart.",
              },
              {
                title: "Copy the client ID and client secret",
                body: "The secret is shown when the key is made. Keep it like a password.",
              },
            ],
          },
        ],
      },
      {
        heading: "Paste it into Bookalyze",
        blocks: [
          {
            where:
              "Commerce → Channels → (your Walmart country) → Walmart account → Connect Walmart",
          },
          {
            p: "Bookalyze gets a token from Walmart with the key, asks Walmart what the key can see, and saves it encrypted. Anything missing gets a warning: give the key that access in the portal and choose **Test connection**.",
          },
          {
            check: [
              'The country shows **Connected**, with "Key ending …" (the last four characters)',
              "Orders, Reports and Inventory each show the access you gave",
              "On Commerce → Orders, the country's orders start to arrive",
              "On the channel's **Walmart settlements** card, **Bring in from Walmart** brings in Walmart's settlement reports",
            ],
          },
        ],
      },
      {
        heading: "Replacing or removing the key",
        blocks: [
          {
            list: [
              "**Replace key** takes a new client ID and secret, for example after you rotate it in the portal.",
              "**Disconnect** deletes the key from Bookalyze. The channel keeps its orders, settlements and history.",
            ],
          },
        ],
      },
    ],
    related: ["walmart-settlements", "stock-overview", "channels"],
  },
  {
    slug: "connect-noon",
    category: "marketplaces",
    title: "Connect Noon: make a service account key file",
    summary:
      "Create a service account in Noon's partner portal, download its .json key file, and choose it in Bookalyze. One key covers every Noon country.",
    sections: [
      {
        heading: "Add your Noon countries",
        blocks: [
          { where: "Commerce → Channels → Add a channel → Noon" },
          {
            p: "Choose the UAE, Saudi Arabia or Egypt, and who ships the orders: **Fulfilled by Noon (FBN)**, **Fulfilled by you (FBP)**, or both. Add each country you sell in.",
          },
        ],
      },
      {
        heading: "Create the service account",
        blocks: [
          {
            steps: [
              {
                title: "Open API users",
                body: "Sign in at **access.noon.partners**, then **User & Access → API Users**.",
              },
              {
                title: "Add Service Account",
                body: "Give it a name, and a role that can **download reports**, such as **Project Owner** or **Project Admin**.",
              },
              {
                title: "Leave the IP whitelist empty",
                body: "Bookalyze runs on servers without a fixed address, so a whitelist would block it.",
              },
              {
                title: "Download the key file",
                body: "Noon gives you a **.json** key file **once**. Save it somewhere safe; if it's lost, make a new service account.",
              },
            ],
          },
        ],
      },
      {
        heading: "Choose the file in Bookalyze",
        blocks: [
          { where: "Commerce → Channels → (a Noon country) → Noon's API → Connect Noon's API" },
          {
            p: "The file is read in your browser and sent once. Bookalyze keeps only what it needs to sign in (the key ID, private key and project code), encrypted, and signs in to Noon to check it.",
          },
          {
            check: [
              "Noon's API shows **Connected** with your project",
              '"N reports available, payouts included": the payouts report (the transaction view) is what posts Noon to your books',
              "On Commerce → Settlements → Noon, **Bring in from Noon** fetches a year of transactions",
            ],
          },
          {
            note: "If the key has no payouts report, Bookalyze warns you. Give the service account a role with finance access in Noon's portal, then choose **Test connection**.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "No API? Upload instead",
        blocks: [
          {
            p: "Everything also works from files: download **Finance → Transaction view** (CSV) from Noon's seller portal and upload it on Commerce → Settlements → Noon. Connect the key whenever you're ready.",
          },
        ],
      },
    ],
    related: ["noon-months", "noon-fbn-stock", "channels"],
  },
  {
    slug: "connect-ebay",
    category: "marketplaces",
    title: "Connect eBay: no keys needed",
    summary:
      "eBay is the one marketplace without keys to copy: you agree on eBay's own page, with read-only access, and one connection covers every eBay site you sell on.",
    sections: [
      {
        heading: "Connect",
        blocks: [
          { where: "Commerce → Channels → Add a channel → eBay" },
          {
            steps: [
              {
                title: "Add your eBay sites",
                body: "US, Canada, UK, Australia, Germany, France, Italy or Spain, each in its currency.",
              },
              {
                title: "Choose Connect eBay",
                body: "On a site's page, under eBay account. You're taken to eBay.",
              },
              {
                title: "Sign in and agree",
                body: "eBay shows what Bookalyze can read: orders (read-only), finances, and your account details. Agree, and you're brought back.",
              },
            ],
          },
          {
            check: [
              "A message says eBay is connected, and every eBay site shows **Connected**",
              "Orders arrive on Commerce → Orders",
              "Commerce → Settlements → eBay fills with each site's months",
            ],
          },
        ],
      },
      {
        heading: "Good to know",
        blocks: [
          {
            list: [
              "eBay's consent lasts about 18 months. When it runs out, the channel shows **Needs attention**: choose **Connect again**.",
              "**Disconnect** deletes the sign-in; your sites keep their history.",
              "UK and EU sellers: eBay asks for signed finance requests, which are coming. Until then, upload Seller Hub's transaction report for those sites.",
            ],
          },
        ],
      },
    ],
    related: ["ebay-months", "channels"],
  },
  {
    slug: "connect-wise",
    category: "banking",
    title: "Connect Wise: make a read-only API token",
    summary:
      "Create a read-only token in Wise, paste it into Bookalyze, and every Wise balance syncs to your books each day, in every currency, with fees split out.",
    sections: [
      {
        heading: "Why Wise",
        blocks: [
          {
            p: "Most marketplace sellers get paid in several currencies. Wise holds them all, and with the sync, every Wise transaction lands in your books on its own: categorised by your rules, conversions between your balances recorded as one transfer, and Wise's fees as their own line.",
          },
        ],
      },
      {
        heading: "Create the token in Wise",
        blocks: [
          {
            steps: [
              {
                title: "Open Settings → API tokens",
                body: "At **wise.com/settings/api-tokens**. For a company, switch to the **business profile** first.",
              },
              {
                title: "Add a new token",
                body: "Choose **Read only** permission. Bookalyze never moves money.",
              },
              {
                title: "Copy it",
                body: "You'll paste it in the next step.",
              },
            ],
          },
          {
            note: "Wise asks for an extra signed check (strong customer authentication) on profiles outside the US, Canada, Australia, New Zealand, Singapore and Malaysia, for example a UAE business. The sync says so plainly for now; upload Wise's statements for those profiles until signing is supported.",
            tone: "caution",
          },
        ],
      },
      {
        heading: "Connect it in Bookalyze",
        blocks: [
          { where: "Banking → Bank accounts → Connect Wise" },
          {
            steps: [
              {
                title: "Paste the token",
                body: "Stored encrypted, used only to sync.",
              },
              {
                title: "Pick the Wise profile",
                body: "Personal or business.",
              },
              {
                title: "Map each balance",
                body: "Each Wise currency balance to a new or existing bank account in your books.",
              },
              {
                title: "Choose the start date and fee account",
                body: "Transactions from that day come in; Wise's fees go to the account you choose.",
              },
            ],
          },
          {
            check: [
              "Transactions appear straight away, and every day after on their own",
              'Bank accounts shows **what Wise says** next to **your balance in Bookalyze**, and "Matches"',
              "Anything that looks like a transaction already in your books is flagged as a possible duplicate, not added twice",
            ],
          },
        ],
      },
    ],
    related: ["bank-rules", "duplicates-and-transfers", "reconcile", "match-payouts"],
  },
];
