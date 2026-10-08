import {
  AMOUNT_SCALE,
  DEFAULT_CHART,
  divRound,
  type FifoLot,
  formatDecimal,
  type LedgerAccount,
  minorUnits,
  monthBounds,
  ORDER_STATUS_GROUPS,
  parseDecimal,
  prepareJournalEntry,
  roundUnits,
  type SystemAccountKey,
  takeFifo,
} from "@bookalyze/core";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { postJournalEntry, reverseJournalEntry } from "./ledger";
import { accounts } from "./schema/accounting";
import { salesChannels } from "./schema/commerce";
import { cogsPeriods, inventoryLots, lotConsumptions, products } from "./schema/inventory";

/**
 * Cost of goods sold and opening stock (phase 5, slice 4). Run inside `withOrg()`.
 *
 * Each month, per marketplace: the units shipped that month (order lines × units per listing of
 * the linked SKU, cancelled orders left out, by purchase date in the company's time zone) are
 * taken from the oldest lots received by the month's end, and posted as Dr Cost of goods sold /
 * Cr Inventory on the month's last day. Months post in order, and only the latest can be undone,
 * so FIFO stays true. Opening stock is a lot posted Dr Inventory / Cr Opening balance equity.
 */

export class CogsError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "state" | "invalid" = "invalid",
  ) {
    super(message);
  }
}

const cancelled = sql.raw(ORDER_STATUS_GROUPS.cancelled.map((s) => `'${s}'`).join(", "));

type InventoryKey = Extract<
  SystemAccountKey,
  "inventory" | "cost_of_goods_sold" | "opening_balance_equity" | "inventory_write_offs"
>;

/**
 * The account behind a system key. Companies set up before these keys existed get their
 * template account of that kind adopted (Inventory, Cost of goods sold), or a new one.
 */
export async function ensureSystemAccount(
  tx: Transaction,
  orgId: string,
  key: InventoryKey,
): Promise<string> {
  const [found] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.systemKey, key));
  if (found) return found.id;
  const template = DEFAULT_CHART.find((a) => a.systemKey === key);
  if (!template) throw new Error(`No template account for ${key}`);
  // Opening balance equity shares its subtype with share capital, and write-offs theirs with
  // cost of goods sold, so those are never adopted.
  if (key === "inventory" || key === "cost_of_goods_sold") {
    const [adopt] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.type, template.type),
          eq(accounts.subtype, template.subtype),
          eq(accounts.isArchived, false),
          sql`${accounts.systemKey} is null`,
        ),
      )
      .orderBy(asc(accounts.createdAt))
      .limit(1);
    if (adopt) {
      await tx.update(accounts).set({ systemKey: key }).where(eq(accounts.id, adopt.id));
      return adopt.id;
    }
  }
  const [codeTaken] = template.code
    ? await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, template.code))
    : [];
  const [row] = await tx
    .insert(accounts)
    .values({
      organizationId: orgId,
      code: codeTaken ? null : (template.code ?? null),
      name: template.name,
      type: template.type,
      subtype: template.subtype,
      description: template.description ?? null,
      systemKey: key,
    })
    .returning({ id: accounts.id });
  if (!row) throw new Error("The account couldn't be created");
  return row.id;
}

