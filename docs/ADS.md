# Advertising cost and profit after ads

Design note for ad spend per SKU per day in Bookalyze's profit analytics. It covers the data
model, how it reconciles with the ad fees the books already hold, how Sponsored Brands is
handled, the numbers the product profit page shows, and the edge cases. Status and what's next
live in `docs/STATUS.md`; this file is the reasoning.

**Scope.** Spend, ad-attributed sales, orders and units per SKU (and campaign) per day, for
accounting and profit. Not ads optimisation: no keywords, search terms, placements, bids or
budgets. Those stay in the seller's ads tools.

---

## 1. Why

On Amazon a product can look profitable on its own and lose money once its ads are paid. The
marketplace's reports show ACOS (ad spend over ad sales) per campaign; they don't know what
the product cost, what the fees were or what's left. Bookalyze knows those (settlements, cost of
goods, landed costs), so it can say, per product and per channel:

- what each unit really leaves after fees, product cost **and** ads;
- which products lose money, and how much they lost in the period;
- the highest ACOS a product can afford before its ads lose money (**break-even ACOS**), next to
  its actual ACOS;
- how much of its sales depend on ads (**TACOS**: ad spend over all its sales).

## 2. The model: one store for every marketplace's ad metrics

Table **`ad_metrics`** (migration `0089_ad_metrics`), one row per channel, ad type, day, campaign
and SKU:

| Column | Meaning |
|---|---|
| `organization_id` | Tenant (RLS) |
| `channel_id` | The sales channel the ads ran on (Amazon.ca, Noon UAE…). Ads are kept only for the company's channels |
| `connection_id` | The ads account it came from (null for an upload) |
| `source` | `amazon_ads` (Amazon Ads API), `walmart_ads` (Walmart Connect), `ebay` (eBay's ad fees in its Finances rows) or `upload` (a file, e.g. Noon's Ad Manager export, later) |
| `account_ref` | The ads account at the source: Amazon's profile ID, Noon's partner, eBay's seller |
| `country` | The marketplace's country |
| `date` | The day the spend happened, in the ads account's time zone |
| `ad_type` | `sponsored_products`, `sponsored_brands`, `sponsored_display`, `promoted_listings`, `other` |
| `campaign_id`, `campaign_name` | The campaign (name as it was on that day) |
| `sku` | The seller SKU advertised; **null** when the ad type has no per-SKU spend (Sponsored Brands) |
| `listing_ref` | The marketplace's own listing ID: ASIN, Noon SKU, eBay item ID |
| `currency` | The ads account's currency |
| `spend` | Cost in that currency (`NUMERIC`) |
| `fx_rate`, `spend_base` | Main-currency units per unit, and the spend in the main currency, filled from Bookalyze's exchange rates (`fx_rates`, Bank of Canada) when it's brought in; null until a rate exists (the page converts those on read) |
| `impressions`, `clicks` | Counts |
| `attributed_sales`, `attributed_orders`, `attributed_units` | What the source attributes to the ads |
| `attribution_window` | `7d`, `14d`, `30d` or `""`: Amazon's Sponsored Products are 7 days for sellers, Sponsored Brands 14 |

Unique on `(channel_id, source, ad_type, date, campaign_id, sku)` (nulls not distinct). Rows are
**replaced by window**: a sync deletes the channel's rows of that source and ad type for the
days it fetched, then inserts what the report says. So a campaign that Amazon re-attributed or
that disappeared from a report is right after the next sync.

Table **`ad_report_requests`**: Amazon's reports are asynchronous (ask, wait minutes, download).
One row per report asked: connection, channel, profile, ad type, the days, Amazon's report ID,
`pending` / `done` / `failed`, when, and Amazon's reason. "Brought in through" for a channel is
the last day of its latest `done` request.

