import { ArrowRight, Building2, Check, Landmark } from "lucide-react";
import { cn } from "@/lib/site";

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

function Pill({ tone, children }: { tone: "success" | "primary" | "muted"; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-[11px]",
        tone === "success" && "bg-success/12 text-success",
        tone === "primary" && "bg-accent text-accent-foreground",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {tone === "success" ? <Check className="size-3" /> : null}
      {children}
    </span>
  );
}

const PAYOUTS = [
  { channel: "Amazon.com", period: "Oct 1 – Oct 15", amount: "$10,480.20", matched: true },
  { channel: "eBay US", period: "September", amount: "$3,915.64", matched: true },
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
              <span className="px-2.5 py-1 text-muted-foreground">eBay</span>
              <span className="px-2.5 py-1 text-muted-foreground">Noon</span>
            </div>
          </div>
          <ul className="divide-y rounded-xl border">
            {PAYOUTS.map((p) => (
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
                    <Pill tone="success">Matched</Pill>
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
        className="fade-in-0 slide-in-from-bottom-3 absolute start-4 -bottom-14 hidden w-72 animate-in rounded-xl border bg-popover fill-mode-both p-4 shadow-xl delay-500 duration-700 sm:block lg:-start-10"
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
      <div className="grid gap-4 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs">Amazon.com · Oct 1 – Oct 15</p>
            <p className="font-semibold">Settlement</p>
          </div>
          <Pill tone="success">Posted</Pill>
        </div>
        <dl className="grid gap-2 text-sm">
          {SETTLEMENT.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between gap-4 border-t pt-3 font-semibold">
            <dt>Paid to your bank</dt>
            <dd className="tabular-nums">$10,480.20</dd>
          </div>
        </dl>
      </div>
    </Frame>
  );
}

const PROFIT = [
  ["Net sales", "$48,210", "$11,904", "$29,733"],
  ["Marketplace fees", "−$13,402", "−$1,710", "−$6,904"],
  ["Cost of goods sold", "−$16,880", "−$4,212", "−$10,118"],
  ["Your own costs", "−$2,150", "−$310", "−$1,240"],
] as const;

/** Channel profit: each marketplace's sales down to profit. */
export function ProfitPreview() {
  return (
    <Frame>
      <div className="grid gap-4 p-4 sm:p-6">
        <div>
          <p className="text-muted-foreground text-xs">Commerce · This quarter</p>
          <p className="font-semibold">Channel profit</p>
        </div>
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs">
              <tr>
                <th className="px-3 py-2 text-start font-medium" />
                <th className="px-3 py-2 text-end font-medium">Amazon</th>
                <th className="px-3 py-2 text-end font-medium">eBay</th>
                <th className="px-3 py-2 text-end font-medium">Noon</th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {PROFIT.map(([label, ...cells]) => (
                <tr key={label}>
                  <td className="px-3 py-2 text-muted-foreground">{label}</td>
                  {cells.map((c, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns
                    <td key={i} className="px-3 py-2 text-end">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-3 py-2">Profit</td>
                <td className="px-3 py-2 text-end text-success">$15,778</td>
                <td className="px-3 py-2 text-end text-success">$5,672</td>
                <td className="px-3 py-2 text-end text-success">$11,471</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Frame>
  );
}

const REORDER = [
  { name: "Bamboo cutting board", status: "Order now", tone: "destructive", qty: "480" },
  { name: "Steel water bottle", status: "Order soon", tone: "warning", qty: "240" },
  { name: "Linen tea towels (3)", status: "Enough stock", tone: "success", qty: "—" },
] as const;

/** Inventory → Reorder: when each product runs out and how many to order. */
export function ReorderPreview() {
  return (
    <Frame>
      <div className="grid gap-4 p-4 sm:p-6">
        <div>
          <p className="text-muted-foreground text-xs">Inventory</p>
          <p className="font-semibold">Reorder</p>
        </div>
        <ul className="divide-y rounded-xl border">
          {REORDER.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-sm">{r.name}</p>
                <span
                  className={cn(
                    "mt-1 inline-flex rounded-full px-2 py-0.5 font-medium text-[11px]",
                    r.tone === "destructive" && "bg-destructive/12 text-destructive",
                    r.tone === "warning" && "bg-warning/15 text-foreground",
                    r.tone === "success" && "bg-success/12 text-success",
                  )}
                >
                  {r.status}
                </span>
              </div>
              <div className="text-end">
                <p className="text-muted-foreground text-xs">Order</p>
                <p className="font-semibold tabular-nums">{r.qty}</p>
              </div>
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

/** The company switcher: every company with its own country, currency and channels. */
export function CompaniesPreview() {
  return (
    <div aria-hidden="true" className="grid select-none gap-3">
      {COMPANIES.map((c, i) => (
        <div
          key={c.name}
          className={cn(
            "flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs",
            i === 0 && "ring-2 ring-primary/40",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent font-semibold text-accent-foreground text-sm">
            {c.initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{c.name}</p>
            <p className="truncate text-muted-foreground text-xs">{c.detail}</p>
          </div>
          {i === 0 ? (
            <Check className="size-4 text-primary" />
          ) : (
            <ArrowRight className="size-4 text-muted-foreground rtl:rotate-180" />
          )}
        </div>
      ))}
      <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
        <Building2 className="size-4" />
        Add a company
      </div>
    </div>
  );
}
