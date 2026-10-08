import {
  AMOUNT_SCALE,
  DEFAULT_CHART,
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
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
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
  "inventory" | "cost_of_goods_sold" | "opening_balance_equity"
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
  // Opening balance equity shares its subtype with share capital, so it's never adopted.
  if (key !== "opening_balance_equity") {
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

/** Posts a two-line entry in the main currency (debit one account, credit the other). */
async function postPair(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    baseCurrency: string;
    date: string;
    memo: string;
    source: "cogs" | "opening_stock";
    sourceId: string;
    debit: string;
    credit: string;
    amount: string;
  },
): Promise<string> {
  const all = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
      isArchived: accounts.isArchived,
    })
    .from(accounts)
    .where(inArray(accounts.id, [input.debit, input.credit]));
  const ledger = new Map<string, LedgerAccount>(all.map((a) => [a.id, a]));
  const prepared = prepareJournalEntry(
    {
      currency: input.baseCurrency,
      baseCurrency: input.baseCurrency,
      lines: [
        { accountId: input.debit, description: input.memo, debit: input.amount },
        { accountId: input.credit, description: input.memo, credit: input.amount },
      ],
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

// ─── What sold ────────────────────────────────────────────────────────────────

export type MonthSales = {
  channelId: string;
  channelName: string;
  month: string;
  /** Product units shipped from linked SKUs. */
  units: number;
  /** Listing units shipped from SKUs not linked to a product (they can't be costed). */
  unlinkedUnits: number;
  unlinkedSkus: string[];
};

/** Units shipped per marketplace and month, newest first. */
export async function salesByMonth(
  tx: Transaction,
  options: { timezone: string },
): Promise<MonthSales[]> {
  const rows = await tx.execute<{
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
    group by o.channel_id, sc.name, 3
    order by 3 desc, sc.name`);
  return rows.rows.map((r) => ({
    channelId: r.channel_id,
    channelName: r.channel_name,
    month: r.month,
    units: Number(r.units),
    unlinkedUnits: Number(r.unlinked_units),
    unlinkedSkus: (r.unlinked_skus ?? []).filter(Boolean).sort(),
  }));
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

export type CogsLine = {
  productId: string;
  productName: string;
  units: number;
  cost: string;
  /** Units no lot received by the month's end could cover. */
  short: number;
  takes: { lotId: string; quantity: number; cost: string }[];
};

export type CogsPreview = {
  channelId: string;
  month: string;
  lines: CogsLine[];
  units: number;
  cost: string;
  unlinkedSkus: string[];
  /** Plain-language reasons it can't be posted yet; empty when it can. */
  problems: string[];
};

/** What posting a marketplace's month would take from the lots, and what's in the way. */
export async function previewCogs(
  tx: Transaction,
  input: { channelId: string; month: string; timezone: string; baseCurrency: string },
): Promise<CogsPreview> {
  const sold = await unitsByProduct(tx, input);
  const ids = [...sold.keys()];
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
  const lots = await availableLots(tx, ids, monthBounds(input.month).to);
  const lines: CogsLine[] = ids
    .map((productId) => {
      const units = sold.get(productId) ?? 0;
      const taken = takeFifo(lots.get(productId) ?? [], units, input.baseCurrency);
      return {
        productId,
        productName: names.get(productId) ?? "A product",
        units,
        cost: taken.cost,
        short: taken.short,
        takes: taken.takes,
      };
    })
    .sort((a, b) => a.productName.localeCompare(b.productName));
  const month = (await salesByMonth(tx, { timezone: input.timezone })).find(
    (m) => m.channelId === input.channelId && m.month === input.month,
  );
  const problems: string[] = [];
  const unlinkedSkus = month?.unlinkedSkus ?? [];
  if (unlinkedSkus.length) {
    problems.push(
      `${unlinkedSkus.length === 1 ? "1 SKU sold" : `${unlinkedSkus.length} SKUs sold`} this month ${unlinkedSkus.length === 1 ? "isn't" : "aren't"} linked to a product: ${unlinkedSkus.slice(0, 5).join(", ")}${unlinkedSkus.length > 5 ? "…" : ""}. Link ${unlinkedSkus.length === 1 ? "it" : "them"} under Products.`,
    );
  }
  for (const line of lines.filter((l) => l.short > 0)) {
    problems.push(
      `${line.productName}: ${line.units} sold, but only ${line.units - line.short} in stock lots by the month's end. Add opening stock or record the delivery.`,
    );
  }
  const cost = lines.reduce((sum, l) => sum + parseDecimal(l.cost), 0n);
  return {
    channelId: input.channelId,
    month: input.month,
    lines,
    units: lines.reduce((sum, l) => sum + l.units, 0),
    cost: formatDecimal(cost),
    unlinkedSkus,
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

/** Posts a marketplace's month: takes the units from the lots and books the cost. */
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
  if (!preview.units) throw new CogsError("Nothing shipped on this marketplace that month.");

  const [period] = await tx
    .insert(cogsPeriods)
    .values({
      organizationId: input.orgId,
      channelId: input.channelId,
      month: input.month,
      units: preview.units,
      cost: preview.cost,
      currency: input.baseCurrency,
      createdBy: input.userId,
    })
    .returning({ id: cogsPeriods.id });
  if (!period) throw new CogsError("The month couldn't be saved.");
  const takes = preview.lines.flatMap((line) => line.takes);
  if (takes.length) {
    await tx.insert(lotConsumptions).values(
      takes.map((take) => ({
        organizationId: input.orgId,
        cogsPeriodId: period.id,
        lotId: take.lotId,
        quantity: take.quantity,
        cost: take.cost,
      })),
    );
  }
  if (parseDecimal(preview.cost) > 0n) {
    const entryId = await postPair(tx, {
      orgId: input.orgId,
      userId: input.userId,
      baseCurrency: input.baseCurrency,
      date: monthBounds(input.month).to,
      memo: `Cost of goods sold · ${channel.name} · ${MONTH_NAME(input.month)}`,
      source: "cogs",
      sourceId: period.id,
      debit: await ensureSystemAccount(tx, input.orgId, "cost_of_goods_sold"),
      credit: await ensureSystemAccount(tx, input.orgId, "inventory"),
      amount: preview.cost,
    });
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
    const entryId = await postPair(tx, {
      orgId: input.orgId,
      userId: input.userId,
      baseCurrency: input.baseCurrency,
      date: input.date,
      memo: `Opening stock · ${product.name} × ${input.quantity}`,
      source: "opening_stock",
      sourceId: lot.id,
      debit: await ensureSystemAccount(tx, input.orgId, "inventory"),
      credit: await ensureSystemAccount(tx, input.orgId, "opening_balance_equity"),
      amount: total,
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