**SKUs to products** work as everywhere else: `product_skus (channel, sku)` links a seller SKU to
one product, or to several for a bundle. When a report has an ASIN but no SKU, the SKU comes
from `channel_skus` (the marketplace's own list).

**Currency.** Each channel's numbers are in its own currency, like Channel profit. The "All
channels" summary is in the main currency: `spend_base` when stored, else that day's rate
(`suggestRate`); spend without a rate is left out of the total and the page says so.

## 3. Reconciling with ad fees already in the books

The books stay the accounting truth. Ad metrics are analytics. They never post.

Where ad money already reaches the books:

- **Amazon settlements** carry "Cost of Advertising" lines when ads are paid from the seller
  balance (`SETTLEMENT_GROUPS.advertising`, Channel profit's "Advertising" row). When ads are
  charged to a card instead, they reach the books as a card transaction in an expense category,
  which counts against a channel only if the seller chose so in **Your own costs**.
- **Noon** takes advertising inside a statement fee (`NOON_ADVERTISING_PATTERN` in
  `noon-posting.ts`), also on Channel profit's "Advertising" row.
- **eBay** promoted listings fees are in its finances rows; **Walmart** has none in settlements.

Decisions:

1. **Channel profit's columns are unchanged.** Their "Advertising" row is still the books'
   (what was charged in the period). Two muted rows are added below Profit: **Ad spend (ads
   reports)** and **TACOS**. A hint explains the difference: Amazon invoices ads by threshold or
   month (timing), card-billed ads aren't in settlements, Noon charges with a lag. Nothing is
   added twice, because report spend is never added into Profit there.
2. **Product profit allocates.** Per SKU, the channel's money before ads is shared out, and the
   **report spend** is subtracted per SKU:
   - **keep rate** = (net of the amounts **on orders**, with the books' advertising added back) ÷
     sales, for the channel in the period (core `orderKeepRate`). It's what the marketplace leaves
     you per unit of sales after referral and fulfilment fees, refunds, the orders' promotions and
     other per-order lines, but before ads. Amazon's settlement lines are on an order when their
     transaction type is Order, Refund, a chargeback or an A-to-z claim (core
     `settlementLineOnOrder`); Noon's, eBay's and Walmart's sums aren't split, so all of theirs.
   - **Sales** in that ratio are the same as the products': when the channel's order lines take
     their promotions off (Amazon, eBay), so does the ratio's base (sales + promotions); otherwise
     (Noon, whose promotions are its own subsidies) it's gross sales. Before this, Amazon's
     promotions came off twice: once from the products' sales and again inside the rate.
   - **A SKU's own rate**: with 5 or more units in the period's Amazon settlements kept by SKU
     (`settlement_sku_lines`, db `settledSkuLinesForProfit`), its rate comes from its own orders'
     amounts (core `skuKeepRates`): fulfilment fees are about the same per unit at very different
     prices, so one channel rate overstates cheap products and understates dear ones.
   - **Fewer settled units: Amazon's fee estimate.** Inventory → Prices keeps Amazon's fee
     estimate for each listing at its own price whenever it reads prices (`listing_prices.fees_*`,
     db `saveFeeEstimate`, `listingFeeEstimates`). A SKU with fewer than 5 settled units uses it
     (core `estimatedKeepRate`): 1 − referral ÷ the estimate's price − the other fees (FBA,
     closing; fixed per unit) ÷ the SKU's own average price − its own refunds ÷ its sales (from
     `order_refunds` by SKU on its orders sold, not given away; they include any tax given back,
     so they run a little high). Without an estimate (prices not refreshed yet, not an Amazon
     channel, or not linked to a product), the channel's rate, and the channel says to refresh
     prices.
   - **Units given away** (an order line whose promotion is its whole item price: Vine, a free
     replacement) aren't in any product's units, cost or rate (db `skuSalesForProfit`'s
     `giveaway_units`; core `settledKeepRates` leaves their settled orders out of every rate). A
     launch's Vine units would otherwise charge their landed cost and fulfilment fees to the units
     that sell. They're their own line (core `giveawayCosts`): units × each one's cost, plus the
     marketplace's fees per unit given away (the SKU's settled giveaways, else every SKU's) × the
     period's units. With settlements by SKU, the channel's rate also comes from them, giveaways
     left out.
   - **The account's own costs** (Amazon's lines on no order: storage, the selling plan, inbound
     placement, Vine, coupon fees, less reimbursements for lost stock; balance moves such as a
     carried balance or a card charge left out) are **not** in any rate. They don't grow with each
     unit, so shared by sales they'd make every unit look unprofitable in a launch month, the
     fewer units the worse. They're their own line on the channel, in full (core `accountCosts`),
     taken off the channel's profit after ads, like Sponsored Brands.
   - **Orders not settled yet**: a rate is a ratio of settled amounts to the same orders' sales,
     so it's applied to the period's later sales as an estimate; the channel says how much of its
     sales came after its last settlement (db `salesAfter`). The account's own costs are only
     what the period's settlements charged, never scaled up to the unsettled sales.
   - SKU's **net before ads** = its sales × its keep rate.
   - SKU's **product cost** = units × its listing cost (the next unit's landed cost, bundles
     summed: core `listingCost`).
   - **Profit before ads** = net before ads − product cost.
   - **Profit after ads** = profit before ads − its report spend.
   Because the books' advertising is taken out of the keep rate and the report's spend is taken
   off per SKU, ads are counted once, from the report. The table's footer shows the books'
   advertising for the channel next to the reports' total, with the difference.