/** Posts an entry in the main currency from signed amounts per account (+ debit, − credit). */
async function postLines(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    baseCurrency: string;
    date: string;
    memo: string;
    source: "cogs" | "opening_stock";
    sourceId: string;
    lines: { accountId: string; amount: bigint }[];
  },
): Promise<string | null> {
  const lines = input.lines.filter((l) => l.amount !== 0n);
  if (!lines.length) return null;
  const all = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
      isArchived: accounts.isArchived,
    })
    .from(accounts)
    .where(
      inArray(
        accounts.id,
        lines.map((l) => l.accountId),
      ),
    );
  const ledger = new Map<string, LedgerAccount>(all.map((a) => [a.id, a]));
  const prepared = prepareJournalEntry(
    {
      currency: input.baseCurrency,
      baseCurrency: input.baseCurrency,
      lines: lines.map((l) =>
        l.amount > 0n
          ? { accountId: l.accountId, description: input.memo, debit: formatDecimal(l.amount) }
          : { accountId: l.accountId, description: input.memo, credit: formatDecimal(-l.amount) },
      ),
    },
    ledger,
  );
  if (!prepared.ok) {
    const first =
      prepared.errors.form ??
      Object.values(prepared.errors.lines ?? {})[0] ??
      "It doesn't balance.";
    throw new CogsError(`This couldn't be posted: ${first}`);
  }
  const entry = await postJournalEntry(tx, {
    orgId: input.orgId,
    userId: input.userId,
    date: input.date,
    memo: input.memo,
    source: input.source,
    sourceId: input.sourceId,
    entry: prepared.entry,
  });
  return entry.id;
}

// ─── What sold, came back, or went missing ────────────────────────────────────

export type MonthSales = {
  channelId: string;
  channelName: string;
  month: string;
  /** Product units shipped from linked SKUs. */
  units: number;
  /** Listing units shipped from SKUs not linked to a product (they can't be costed). */
  unlinkedUnits: number;
  unlinkedSkus: string[];
  /** From Amazon's inventory ledger, in listing units: customer returns, net adjustments. */
  returned: number;
  adjusted: number;
};

/** The month a ledger day or an order falls in, as SQL. */
const ledgerMonth = sql`to_char(e.event_date, 'YYYY-MM')`;

/** Units shipped (orders) and moved (ledger) per marketplace and month, newest first. */
export async function salesByMonth(
  tx: Transaction,
  options: { timezone: string },
): Promise<MonthSales[]> {
  const sold = await tx.execute<{
    channel_id: string;
    channel_name: string;
    month: string;
    units: number;
    unlinked_units: number;
    unlinked_skus: string[] | null;
  }>(sql`
    select o.channel_id, sc.name as channel_name,
      to_char(o.purchased_at at time zone ${options.timezone}, 'YYYY-MM') as month,
      coalesce(sum(oi.quantity_shipped * ps.units) filter (where ps.id is not null), 0)::int as units,
      coalesce(sum(oi.quantity_shipped) filter (where ps.id is null), 0)::int as unlinked_units,
      array_agg(distinct oi.sku) filter (where ps.id is null) as unlinked_skus
    from order_items oi
    join orders o on o.id = oi.order_id
    join sales_channels sc on sc.id = o.channel_id
    left join product_skus ps on ps.channel_id = o.channel_id and ps.sku = oi.sku
    where oi.quantity_shipped > 0 and o.status not in (${cancelled})
    group by o.channel_id, sc.name, 3`);
  const moved = await tx.execute<{
    channel_id: string;
    channel_name: string;
    month: string;
    returned: number;
    adjusted: number;
    unlinked_skus: string[] | null;
  }>(sql`
    select e.channel_id, sc.name as channel_name, ${ledgerMonth} as month,
      coalesce(sum(e.quantity) filter (where e.event_type = 'CustomerReturns' and e.quantity > 0), 0)::int as returned,
      coalesce(sum(e.quantity) filter (where e.event_type = 'Adjustments'), 0)::int as adjusted,
      array_agg(distinct e.sku) filter (where ps.id is null) as unlinked_skus
    from inventory_ledger_events e
    join sales_channels sc on sc.id = e.channel_id
    left join product_skus ps on ps.channel_id = e.channel_id and ps.sku = e.sku
    where e.event_type in ('CustomerReturns', 'Adjustments')
    group by e.channel_id, sc.name, 3`);
  const map = new Map<string, MonthSales>();
  const entry = (channelId: string, channelName: string, month: string) => {
    const key = `${channelId}:${month}`;
    let m = map.get(key);
    if (!m) {
      m = {
        channelId,
        channelName,
        month,
        units: 0,
        unlinkedUnits: 0,
        unlinkedSkus: [],
        returned: 0,
        adjusted: 0,
      };
      map.set(key, m);
    }
    return m;
  };
  for (const r of sold.rows) {
    const m = entry(r.channel_id, r.channel_name, r.month);
    m.units = Number(r.units);
    m.unlinkedUnits = Number(r.unlinked_units);
    m.unlinkedSkus.push(...(r.unlinked_skus ?? []).filter(Boolean));
  }
  for (const r of moved.rows) {
    const m = entry(r.channel_id, r.channel_name, r.month);
    m.returned = Number(r.returned);
    m.adjusted = Number(r.adjusted);
    // An unlinked SKU only matters to the ledger if it moved stock that month.
    if (m.returned || m.adjusted) m.unlinkedSkus.push(...(r.unlinked_skus ?? []).filter(Boolean));
  }
  return [...map.values()]
    .filter((m) => m.units || m.unlinkedUnits || m.returned || m.adjusted)
    .map((m) => ({ ...m, unlinkedSkus: [...new Set(m.unlinkedSkus)].sort() }))
    .sort((a, b) =>
      a.month === b.month ? a.channelName.localeCompare(b.channelName) : a.month < b.month ? 1 : -1,
    );
}

