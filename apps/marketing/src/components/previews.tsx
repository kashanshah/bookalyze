import { ArrowRight, Building2, Check, FileText, Landmark, RefreshCw, Send } from "lucide-react";
import { cn } from "@/lib/site";
import { InView } from "./in-view";

/*
 * Illustrations of the app, drawn with the same tokens so they follow light and dark mode. The
 * companies and amounts are made up. They're decorative: screen readers skip them.
 */

function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "select-none overflow-hidden rounded-2xl border bg-card text-start shadow-2xl shadow-primary/10",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b bg-sidebar px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="ms-3 truncate rounded-md bg-background px-2.5 py-0.5 text-muted-foreground text-xs">
          app.bookalyze.com
        </span>
      </div>
      {children}
    </div>
  );
}

/** CSS custom properties for the animations' timing. */
export function timing(delay: number, loop?: number): React.CSSProperties {
  return {
    "--delay": `${delay}s`,
    ...(loop ? { "--loop": `${loop}s` } : {}),
  } as React.CSSProperties;
}

/**
 * Two states in one place, looping: `before`, then `after` (the finished state, which is what
 * shows with reduced motion).
 */
function Swap({
  before,
  after,
  delay,
  loop,
  className,
}: {
  before: React.ReactNode;
  after: React.ReactNode;
  delay: number;
  loop?: number;
  className?: string;
}) {
  return (
    <span className={cn("grid [&>*]:col-start-1 [&>*]:row-start-1", className)}>
      <span className="anim-swap-out" style={timing(delay, loop)}>
        {before}
      </span>
      <span className="anim-swap-in" style={timing(delay, loop)}>
        {after}
      </span>
    </span>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "success" | "primary" | "muted" | "warning";
  children: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-[11px]",
        tone === "success" && "bg-success/12 text-success",
        tone === "primary" && "bg-accent text-accent-foreground",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "warning" && "bg-warning/15 text-foreground",
      )}
    >
      {tone === "success" ? <Check className="size-3" /> : null}
      {children}
    </span>
  );
}

const PAYOUTS = [
  { channel: "Amazon.com", period: "Oct 1 – Oct 15", amount: "$10,480.20", matched: true },
  { channel: "Walmart US", period: "Sep 30 – Oct 13", amount: "$6,128.95", matched: true },
  { channel: "Noon UAE", period: "September", amount: "AED 18,206.00", matched: true },
  { channel: "Amazon.ca", period: "Sep 24 – Oct 8", amount: "CA$4,072.18", matched: false },
] as const;