3. **Without ad reports** for a channel (Walmart without Walmart Connect, Noon until its upload), the product table
   still works: spend is 0 and the books' advertising is shown as "not split by product" so the
   channel's profit isn't overstated.

## 4. Sponsored Brands (and Display)

Sponsored Brands has no per-SKU spend: an SB campaign promotes a brand or several products and
Amazon reports cost per campaign (its purchased-product report has sales by ASIN, not cost).

**Decision: keep SB at campaign level, not allocated.** Its spend is stored with `sku` null and
shown as one line per channel, **"Sponsored Brands (not tied to one product)"**, which counts in
the channel's profit after ads, TACOS and totals but not in any product's. Splitting it by sales
share would make every product look a little worse and hide which one the campaign was for.
On the SKU profit and loss (§6b) it can be shared out instead, as a choice: by each SKU's
Sponsored Products ad sales for now, by SB-attributed sales (`sbPurchasedProduct`) later.

Sponsored Display is per SKU (`sdAdvertisedProduct`, its promoted SKU and ASIN), so it's tied to
products like Sponsored Products.

## 5. Amazon Ads API sync

- **Consent** through Bookalyze's one Ads API client (LWA security profile; env
  `AMAZON_ADS_CLIENT_ID`, `AMAZON_ADS_CLIENT_SECRET`), like eBay: the admin agrees on Amazon's
  page, Amazon sends a code to `/api/amazon-ads/callback`, the refresh token is sealed in the
  vault on a connection `amazon_ads` (one per Ads region: North America for Amazon.ca, Europe for
  Amazon.ae). State is signed and tied to the browser by a cookie.
- **Profiles**: `GET /v2/profiles`; each seller profile's `accountInfo.marketplaceStringId`
  matches a channel's `marketplace_id`. Profiles with no channel are listed and skipped.
- **Reports (v3)**: `POST /reporting/reports`
  - `spAdvertisedProduct`, group by `advertiser`, daily: date, campaign, advertised SKU and ASIN,
    impressions, clicks, cost, `sales7d`, `purchases7d`, `unitsSoldClicks7d`.
  - `sbCampaigns`, group by `campaign`, daily: date, campaign, impressions, clicks, cost, `sales`,
    `purchases`, `unitsSold` (14 days).
  - `sdAdvertisedProduct`, group by `advertiser`, daily: date, campaign, promoted SKU and ASIN,
    impressions, clicks, cost, `sales`, `purchases`, `unitsSold` (views and clicks, 14 days).
  - At most 31 days a report. Poll `GET /reporting/reports/{id}`; on `COMPLETED` download the
    gzipped JSON from its `url`.