/** Product units shipped on one marketplace in one month. */
async function unitsByProduct(
  tx: Transaction,
  input: { channelId: string; month: string; timezone: string },
): Promise<Map<string, number>> {
  const rows = await tx.execute<{ product_id: string; units: number }>(sql`
    select ps.product_id, sum(oi.quantity_shipped * ps.units)::int as units
    from order_items oi
    join orders o on o.id = oi.order_id
    join product_skus ps on ps.channel_id = o.channel_id and ps.sku = oi.sku
    where o.channel_id = ${input.channelId}
      and oi.quantity_shipped > 0 and o.status not in (${cancelled})
      and to_char(o.purchased_at at time zone ${input.timezone}, 'YYYY-MM') = ${input.month}
    group by ps.product_id`);
  return new Map(rows.rows.map((r) => [r.product_id, Number(r.units)]));
}

/** Product units customers returned, and net adjustments, on one marketplace in one month. */
async function ledgerByProduct(
  tx: Transaction,
  input: { channelId: string; month: string },
): Promise<Map<string, { returned: number; adjusted: number }>> {
  const rows = await tx.execute<{ product_id: string; returned: number; adjusted: number }>(sql`
    select ps.product_id,
      coalesce(sum(e.quantity * ps.units) filter (where e.event_type = 'CustomerReturns' and e.quantity > 0), 0)::int as returned,
      coalesce(sum(e.quantity * ps.units) filter (where e.event_type = 'Adjustments'), 0)::int as adjusted
    from inventory_ledger_events e
    join product_skus ps on ps.channel_id = e.channel_id and ps.sku = e.sku
    where e.channel_id = ${input.channelId}
      and e.event_type in ('CustomerReturns', 'Adjustments')
      and ${ledgerMonth} = ${input.month}
    group by ps.product_id`);
  return new Map(
    rows.rows.map((r) => [
      r.product_id,
      { returned: Number(r.returned), adjusted: Number(r.adjusted) },
    ]),
  );
}

// ─── Lots as they stand ───────────────────────────────────────────────────────

