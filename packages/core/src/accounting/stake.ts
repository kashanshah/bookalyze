import { formatDecimal, parseDecimal } from "../money";
import type { AccountBalance } from "./reports";

/**
 * Your stake: the owner's view of the company. What you put in (owner contributions), what you
 * took out (drawings, dividends: anything that went from the company to you), and what the
 * company is worth on a day (what it owns less what it owes). Worth less what you put in, net,
 * is every year's profit added up: the same story as the profit and loss, told in money in and
 * money out.
 *
 * Each owner equity account counts one way, by its balance on the day: a credit balance is money
 * put in, a debit balance money taken out. So a contribution entered and then removed nets to
 * nothing instead of counting both ways. An account at zero counts each year by that year's sign.
 */

export type StakeYear = {
  label: string;
  from: string;
  to: string;
  putIn: string;
  tookOut: string;
  /** Put in less taken out. */
  net: string;
  /** Income less expenses (negative: a loss). */
  profit: string;
};

export type StakeGroup = { key: string; label: string; amount: string };

export type Stake = {
  years: StakeYear[];
  putIn: string;
  tookOut: string;
  net: string;
  /** Profit before the first year here (retained earnings brought in from elsewhere). */
  earlierProfit: string;
  /** Every year's profit, plus earlier profit. */
  profit: string;
  /** What the company owns, by kind, and what it owes (negative). */
  worth: StakeGroup[];
  worthTotal: string;
  /** Worth less net put in: up (+) or down (−) overall. */
  upOrDown: string;
  /** Worth equals net put in plus profit (always, unless the books don't balance). */
  balanced: boolean;
};

const WORTH_GROUPS: { key: string; label: string; subtypes: string[] }[] = [
  { key: "cash", label: "Cash in the bank", subtypes: ["cash_bank"] },
  { key: "stock", label: "Stock, at what it cost", subtypes: ["inventory"] },
  {
    key: "coming",
    label: "Money on its way to you",
    subtypes: ["money_in_transit", "accounts_receivable", "vendor_prepayments"],
  },
];

const isOwner = (b: AccountBalance) => b.type === "equity" && b.subtype !== "retained_earnings";
const isProfit = (b: AccountBalance) => b.type === "income" || b.type === "expense";

export function yourStake(input: {
  /** Balances of every account up to the day (all time). */
  asOf: AccountBalance[];
  /** Each year's activity (balances from its first to its last day). */
  years: { label: string; from: string; to: string; balances: AccountBalance[] }[];
}): Stake {
  const direction = new Map<string, "in" | "out" | null>();
  for (const b of input.asOf.filter(isOwner)) {
    const v = parseDecimal(b.balance);
    direction.set(b.accountId, v < 0n ? "in" : v > 0n ? "out" : null);
  }
  let putIn = 0n;
  let tookOut = 0n;
  let yearsProfit = 0n;
  const years = input.years.map((y): StakeYear => {
    let inY = 0n;
    let outY = 0n;
    let profitY = 0n;
    for (const b of y.balances) {
      const v = parseDecimal(b.balance);
      if (isProfit(b)) profitY -= v;
      if (!isOwner(b) || v === 0n) continue;
      const way = direction.get(b.accountId) ?? (v < 0n ? "in" : "out");
      if (way === "in") inY -= v;
      else outY += v;
    }
    putIn += inY;
    tookOut += outY;
    yearsProfit += profitY;
    return {
      label: y.label,
      from: y.from,
      to: y.to,
      putIn: formatDecimal(inY),
      tookOut: formatDecimal(outY),
      net: formatDecimal(inY - outY),
      profit: formatDecimal(profitY),
    };
  });

  // Profit before these years: what the retained earnings account holds on the day, plus any
  // profit the years here don't cover.
  const allProfit = input.asOf.filter(isProfit).reduce((t, b) => t - parseDecimal(b.balance), 0n);
  const retained = input.asOf
    .filter((b) => b.type === "equity" && b.subtype === "retained_earnings")
    .reduce((t, b) => t - parseDecimal(b.balance), 0n);
  const earlierProfit = retained + (allProfit - yearsProfit);
  const profit = yearsProfit + earlierProfit;

  const worth: StakeGroup[] = [];
  let other = 0n;
  let owes = 0n;
  const groups = new Map(WORTH_GROUPS.map((g) => [g.key, 0n]));
  for (const b of input.asOf) {
    const v = parseDecimal(b.balance);
    if (b.type === "asset") {
      const g = WORTH_GROUPS.find((x) => x.subtypes.includes(b.subtype));
      if (g) groups.set(g.key, (groups.get(g.key) ?? 0n) + v);
      else other += v;
    } else if (b.type === "liability") {
      owes += v;
    }
  }
  for (const g of WORTH_GROUPS) {
    const v = groups.get(g.key) ?? 0n;
    if (v !== 0n) worth.push({ key: g.key, label: g.label, amount: formatDecimal(v) });
  }
  if (other !== 0n)
    worth.push({ key: "other", label: "Everything else it owns", amount: formatDecimal(other) });
  if (owes !== 0n)
    worth.push({ key: "owes", label: "Less what it owes", amount: formatDecimal(owes) });
  const worthTotal = [...groups.values()].reduce((t, v) => t + v, 0n) + other + owes;
  const net = putIn - tookOut;
  return {
    years,
    putIn: formatDecimal(putIn),
    tookOut: formatDecimal(tookOut),
    net: formatDecimal(net),
    earlierProfit: formatDecimal(earlierProfit),
    profit: formatDecimal(profit),
    worth,
    worthTotal: formatDecimal(worthTotal),
    upOrDown: formatDecimal(worthTotal - net),
    balanced: worthTotal === net + profit,
  };
}