- **When**: the daily job asks for each channel's window; the 5-minute job collects finished
  reports. Window: the last **15 days** every day (attribution changes for 14), and on first
  connect the last **60 days**, 31 at a time. "Bring in ads now" on the channel page does the
  same at once and waits up to ~45 seconds.
- A report pending more than 6 hours is marked failed and asked again.

## 6. The product profit page

**Commerce → Channel profit → By product** (`/commerce/profit/products`), with the period
controls and a channel picker.

Summary cards: **Profit after ads**, **Ad spend** with **TACOS**, **Products losing money**
(count and how much they lost), **Ad spend with no sales**.

One row per SKU (product name when linked), sorted by profit after ads, worst first:

| Figure | How |
|---|---|
| Units, sales | Order lines purchased in the period (company time zone), cancelled orders left out; sales = item price less promotion |
| Avg price | Sales ÷ units |
| Net before ads | Sales × the SKU's own keep rate (5+ settled units), else the channel's |
| Product cost | Units × listing cost |
| Profit before ads, per unit | |
| Ad spend, ad sales, ad orders | From `ad_metrics` |
| ACOS | Ad spend ÷ ad sales |
| TACOS | Ad spend ÷ sales |
| Break-even ACOS | Profit before ads ÷ sales: above it, each ad sale loses money |
| Organic share | (Sales − ad sales) ÷ sales, at least 0 |
| Clicks, CPC, conversion | Spend ÷ clicks; ad orders ÷ clicks |
| Break-even CPC | Profit before ads per unit × conversion: the most a click can cost |
| Profit after ads, per unit, margin | |
| Verdict | See below |

**Verdicts** (core `adVerdict`), worst first:
- **Losing money**: loss before ads; ads only make it worse.
- **Ads eat the profit**: profitable before ads, loss after.
- **Ads cost more than they earn**: still profitable, but ACOS above break-even ACOS.
- **Ads with no sales**: spend and no attributed sales.
- **Cost missing**: the SKU isn't linked to a product, or the product has no cost yet.
- **Healthy**.

## 6b. The SKU profit and loss (the main output)

What the owner wants from all this: pick one SKU, or see every SKU, for **any date range**, and
see exactly what it made or lost. Layout: a summary row per SKU (all channels, in the main
currency), a drill-down per channel (in the channel's currency, original amounts kept), and a
breakdown for one SKU as a waterfall:

| Step | Source | Actual or estimated |
|---|---|---|
| Units sold and returned | Order lines; refunds on orders (`orders.refunded`, by item price share) | Actual |
| Gross sales, promotions and coupons | Order lines (item price, promotion discount) | Actual |
| Refunds | Settlement/transaction refund lines with the SKU; else order refunds | Actual when the rows carry the SKU |
| Referral / commission | Settlement and transaction rows with the SKU | Actual per SKU (see below), else **estimated** by the keep rate |
| FBA / fulfilment | Same | Same |
| Storage, subscription, other account-level fees | Settlement lines with no SKU | Allocated by units (estimated, said so) |
| Cost of goods | Lot consumptions of posted COGS months (actual); units × next unit cost for months not posted | Actual / estimated |
| Ad spend | `ad_metrics` per SKU; Sponsored Brands its own line, or shared by each SKU's Sponsored Products ad sales when chosen (SB-attributed sales later) | Actual (reports); attribution can still change for 14 days → **estimated** for the last 14 days |
| Profit, margin, per unit, TACOS | Computed | Estimated if any part is |

Honesty rules: orders not yet in a settlement are **estimated** (fees at the rates the SKU's settled orders show, else the channel's, else the keep rate); ads in
the last 14 days are **estimated** (attribution moves); a period shows "x% actual" and each cell
is marked when estimated. Ad cost without Amazon Ads shows "not connected yet", and the view
works without it. Every amount converts to the main currency at its day's rate; the channel
drill-down shows the original currency. CSV export of all of it.

**Per-SKU fees, by marketplace, with today's data:**
- **Noon**: `noon_transactions` keep each row with its SKU and partner SKU → actual today.
- **Walmart**: `walmart_settlement_rows.data` keeps each report row whole (with its SKU column)
  → actual today, once the column is read.
- **Amazon**: settlements are stored **summed by kind** (`settlement_lines`), without the
  flat file's `sku` and `order-id`. Exact per-SKU fees need a new table of settlement amounts by
  SKU (and order), filled when a settlement is brought in or uploaded; settlements already in are
  filled by bringing them in again (Amazon lists them for months) or re-uploading the file. Until
  then, Amazon's per-SKU fees are the keep-rate estimate.
- **eBay**: rows carry the order, not the SKU: matched through the order's lines (exact for
  one-SKU orders, split by item price otherwise).