/** Lots of these products received by `through`, with what earlier months already took. */
async function availableLots(
  tx: Transaction,
  productIds: string[],
  through: string,
): Promise<Map<string, FifoLot[]>> {
  if (!productIds.length) return new Map();
  const rows = await tx
    .select({
      id: inventoryLots.id,
      productId: inventoryLots.productId,
      receivedOn: inventoryLots.receivedOn,
      quantity: inventoryLots.quantity,
      productCost: inventoryLots.productCost,
      landedCost: inventoryLots.landedCost,
      consumed: sql<number>`coalesce((select sum(c.quantity) from lot_consumptions c where c.lot_id = "inventory_lots"."id"), 0)::int`,
    })
    .from(inventoryLots)
    .where(
      and(inArray(inventoryLots.productId, productIds), lte(inventoryLots.receivedOn, through)),
    )
    .orderBy(asc(inventoryLots.receivedOn), asc(inventoryLots.createdAt));
  const map = new Map<string, FifoLot[]>();
  for (const r of rows) {
    const total = formatDecimal(parseDecimal(r.productCost) + parseDecimal(r.landedCost));
    const list = map.get(r.productId) ?? [];
    list.push({
      id: r.id,
      receivedOn: r.receivedOn,
      quantity: r.quantity,
      consumed: Number(r.consumed),
      totalCost: total,
    });
    map.set(r.productId, list);
  }
  return map;
}

/**
 * Cost of one for units coming back into stock (returns, found): this month's sales cost per
 * unit, else the product's most recent costed unit, else the average of its lots. Null when
 * the product has no cost at all yet.
 */
async function costOfOne(
  tx: Transaction,
  productId: string,
  lots: readonly FifoLot[],
  soldUnits: number,
  soldCost: bigint,
): Promise<bigint | null> {
  if (soldUnits > 0) return divRound(soldCost, BigInt(soldUnits));
  const [last] = await tx
    .select({ quantity: lotConsumptions.quantity, cost: lotConsumptions.cost })
    .from(lotConsumptions)
    .innerJoin(cogsPeriods, eq(cogsPeriods.id, lotConsumptions.cogsPeriodId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, lotConsumptions.lotId))
    .where(and(eq(inventoryLots.productId, productId), eq(lotConsumptions.kind, "sale")))
    .orderBy(desc(cogsPeriods.month), desc(lotConsumptions.id))
    .limit(1);
  if (last && last.quantity > 0) return divRound(parseDecimal(last.cost), BigInt(last.quantity));
  const units = lots.reduce((sum, l) => sum + l.quantity, 0);
  if (!units) return null;
  const total = lots.reduce((sum, l) => sum + parseDecimal(l.totalCost), 0n);
  return divRound(total, BigInt(units));
}

type Take = { lotId: string; quantity: number; cost: string };

export type CogsLine = {
  productId: string;
  productName: string;
  /** Shipped to customers, and what they cost at FIFO. */
  units: number;
  cost: string;
  /** Units no lot received by the month's end could cover (sales and losses). */
  short: number;
  takes: Take[];
  /** Returned by customers: back into stock at `returnedCost`. */
  returned: number;
  returnedCost: string;
  /** Net adjustments: lost, damaged or disposed (taken from lots), or found (back into stock). */
  lost: number;
  lostCost: string;
  writeOffs: Take[];
  found: number;
  foundCost: string;
};

export type CogsPreview = {
  channelId: string;
  month: string;
  lines: CogsLine[];
  units: number;
  cost: string;
  returned: number;
  returnedCost: string;
  lost: number;
  lostCost: string;
  found: number;
  foundCost: string;
  unlinkedSkus: string[];
  /** Amazon's inventory ledger is in through this day (null: never brought in). */
  ledgerThrough: string | null;
  /** Plain-language reasons it can't be posted yet; empty when it can. */
  problems: string[];
};

const roundTo = (units: bigint, currency: string) =>
  roundUnits(units, Math.min(minorUnits(currency), AMOUNT_SCALE));