/** The hero: marketplace payouts posted to the books and matched to bank deposits. */
export function PayoutsPreview() {
  return (
    <div className="relative">
      <Frame>
        <div className="grid gap-4 p-4 sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-muted-foreground text-xs">Commerce</p>
              <p className="font-semibold text-lg">Payouts</p>
            </div>
            <div className="hidden gap-1 rounded-lg bg-muted p-1 text-xs sm:flex">
              <span className="rounded-md bg-card px-2.5 py-1 font-medium shadow-xs">Amazon</span>
              <span className="px-2.5 py-1 text-muted-foreground">Walmart</span>
              <span className="px-2.5 py-1 text-muted-foreground">Noon</span>
              <span className="px-2.5 py-1 text-muted-foreground">eBay</span>
            </div>
          </div>
          <ul className="divide-y rounded-xl border">
            {PAYOUTS.map((p, i) => (
              <li
                key={p.channel}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{p.channel}</p>
                  <p className="text-muted-foreground text-xs">{p.period}</p>
                </div>
                <p className="text-end font-medium text-sm tabular-nums">{p.amount}</p>
                <div className="col-span-2 flex gap-1.5 sm:col-span-1 sm:justify-end">
                  <Pill tone="primary">Posted</Pill>
                  {p.matched ? (
                    <Swap
                      delay={0.6 + i * 0.9}
                      before={<Pill tone="muted">On its way</Pill>}
                      after={<Pill tone="success">Matched</Pill>}
                    />
                  ) : (
                    <Pill tone="muted">On its way</Pill>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Frame>
      <div
        aria-hidden="true"
        className="anim-swap-in absolute start-4 -bottom-14 hidden w-72 rounded-xl border bg-popover p-4 shadow-xl sm:block lg:-start-10"
        style={timing(0.7)}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-success/12 text-success">
            <Landmark className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-sm">Deposit matched</p>
            <p className="truncate text-muted-foreground text-xs">Business chequing · $10,480.20</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const SETTLEMENT = [
  ["Product sales", "$15,212.40"],
  ["Shipping credits", "$402.15"],
  ["Refunds", "−$618.30"],
  ["Selling fees", "−$2,281.86"],
  ["Fulfilment fees", "−$1,904.22"],
  ["Advertising", "−$329.97"],
] as const;

/** One settlement as it's posted: its lines, and the payout that reaches the bank. */
export function SettlementPreview() {
  return (
    <Frame>
      <InView className="grid gap-4 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Amazon.com · Oct 1 – Oct 15</p>
            <p className="font-semibold">Settlement</p>
          </div>
          <Pill tone="success">Posted</Pill>
        </div>
        <dl className="grid gap-2 text-sm">
          {SETTLEMENT.map(([label, value], i) => (
            <div
              key={label}
              className="on-view-rise flex justify-between gap-4"
              style={timing(0.1 + i * 0.12)}
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
          <div
            className="on-view-rise mt-1 flex justify-between gap-4 border-t pt-3 font-semibold"
            style={timing(0.9)}
          >
            <dt>Paid to your bank</dt>
            <dd className="tabular-nums">$10,480.20</dd>
          </div>
        </dl>
      </InView>
    </Frame>
  );
}

const WATERFALL = [
  { label: "Net sales", value: 48210, kind: "total" },
  { label: "Fees", value: -13402, kind: "down" },
  { label: "Cost of goods", value: -16880, kind: "down" },
  { label: "Your costs", value: -2150, kind: "down" },
  { label: "Profit", value: 15778, kind: "result" },
] as const;

/** Channel profit as a waterfall: from net sales, down through each cost, to profit. */
export function ProfitWaterfall() {
  const max = 54000; // headroom above the tallest bar for its label
  const money = (n: number) =>
    `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  let running = 0;
  const bars = WATERFALL.map((b) => {
    const top = b.kind === "down" ? running : b.value;
    const bottom = b.kind === "down" ? running + b.value : 0;
    if (b.kind !== "result") running = b.kind === "total" ? b.value : running + b.value;
    return { ...b, top, bottom };
  });
  return (
    <Frame>
      <InView className="grid gap-5 p-4 sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Commerce · Amazon.com · This quarter</p>
            <p className="font-semibold">Channel profit</p>
          </div>
          <p className="text-end">
            <span className="block text-muted-foreground text-xs">Margin</span>
            <span className="font-semibold text-success tabular-nums">32.7%</span>
          </p>
        </div>
        <div className="grid h-56 grid-cols-5 items-end gap-2 border-b sm:gap-4">
          {bars.map((b, i) => (
            <div key={b.label} className="relative h-full">
              <div
                className={cn(
                  "on-view-grow absolute inset-x-0 rounded-t-md",
                  b.kind === "total" && "bg-primary/80",
                  b.kind === "down" && "rounded-b-md bg-destructive/70",
                  b.kind === "result" && "bg-success",
                )}
                style={{
                  bottom: `${(b.bottom / max) * 100}%`,
                  height: `${((b.top - b.bottom) / max) * 100}%`,
                  ...timing(0.15 + i * 0.25),
                }}
              />
              <span
                className="on-view-rise absolute inset-x-0 text-center font-medium text-[11px] tabular-nums sm:text-xs"
                style={{ bottom: `calc(${(b.top / max) * 100}% + 4px)`, ...timing(0.5 + i * 0.25) }}
              >
                {money(b.value)}
              </span>
            </div>
          ))}
        </div>
        <div className="-mt-3 grid grid-cols-5 gap-2 text-center text-[11px] text-muted-foreground sm:gap-4 sm:text-xs">
          {bars.map((b) => (
            <span key={b.label}>{b.label}</span>
          ))}
        </div>
      </InView>
    </Frame>
  );
}

/** Inventory → Reorder: stock running down at the pace it sells, and when to order. */
export function ReorderChart() {
  // Stock over 60 days: 900 units, selling ~14 a day, ordered on day 34, landing on day 46.
  const points = [
    [0, 900],
    [6, 820],
    [12, 735],
    [18, 650],
    [24, 560],
    [30, 480],
    [36, 395],
    [42, 300],
    [46, 245],
    [46, 725],
    [52, 640],
    [60, 530],
  ] as const;
  const x = (d: number) => 16 + (d / 60) * 468;
  const y = (u: number) => 196 - (u / 1000) * 176;
  const line = points.map(([d, u], i) => `${i ? "L" : "M"}${x(d)} ${y(u)}`).join(" ");
  const area = `${line} L${x(60)} 196 L${x(0)} 196 Z`;
  return (
    <Frame>
      <InView className="grid gap-4 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Inventory · Reorder</p>
            <p className="font-semibold">Bamboo cutting board</p>
          </div>
          <Pill tone="warning">Order soon</Pill>
        </div>
        <svg viewBox="0 0 500 210" className="h-auto w-full" aria-hidden="true">
          <path d={area} className="on-view-rise fill-primary/10" style={timing(0.6)} />
          <line
            x1={16}
            x2={484}
            y1={y(420)}
            y2={y(420)}
            className="stroke-warning"
            strokeWidth={1.5}
            strokeDasharray="5 5"
          />
          <text
            x={480}
            y={y(420) - 6}
            textAnchor="end"
            className="fill-muted-foreground text-[11px]"
          >
            Reorder point
          </text>
          <path
            d={line}
            pathLength={1}
            fill="none"
            className="on-view-draw stroke-primary"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <g className="on-view-rise" style={timing(1.2)}>
            <line x1={x(34)} x2={x(34)} y1={y(420)} y2={196} className="stroke-foreground/30" />
            <circle cx={x(34)} cy={y(420)} r={5} className="fill-warning" />
            <text
              x={x(34) - 8}
              y={y(420) + 20}
              textAnchor="end"
              className="fill-foreground font-medium text-[12px]"
            >
              Order by Nov 12
            </text>
          </g>
          <g className="on-view-rise" style={timing(1.6)}>
            <circle cx={x(46)} cy={y(725)} r={5} className="fill-success" />
            <text x={x(46) + 8} y={y(725) - 8} className="fill-foreground font-medium text-[12px]">
              480 arrive
            </text>
          </g>
        </svg>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          {[
            ["Sells", "14 a day"],
            ["Lead time", "12 days"],
            ["Order", "480"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground text-xs">{k}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </InView>
    </Frame>
  );
}

const TRANSACTIONS = [
  { name: "Amazon.com payout", account: "Amazon balance", amount: "+$10,480.20" },
  { name: "Shopify Inc.", account: "Software", amount: "−$39.00" },
  { name: "FreightFast Logistics", account: "Freight in", amount: "−$1,212.40" },
  { name: "Transfer to USD account", account: "Transfer", amount: "−$2,000.00" },
] as const;

/** Accounting → Transactions: each line categorised and approved, one after another. */
export function TransactionsPreview() {
  return (
    <Frame>
      <div className="grid gap-4 p-4 sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Accounting</p>
            <p className="font-semibold">Transactions</p>
          </div>
          <span className="text-muted-foreground text-xs">Business chequing</span>
        </div>
        <ul className="divide-y rounded-xl border">
          {TRANSACTIONS.map((t, i) => (
            <li
              key={t.name}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3"
            >
              <p className="truncate font-medium text-sm">{t.name}</p>
              <p
                className={cn(
                  "text-end font-medium text-sm tabular-nums",
                  t.amount.startsWith("+") && "text-success",
                )}
              >
                {t.amount}
              </p>
              <span className="justify-self-start rounded-md bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                {t.account}
              </span>
              <Swap
                className="justify-items-end"
                delay={0.5 + i * 1.1}
                before={<Pill tone="warning">To review</Pill>}
                after={<Pill tone="success">Approved</Pill>}
              />
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

/** Banking: a marketplace payout finding its deposit in the bank. */
export function BankMatchPreview() {
  return (
    <Frame>
      <div className="grid gap-4 p-4 sm:p-6">
        <div>
          <p className="text-muted-foreground text-xs">Commerce · Settlements</p>
          <p className="font-semibold">Payout matched to its deposit</p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4">
          <div className="grid gap-1 rounded-xl border p-3 sm:p-4">
            <span className="text-muted-foreground text-xs">eBay US · September</span>
            <span className="font-semibold tabular-nums">$3,915.64</span>
            <span className="text-muted-foreground text-xs">Paid out Oct 2</span>
          </div>
          <Swap
            delay={0.4}
            loop={6}
            before={
              <span className="flex size-9 items-center justify-center rounded-full border border-dashed text-muted-foreground">
                <ArrowRight className="size-4 rtl:rotate-180" />
              </span>
            }
            after={
              <span className="flex size-9 items-center justify-center rounded-full bg-success text-background">
                <Check className="size-4" />
              </span>
            }
          />
          <div className="grid gap-1 rounded-xl border p-3 sm:p-4">
            <span className="text-muted-foreground text-xs">Business chequing</span>
            <span className="font-semibold tabular-nums">$3,915.64</span>
            <span className="text-muted-foreground text-xs">Deposited Oct 4</span>
          </div>
        </div>
        <Swap
          delay={0.4}
          loop={6}
          before={
            <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
              Looking for the deposit…
            </p>
          }
          after={
            <p className="rounded-lg bg-success/12 px-3 py-2 text-sm text-success">
              Matched: same amount, two days later
            </p>
          }
        />
      </div>
    </Frame>
  );
}

const LOTS = [
  { label: "Lot from March", cost: "$4.20 each", width: "100%", selling: true },
  { label: "Lot from June", cost: "$4.05 each", width: "85%", selling: false },
  { label: "Lot from August", cost: "$4.38 each", width: "60%", selling: false },
] as const;

/** Stock lots, first in first out: the oldest lot sells down first, at its own cost. */
export function LotsPreview() {
  return (
    <Frame>
      <div className="grid gap-4 p-4 sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Inventory · Stock lots</p>
            <p className="font-semibold">Steel water bottle</p>
          </div>
          <span className="text-muted-foreground text-xs">First in, first out</span>
        </div>
        <ul className="grid gap-3">
          {LOTS.map((l) => (
            <li key={l.label} className="grid gap-1.5">
              <div className="flex justify-between gap-3 text-sm">
                <span className="font-medium">{l.label}</span>
                <span className="text-muted-foreground tabular-nums">{l.cost}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    l.selling ? "anim-sell-down bg-primary" : "bg-primary/40",
                  )}
                  style={{ width: l.width }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="rounded-lg bg-accent px-3 py-2 text-accent-foreground text-sm">
          Each sale takes the oldest stock's cost, freight and duties included.
        </p>
      </div>
    </Frame>
  );
}

const REVIEWS = [
  { order: "113-2045871-0034521", date: "Delivered Oct 9" },
  { order: "113-8812004-5523190", date: "Delivered Oct 10" },
  { order: "113-0049312-7781045", date: "Delivered Oct 11" },
  { order: "113-6620183-1189022", date: "Delivered Oct 12" },
] as const;

/** Review requests: Amazon's own request, sent order after order. */
export function ReviewsPreview() {
  return (
    <Frame>
      <div className="grid gap-4 p-4 sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Review requests</p>
            <p className="font-semibold">Automatic requests</p>
          </div>
          <span className="inline-flex items-center gap-2 text-muted-foreground text-xs">
            <span className="relative flex size-2">
              <span className="anim-ping absolute inline-flex size-full rounded-full bg-success" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            On, every day
          </span>
        </div>
        <ul className="divide-y rounded-xl border">
          {REVIEWS.map((r, i) => (
            <li key={r.order} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">{r.order}</p>
                <p className="text-muted-foreground text-xs">{r.date}</p>
              </div>
              <Swap
                className="justify-items-end"
                delay={0.5 + i * 0.9}
                before={<Pill tone="muted">Waiting</Pill>}
                after={<Pill tone="success">Requested</Pill>}
              />
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

const COMPANIES = [
  { initials: "NT", name: "Northwind Trading Inc.", detail: "Canada · CAD · Amazon, eBay" },
  { initials: "NG", name: "Northwind Gulf FZ-LLC", detail: "UAE · AED · Amazon.ae, Noon" },
  { initials: "LS", name: "Lakeside Studio", detail: "Canada · CAD · Accounting only" },
] as const;

/** The company switcher, moving from one company to the next. */
export function CompaniesPreview() {
  return (
    <div aria-hidden="true" className="grid select-none gap-3">
      {COMPANIES.map((c, i) => (
        <div
          key={c.name}
          className="relative flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs"
        >
          <span
            className="anim-spotlight pointer-events-none absolute -inset-px rounded-xl ring-2 ring-primary/50"
            style={timing(i * 2.4, 7.2)}
          />
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent font-semibold text-accent-foreground text-sm">
            {c.initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{c.name}</p>
            <p className="truncate text-muted-foreground text-xs">{c.detail}</p>
          </div>
          <ArrowRight className="size-4 text-muted-foreground rtl:rotate-180" />
        </div>
      ))}
      <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
        <Building2 className="size-4" />
        Add a company
      </div>
    </div>
  );
}

const WISE_BALANCES = [
  { currency: "CAD", amount: "CA$12,480.55" },
  { currency: "USD", amount: "$8,215.10" },
  { currency: "AED", amount: "AED 31,904.00" },
] as const;

const WISE_LINES = [
  { name: "Amazon.ca payout", amount: "+CA$4,072.18", rule: "Matched to settlement" },
  { name: "Ningbo Ceramics", amount: "−$1,250.00", rule: "Supplier deposits" },
  { name: "Shopify", amount: "−$39.00", rule: "Rule: Software" },
] as const;

/** Banking → Wise: balances in each currency, and the day's lines arriving and sorting themselves. */
export function WisePreview() {
  return (
    <Frame>
      <div className="grid gap-4 p-4 sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Banking · Bank accounts</p>
            <p className="font-semibold">Wise</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
            <RefreshCw className="size-3" />
            Synced this morning
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {WISE_BALANCES.map((b) => (
            <div key={b.currency} className="grid gap-0.5 rounded-xl border p-3">
              <span className="text-muted-foreground text-xs">{b.currency}</span>
              <span className="truncate font-semibold text-sm tabular-nums">{b.amount}</span>
            </div>
          ))}
        </div>
        <ul className="divide-y rounded-xl border">
          {WISE_LINES.map((l, i) => (
            <li
              key={l.name}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3"
            >
              <p className="truncate font-medium text-sm">{l.name}</p>
              <p
                className={cn(
                  "text-end font-medium text-sm tabular-nums",
                  l.amount.startsWith("+") && "text-success",
                )}
              >
                {l.amount}
              </p>
              <Swap
                className="col-span-2 justify-items-start"
                delay={0.5 + i * 1}
                before={<Pill tone="warning">New from Wise</Pill>}
                after={<Pill tone="success">{l.rule}</Pill>}
              />
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

/** Commerce → an order: Create invoice, the bilingual PDF, then sent to the buyer through Amazon. */
export function InvoicePreview() {
  return (
    <Frame>
      <div className="grid gap-4 p-4 sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Commerce · Orders · Amazon.ae</p>
            <p className="font-mono font-semibold text-sm">406-2281943-7710326</p>
          </div>
          <Swap
            className="justify-items-end"
            delay={0.6}
            loop={7}
            before={
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs">
                <FileText className="size-3.5" />
                Create invoice
              </span>
            }
            after={
              <span className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium text-xs">
                <Send className="size-3.5" />
                Send to Amazon
              </span>
            }
          />
        </div>
        <div className="grid gap-3 rounded-xl border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-sm">Tax invoice</p>
              <p className="text-muted-foreground text-xs" dir="rtl" lang="ar">
                فاتورة ضريبية
              </p>
            </div>
            <p className="text-end text-muted-foreground text-xs">
              INV-0142
              <span className="block">Northwind Gulf FZ-LLC</span>
            </p>
          </div>
          <div className="grid gap-1.5 border-t pt-3 text-xs">
            <p className="flex justify-between gap-3">
              <span className="truncate">Glass coffee mugs, set of 4 × 2</span>
              <span className="tabular-nums">AED 158.00</span>
            </p>
            <p className="flex justify-between gap-3 text-muted-foreground">
              <span>VAT 5%</span>
              <span className="tabular-nums">AED 7.90</span>
            </p>
            <p className="flex justify-between gap-3 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">AED 165.90</span>
            </p>
          </div>
        </div>
        <Swap
          delay={2.2}
          loop={7}
          before={
            <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
              Buyer asked for an invoice
            </p>
          }
          after={
            <p className="rounded-lg bg-success/12 px-3 py-2 text-sm text-success">
              Sent to the buyer through Amazon
            </p>
          }
        />
      </div>
    </Frame>
  );
}