**Built (slice 2, "SKU P&L, exact")**: **Commerce → Channel profit → By product → Profit and loss,
line by line** (`/commerce/profit/products/pnl`, one SKU at `…/pnl/[sku]`; server `server/sku-pnl.ts`,
core `commerce/sku-pnl.ts`, db `sku-pnl.ts`).

- **Amazon by SKU**: table `settlement_sku_lines` (migration `0092_settlement_sku_lines`): each
  settlement's amounts summed by order, SKU and kind (transaction type, amount type,
  description), with the rows' units (`quantity-purchased`) and first posted day; rows with no
  order or SKU are the account's fees. `settlements.sku_detail_at` says they're all in. Filled by
  core `parseSettlementReport` (`skuLines`) when a settlement is brought in (`saveSettlement`) or
  uploaded (the flat file is read in the browser; its lines go 1,500 per call,
  `uploadSettlementSkuLinesAction`). **Refill**: the sync downloads again every report whose
  settlement has no detail yet (looking back the 90 days Amazon lists) and only fills its lines:
  the settlement and its place in the books stay as they are. Older ones: upload the flat file
  again. The P&L page counts the settlements in the period still without detail and says how.
- **The period is the orders'**: a SKU's period is its order lines bought in it (company time
  zone, cancelled left out), and every marketplace amount on those orders counts there, even one
  settled later. Amounts on no order the company has (not synced, or older than the history) make
  their own line, dated by their rows; amounts on an order bought in another period count there.
  Amounts on a SKU but no order (a reimbursement for its stock) count by their day; the account's
  own (storage, the selling plan, Noon's statement fees) by their day, shared by units sold
  (estimated).
- **Each marketplace's rows by SKU** (core `amazonSkuKind`, `noonSkuRows`, `ebaySkuRows`,
  `walmartSkuRow`): sales, shipping, promotions, refunds, referral, fulfilment, other fees (tax on
  fees when it's a cost), reimbursements, advertising, other; sales tax, reserves and payouts left
  out. Noon by partner SKU (one unit per order row), Walmart by its PO and SKU columns (reports up
  to 45 days after the period), eBay by order, shared over the order's lines by item price.
- **Settled or estimated**: a line whose sale is in the marketplace's rows is settled (actual).
  Otherwise sales and promotions come from the order, refunds from the order's refunds (by item
  price share), and fees at the rates the SKU's settled lines show (else the channel's); with
  nothing settled on the channel at all, the keep rate ("Marketplace fees (keep rate)", which then
  includes the account's fees). Without a keep rate either, profit is "—".
- **Cost of goods**: units × each component's unit cost posted for the order's month (lot
  consumptions of kind `sale` of the channel's posted COGS month, db `postedUnitCosts`: actual);
  months not posted use the next unit's landed cost (estimated). Returns aren't taken off (the
  books' monthly COGS does that by the ledger).
- **Ads**: `ad_metrics` by SKU and day; the last 14 days estimated. Sponsored Brands is its own
  line by default; **Shared by ad sales** (`?brands=shared`) splits it by each SKU's Sponsored
  Products ad sales in the period (else its sales), estimated. With ads reports, the books' ad
  charges aren't counted again; without them, ad charges on a SKU or order are its ads and the
  account's are a channel line "Advertising in your books", and the page says ad cost isn't
  connected yet.
- **Currencies**: each channel in its own currency (cost of goods converted from the main
  currency at its day's rate); the All channels summary converts each amount at its own day's
  rate (`fxRatesForDays`, Bank of Canada fetched for the range when missing; amounts without a
  rate are left out and counted).
- **Screens**: cards (profit and margin, sales with units sold and returned, ad spend and TACOS,
  "x% actual"); a table per SKU, worst first (units, sales, fees and refunds, cost of goods, ads,
  profit, margin, per unit, TACOS, actual share), each amount marked ≈ when partly estimated; a
  channel picker. One SKU: the waterfall from gross sales to profit (main currency) and **By
  channel** (each line per channel in its currency). **Download CSV**
  (`/api/o/[slug]/commerce/sku-pnl`, core `skuPnlCsvRows`): All channels then each channel, every
  line, profit, margin, per unit, TACOS, actual %, estimated amount; `sku=` for one.

**PR plan:**
1. Done: the ad metrics store, Amazon Ads sync, By product (SKU summary, estimated fees).
2. Done: SKU P&L, exact (above).
3. Noon ads upload, eBay Promoted Listings, Sponsored Display, Walmart Connect (§9).
4. Later: Sponsored Brands by each ASIN's share of SB-attributed sales (`sbPurchasedProduct`),
   in place of the Sponsored Products share; the date range transaction report's SKUs into
   `settlement_sku_lines` (only the flat file and the API's report fill it today).

## 7. Edge cases

- **Spend with no orders**: the SKU still gets a row (its sales are 0, its loss is the spend).
- **Ad sales above sales**: attribution counts orders up to 7 or 14 days after a click, so ads
  in the last days of a period claim orders in the next. Organic share stops at 0.
- **Different days**: ad days are in the ads account's time zone, orders in the company's.
- **Cost missing**: profit is "—" and the row says how to fix it (link the SKU, add a cost).
- **Bundles**: cost sums each product × units; ads stay on the bundle's SKU.
- **No settlements in the period** (a new channel): no keep rate, so profit before ads uses the
  last 90 days' keep rate (on orders, too); with none either, it's "—". The SKU profit and loss
  (§6b) keeps the account's fees in its keep-rate fallback: with nothing settled by product it has
  no rows to share them from; it takes promotions off the same way.
- **Refunds**: in the keep rate on By product; per SKU and order on the SKU profit and loss (§6b).
- **ASIN without SKU** in a report: mapped through `channel_skus`; otherwise kept by ASIN.
- **Several SKUs per ASIN** (FBA and FBM): each SKU has its own row; Amazon reports the SKU.
- **Campaign renamed**: each day keeps the name it had.
- **Ads account disconnected**: its rows stay; nothing new comes in.
- **Switched-off channel**: its rows stay and show, tagged, like Channel profit.
- **Exchange rate missing**: left out of the All-channels total with a note.
- **Attribution changes** within 14 days: the 15-day window replaces them.
- **Reports older than Amazon keeps** (about 60 days for SB, 95 for SP): the first sync goes back
  60 days; older history needs an upload (later).
- **Vendor and agency profiles** are skipped: only seller profiles map to channels.

## 8. What the owner sets up on Amazon's side

See `docs/SETUP.md` → Amazon Ads. In short: a Login with Amazon security profile, approved for
the Amazon Ads API, its return URL `https://app.bookalyze.com/api/amazon-ads/callback`, and its
client ID and secret in Vercel. Bookalyze never asks for passwords or one-time codes.

## 9. Next (separate PRs)

1. **Noon**: Noon's partner API lists the reports a key can download at run time
   (`/impex/v1/export/category/list`, `NOON_EXPORT_CATEGORIES_PATH`); none known to the code is an
   ads report, and Noon's API documentation has no ads endpoint. First check, on Channels → Noon
   UAE → Noon's API → "Reports this key can download", for any report named for ads, sponsored
   products or campaigns. If there's none: an upload of Ad Manager's CSV/XLSX export into the same
   table (`source = 'upload'`).
2. ~~**eBay** Promoted Listings~~: done from eBay's own ad fees (below). Later, for impressions,
   clicks and Priority (cost per click) spend per listing: the Marketing API's reports, which need
   the `sell.marketing.readonly` scope (every company connects eBay again).

### eBay Promoted Listings (from eBay's ad fees)

- **Source:** the Finances rows already brought in (`ebay_transactions`): every charge whose fee
  type is advertising (`AD_FEE`, promoted…; core `EBAY_ADVERTISING_FEE`), with the order eBay
  ties it to. No new eBay access.
- **Rows** (core `ebayAdMetricRows`, db `refreshEbayAdMetrics`, `source = 'ebay'`,
  `ad_type = 'promoted_listings'`, `attribution_window` `30d`): an order's fees are shared over
  its lines by what each sold for (`splitUnits`), dated by its first fee; the sale is the ad's
  (General charges only when an ad led to the sale), so those lines' sales, units and one order
  are its attributed sales. A fee given back takes it off (in full: nothing left). A fee on no
  order Bookalyze has (Priority's click charges, an order not brought in) is spend tied to no
  product. No impressions or clicks.
- **When:** made again from every ad fee after eBay's money comes in (`syncEbayTransactions`, the
  report upload) and in the daily job, so orders that arrive later tie their fees to products.
- **Counted once:** with eBay rows in `ad_metrics`, the SKU profit and loss takes ads from them
  (`hasAdsReports`) instead of the same fees in eBay's money rows, and Profit by product's keep
  rate adds the books' advertising back, as for Amazon.
3. ~~**Sponsored Display**~~: done (`sdAdvertisedProduct`, §5).
4. ~~**Walmart Connect**~~: done (below).

### Walmart Connect (Sponsored Search)

- **Access:** only API partners call it. Bookalyze is one partner: its consumer ID, partner token
  and an RSA private key (env `WALMART_ADS_*`, docs/SETUP.md). Every call sends
  `Authorization: Bearer <token>`, `WM_CONSUMER.ID`, `WM_CONSUMER.intimestamp` (ms), 
  `WM_SEC.KEY_VERSION` and `WM_SEC.AUTH_SIGNATURE`: RSA-SHA256 over
  `consumerId\ntimestamp\nkeyVersion\n`, base64 (core `walmartAdsSignedText`).
- **Link:** the advertiser adds Bookalyze in Ad Center (Admin → API partners), then enters its
  advertiser ID on the Walmart channel's page; `GET /v1/campaigns?advertiserId=` checks access.
  It's a connection `walmart_ads` with no secret, settings `{ advertiserId, channelId }`, one per
  Walmart channel.
- **Report:** `POST /v2/snapshot/report` `{ advertiserId, reportType: "adItem", reportMetrics:
  [date, campaignId, campaignName, adGroupId, itemId, itemName, adSpend, numAdsShown,
  numAdsClicks, attributedSales14days, attributedOrders14days, attributedUnits14days], startDate,
  endDate }` (with `date` among the metrics, one row per day: only for the trailing 30 days).
  Poll `GET /v1/snapshot?advertiserId=&snapshotId=` until `jobStatus` is `done`; download
  `details` (gzipped or zipped JSON or CSV). Stored as `sponsored_products`, `attribution_window`
  `14d`; v1 snapshot reports were retired in 2026.
- **Items to SKUs:** Walmart names items by its item ID (`listing_ref`). Each new one is looked
  up once in the Marketplace catalog (`POST /v3/items/catalog/search`, field `itemId`, with the
  country's seller key) and kept on `channel_skus.asin`, so `replaceAdMetrics` finds the SKU like
  an ASIN; an item the catalog doesn't know stays tied to no product, and the toast says how
  many. A stock refresh (WFS) keeps the listing ID it doesn't send.
- **When:** like Amazon's: the daily job asks for the last 15 days (30 the first time), the
  5-minute job collects; "Bring in ads now" waits up to ~45 seconds.
- Built from Walmart's published API before a live account was seen: the field names and base
  URL are the ones to check first.