/** What posting a marketplace's month would take from the lots, and what's in the way. */
export async function previewCogs(
  tx: Transaction,
  input: { channelId: string; month: string; timezone: string; baseCurrency: string },
): Promise<CogsPreview> {
  const currency = input.baseCurrency;
  const monthEnd = monthBounds(input.month).to;
  const [channel] = await tx
    .select({ ledgerThrough: salesChannels.ledgerSyncedThrough })
    .from(salesChannels)
    .where(eq(salesChannels.id, input.channelId));
  const ledgerThrough = channel?.ledgerThrough ?? null;
  const sold = await unitsByProduct(tx, input);
  const moved = ledgerThrough ? await ledgerByProduct(tx, input) : new Map();
  const ids = [...new Set([...sold.keys(), ...moved.keys()])];
  const names = ids.length
    ? new Map(
        (
          await tx
            .select({ id: products.id, name: products.name })
            .from(products)
            .where(inArray(products.id, ids))
        ).map((p) => [p.id, p.name]),
      )
    : new Map<string, string>();
  const lotsByProduct = await availableLots(tx, ids, monthEnd);
  const problems: string[] = [];
  const lines: CogsLine[] = [];
  for (const productId of ids) {
    const name = names.get(productId) ?? "A product";
    const lots = lotsByProduct.get(productId) ?? [];
    const units = sold.get(productId) ?? 0;
    const sales = takeFifo(lots, units, currency);
    // Losses come out of what's left after this month's sales.
    const after = lots.map((lot) => ({
      ...lot,
      consumed:
        lot.consumed +
        sales.takes.filter((t) => t.lotId === lot.id).reduce((s, t) => s + t.quantity, 0),
    }));
    const change = moved.get(productId) ?? { returned: 0, adjusted: 0 };
    const lost = Math.max(0, -change.adjusted);
    const found = Math.max(0, change.adjusted);
    const losses = takeFifo(after, lost, currency);
    let returnedCost = 0n;
    let foundCost = 0n;
    if (change.returned || found) {
      const one = await costOfOne(
        tx,
        productId,
        lots,
        units - sales.short,
        parseDecimal(sales.cost),
      );
      if (one === null) {
        problems.push(
          `${name}: units came back, but there's no cost for it yet. Add opening stock or record a delivery.`,
        );
      } else {
        returnedCost = roundTo(one * BigInt(change.returned), currency);
        foundCost = roundTo(one * BigInt(found), currency);
      }
    }
    lines.push({
      productId,
      productName: name,
      units,
      cost: sales.cost,
      short: sales.short + losses.short,
      takes: sales.takes,
      returned: change.returned,
      returnedCost: formatDecimal(returnedCost),
      lost,
      lostCost: losses.cost,
      writeOffs: losses.takes,
      found,
      foundCost: formatDecimal(foundCost),
    });
  }
  lines.sort((a, b) => a.productName.localeCompare(b.productName));
  const month = (await salesByMonth(tx, { timezone: input.timezone })).find(
    (m) => m.channelId === input.channelId && m.month === input.month,
  );
  const unlinkedSkus = month?.unlinkedSkus ?? [];
  if (ledgerThrough && ledgerThrough < monthEnd) {
    problems.unshift(
      `Amazon's inventory ledger is in through ${ledgerThrough}. Bring it in through ${monthEnd} first (Inventory → Stock movements), so returns and losses are counted.`,
    );
  }
  if (unlinkedSkus.length) {
    problems.unshift(
      `${unlinkedSkus.length === 1 ? "1 SKU" : `${unlinkedSkus.length} SKUs`} sold or moved this month ${unlinkedSkus.length === 1 ? "isn't" : "aren't"} linked to a product: ${unlinkedSkus.slice(0, 5).join(", ")}${unlinkedSkus.length > 5 ? "…" : ""}. Link ${unlinkedSkus.length === 1 ? "it" : "them"} under Products.`,
    );
  }
  for (const line of lines.filter((l) => l.short > 0)) {
    problems.push(
      `${line.productName}: ${line.units + line.lost} went out, but only ${line.units + line.lost - line.short} were in stock lots by the month's end. Add opening stock or record the delivery.`,
    );
  }
  const sum = (pick: (l: CogsLine) => string) =>
    formatDecimal(lines.reduce((s, l) => s + parseDecimal(pick(l)), 0n));
  const count = (pick: (l: CogsLine) => number) => lines.reduce((s, l) => s + pick(l), 0);
  return {
    channelId: input.channelId,
    month: input.month,
    lines,
    units: count((l) => l.units),
    cost: sum((l) => l.cost),
    returned: count((l) => l.returned),
    returnedCost: sum((l) => l.returnedCost),
    lost: count((l) => l.lost),
    lostCost: sum((l) => l.lostCost),
    found: count((l) => l.found),
    foundCost: sum((l) => l.foundCost),
    unlinkedSkus,
    ledgerThrough,
    problems,
  };
}

