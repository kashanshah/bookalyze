import { Checklist } from "./section";

/** What each marketplace connection does: where it works, how it connects, and what comes in. */
export const MARKETPLACES = [
  {
    name: "Amazon",
    where: "Seller Central in North America, Europe, the Middle East and the Far East",
    connect: "Connect your own Selling Partner API app. Bookalyze walks you through each step.",
    brings: [
      "Orders, refunds, fees and every settlement",
      "Each settlement posted as one clean entry",
      "Each payout matched to its bank deposit",
      "FBA inventory: returns back into stock, losses written off",
      "Review requests, automatic or hundreds at once",
      "Listing watch and prices with fees and profit",
    ],
  },
  {
    name: "eBay",
    where: "United States, Canada, UK, Australia, Germany, France, Italy and Spain",
    connect: "Connect in one click on eBay's own page. Access is read-only.",
    brings: [
      "Orders, ready for cost of goods sold",
      "Fees, refunds and payouts, month by month",
      "Each site's month posted as one entry",
      "Each payout matched to its bank deposit",
      "Or upload Seller Hub's transaction report",
    ],
  },
  {
    name: "Noon",
    where: "UAE, Saudi Arabia and Egypt, fulfilled by Noon or by you",
    connect: "Connect with a key file from Noon's partner portal. Bookalyze shows you how.",
    brings: [
      "Every transaction, row by row, a year back",
      "Each country's month posted as one entry",
      "Each payout matched to its bank deposit",
      "FBN stock: returns and losses, checked day by day",
      "Every report Noon offers, each with a check",
    ],
  },
] as const;

export function MarketplaceCards() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {MARKETPLACES.map((m) => (
        <article
          key={m.name}
          className="flex flex-col gap-5 rounded-2xl border bg-card p-6 shadow-xs sm:p-7"
        >
          <div className="grid gap-1.5">
            <h3 className="font-semibold text-2xl tracking-tight">{m.name}</h3>
            <p className="text-muted-foreground text-sm leading-6">{m.where}</p>
          </div>
          <Checklist items={m.brings} />
          <p className="mt-auto rounded-xl bg-accent px-4 py-3 text-accent-foreground text-sm leading-6">
            {m.connect}
          </p>
        </article>
      ))}
    </div>
  );
}