// ─── Posting ──────────────────────────────────────────────────────────────────

export type CogsPeriodRow = typeof cogsPeriods.$inferSelect;

export async function listCogsPeriods(tx: Transaction): Promise<CogsPeriodRow[]> {
  return tx.select().from(cogsPeriods).orderBy(asc(cogsPeriods.month));
}

const MONTH_NAME = (month: string) =>
  new Date(`${month}-15T00:00:00Z`).toLocaleDateString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Posts a marketplace's month: sales and losses leave the lots, returns and found units come
 * back as lots, and one entry books it (cost of goods sold net of returns, write-offs net of
 * units found, inventory the other way).
 */
export async function postCogs(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    channelId: string;
    month: string;
    timezone: string;
    baseCurrency: string;
    /** The current month in the company's time zone: only months before it can post. */
    currentMonth: string;
  },
): Promise<{ id: string; units: number; cost: string }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cogs:${input.orgId}`}))`);
  if (input.month >= input.currentMonth) {
    throw new CogsError("A month posts once it's over.", "state");
  }
  const [channel] = await tx
    .select({ name: salesChannels.name })
    .from(salesChannels)
    .where(eq(salesChannels.id, input.channelId));
  if (!channel) throw new CogsError("This marketplace no longer exists.", "not_found");
  const posted = await listCogsPeriods(tx);
  if (posted.some((p) => p.channelId === input.channelId && p.month === input.month)) {
    throw new CogsError("This month is already in the books.", "state");
  }
  // Months go in order, so the oldest stock is always used first.
  const done = new Set(posted.map((p) => `${p.channelId}:${p.month}`));
  const earlier = (await salesByMonth(tx, { timezone: input.timezone }))
    .filter((m) => m.month < input.month && !done.has(`${m.channelId}:${m.month}`))
    .sort((a, b) => (a.month < b.month ? -1 : 1))[0];
  if (earlier) {
    throw new CogsError(
      `Post ${MONTH_NAME(earlier.month)} on ${earlier.channelName} first: months go in order.`,
      "state",
    );
  }
  const later = posted.find((p) => p.month > input.month);
  if (later) {
    throw new CogsError(
      `${MONTH_NAME(later.month)} is already posted. Undo it first to post an earlier month.`,
      "state",
    );
  }
  const preview = await previewCogs(tx, input);
  if (preview.problems.length) throw new CogsError(preview.problems[0] ?? "", "invalid");
  if (!preview.units && !preview.returned && !preview.lost && !preview.found) {
    throw new CogsError("Nothing shipped or moved on this marketplace that month.");
  }

  const [period] = await tx
    .insert(cogsPeriods)
    .values({
      organizationId: input.orgId,
      channelId: input.channelId,
      month: input.month,
      units: preview.units,
      cost: preview.cost,
      returnedUnits: preview.returned,
      returnedCost: preview.returnedCost,
      lostUnits: preview.lost,
      lostCost: preview.lostCost,
      foundUnits: preview.found,
      foundCost: preview.foundCost,
      currency: input.baseCurrency,
      createdBy: input.userId,
    })
    .returning({ id: cogsPeriods.id });
  if (!period) throw new CogsError("The month couldn't be saved.");
  const consumptions = preview.lines.flatMap((line) => [
    ...line.takes.map((t) => ({ ...t, kind: "sale" as const })),
    ...line.writeOffs.map((t) => ({ ...t, kind: "write_off" as const })),
  ]);
  if (consumptions.length) {
    await tx.insert(lotConsumptions).values(
      consumptions.map((take) => ({
        organizationId: input.orgId,
        cogsPeriodId: period.id,
        lotId: take.lotId,
        kind: take.kind,
        quantity: take.quantity,
        cost: take.cost,
      })),
    );
  }
  const monthEnd = monthBounds(input.month).to;
  const backIn = preview.lines.flatMap((line) => [
    ...(line.returned
      ? [
          {
            productId: line.productId,
            source: "return" as const,
            quantity: line.returned,
            cost: line.returnedCost,
          },
        ]
      : []),
    ...(line.found
      ? [
          {
            productId: line.productId,
            source: "found" as const,
            quantity: line.found,
            cost: line.foundCost,
          },
        ]
      : []),
  ]);
  if (backIn.length) {
    await tx.insert(inventoryLots).values(
      backIn.map((lot) => ({
        organizationId: input.orgId,
        productId: lot.productId,
        source: lot.source,
        cogsPeriodId: period.id,
        receivedOn: monthEnd,
        quantity: lot.quantity,
        currency: input.baseCurrency,
        productCost: lot.cost,
        landedCost: "0",
        notes: lot.source === "return" ? "Returned by customers" : "Found by Amazon",
      })),
    );
  }
  const p = (v: string) => parseDecimal(v);
  const cogs = p(preview.cost) - p(preview.returnedCost);
  const writeOffs = p(preview.lostCost) - p(preview.foundCost);
  const accountsNeeded = {
    cogs: await ensureSystemAccount(tx, input.orgId, "cost_of_goods_sold"),
    inventory: await ensureSystemAccount(tx, input.orgId, "inventory"),
    writeOffs:
      writeOffs !== 0n ? await ensureSystemAccount(tx, input.orgId, "inventory_write_offs") : null,
  };
  const entryId = await postLines(tx, {
    orgId: input.orgId,
    userId: input.userId,
    baseCurrency: input.baseCurrency,
    date: monthEnd,
    memo: `Cost of goods sold · ${channel.name} · ${MONTH_NAME(input.month)}`,
    source: "cogs",
    sourceId: period.id,
    lines: [
      { accountId: accountsNeeded.cogs, amount: cogs },
      ...(accountsNeeded.writeOffs
        ? [{ accountId: accountsNeeded.writeOffs, amount: writeOffs }]
        : []),
      { accountId: accountsNeeded.inventory, amount: -(cogs + writeOffs) },
    ],
  });
  if (entryId) {
    await tx
      .update(cogsPeriods)
      .set({ journalEntryId: entryId })
      .where(eq(cogsPeriods.id, period.id));
  }
  return { id: period.id, units: preview.units, cost: preview.cost };
}

/** Undoes the latest posted month: reverses its entry and gives its units back to the lots. */
export async function undoCogs(
  tx: Transaction,
  input: { orgId: string; userId: string | null; periodId: string },
): Promise<{ month: string; channelId: string }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cogs:${input.orgId}`}))`);
  const [period] = await tx.select().from(cogsPeriods).where(eq(cogsPeriods.id, input.periodId));
  if (!period) throw new CogsError("This month is no longer posted.", "not_found");
  const [later] = await tx
    .select({ month: cogsPeriods.month })
    .from(cogsPeriods)
    .where(gt(cogsPeriods.month, period.month))
    .limit(1);
  if (later) {
    throw new CogsError(
      `Undo ${MONTH_NAME(later.month)} first: months are undone newest first.`,
      "state",
    );
  }
  if (period.journalEntryId) {
    await reverseJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      entryId: period.journalEntryId,
      date: monthBounds(period.month).to,
    });
  }
  await tx.delete(cogsPeriods).where(eq(cogsPeriods.id, period.id));
  return { month: period.month, channelId: period.channelId };
}

// ─── Opening stock ────────────────────────────────────────────────────────────

/** Stock on hand before Bookalyze: a lot, posted Dr Inventory / Cr Opening balance equity. */
export async function addOpeningStock(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    productId: string;
    quantity: number;
    /** Cost of one, in the main currency. */
    unitCost: string;
    date: string;
    notes: string | null;
    baseCurrency: string;
  },
): Promise<{ id: string; total: string }> {
  const [product] = await tx
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) throw new CogsError("This product no longer exists.", "not_found");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new CogsError("Enter how many you had.");
  }
  const posted = await tx
    .select({ month: cogsPeriods.month })
    .from(cogsPeriods)
    .where(sql`${cogsPeriods.month} >= ${input.date.slice(0, 7)}`)
    .limit(1);
  if (posted.length) {
    throw new CogsError(
      "Cost of goods sold is already posted for that month or later. Use a date after it, or undo those months first.",
      "state",
    );
  }
  const total = formatDecimal(
    roundUnits(
      parseDecimal(input.unitCost) * BigInt(input.quantity),
      Math.min(minorUnits(input.baseCurrency), AMOUNT_SCALE),
    ),
  );
  const [lot] = await tx
    .insert(inventoryLots)
    .values({
      organizationId: input.orgId,
      productId: input.productId,
      source: "opening",
      receivedOn: input.date,
      quantity: input.quantity,
      currency: input.baseCurrency,
      productCost: total,
      landedCost: "0",
      notes: input.notes,
    })
    .returning({ id: inventoryLots.id });
  if (!lot) throw new CogsError("The opening stock couldn't be saved.");
  if (parseDecimal(total) > 0n) {
    const entryId = await postLines(tx, {
      orgId: input.orgId,
      userId: input.userId,
      baseCurrency: input.baseCurrency,
      date: input.date,
      memo: `Opening stock · ${product.name} × ${input.quantity}`,
      source: "opening_stock",
      sourceId: lot.id,
      lines: [
        {
          accountId: await ensureSystemAccount(tx, input.orgId, "inventory"),
          amount: parseDecimal(total),
        },
        {
          accountId: await ensureSystemAccount(tx, input.orgId, "opening_balance_equity"),
          amount: -parseDecimal(total),
        },
      ],
    });
    await tx
      .update(inventoryLots)
      .set({ journalEntryId: entryId })
      .where(eq(inventoryLots.id, lot.id));
  }
  return { id: lot.id, total };
}

/** Removes an opening lot nothing has been taken from, reversing its entry. */
export async function removeOpeningStock(
  tx: Transaction,
  input: { orgId: string; userId: string | null; lotId: string },
): Promise<void> {
  const [lot] = await tx
    .select()
    .from(inventoryLots)
    .where(eq(inventoryLots.id, input.lotId))
    .for("update");
  if (lot?.source !== "opening") {
    throw new CogsError("This opening stock no longer exists.", "not_found");
  }
  const [used] = await tx
    .select({ id: lotConsumptions.id })
    .from(lotConsumptions)
    .where(eq(lotConsumptions.lotId, lot.id))
    .limit(1);
  if (used) {
    throw new CogsError(
      "Some of this stock is already in cost of goods sold. Undo those months first.",
      "state",
    );
  }
  if (lot.journalEntryId) {
    await reverseJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      entryId: lot.journalEntryId,
      date: lot.receivedOn,
    });
  }
  await tx.delete(inventoryLots).where(eq(inventoryLots.id, lot.id));
}

/** Whether any of these lots already went into cost of goods sold (their cost is then fixed). */
export async function lotsConsumed(tx: Transaction, lotIds: string[]): Promise<string | null> {
  if (!lotIds.length) return null;
  const [row] = await tx
    .select({ month: cogsPeriods.month })
    .from(lotConsumptions)
    .innerJoin(cogsPeriods, eq(cogsPeriods.id, lotConsumptions.cogsPeriodId))
    .where(inArray(lotConsumptions.lotId, lotIds))
    .orderBy(asc(cogsPeriods.month))
    .limit(1);
  return row ? MONTH_NAME(row.month) : null;
}
