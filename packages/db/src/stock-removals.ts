import {
  AMOUNT_SCALE,
  divRound,
  formatDecimal,
  isMoneyAccountSubtype,
  minorUnits,
  parseDecimal,
  roundUnits,
} from "@bookalyze/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./client";
import { CogsError, ensureSystemAccount, postLines } from "./cogs";
import { reverseJournalEntry } from "./ledger";
import { accounts } from "./schema/accounting";
import { inventoryLots, lotConsumptions, products, stockRemovals } from "./schema/inventory";

/**
 * Units taken out of a stock lot by hand (phase 5): sold or used outside the marketplaces, taken
 * by the owner, lost or thrown away. Run inside `withOrg()`. The units leave the lot through a
 * `lot_consumptions` row (kind "removal"), so everything that counts what's left counts them;
 * the cost (the lot's own, in cents, the last units taking what's left) posts on the day:
 * Dr the chosen account / Cr Inventory. Or moved to another product: a new lot there at the same
 * cost, nothing posted.
 */

export type StockRemovalRow = {
  id: string;
  lotId: string;
  removedOn: string;
  quantity: number;
  cost: string;
  /** Where the cost went; null for a move. */
  accountId: string | null;
  accountName: string | null;
  /** A move: the product the units went to. */
  movedToProductName: string | null;
  notes: string | null;
  journalEntryId: string | null;
};

/** Locks a lot and works out what taking `quantity` units from it costs (the lot's own cost). */
async function takeFromLot(
  tx: Transaction,
  input: { lotId: string; quantity: number; date: string; baseCurrency: string },
) {
  const [lot] = await tx
    .select()
    .from(inventoryLots)
    .where(eq(inventoryLots.id, input.lotId))
    .for("update");
  if (!lot) throw new CogsError("This stock lot no longer exists.", "not_found");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new CogsError("Enter how many units to take out.");
  }
  if (input.date < lot.receivedOn) {
    throw new CogsError("Use a day on or after the lot arrived.");
  }
  const [used] = await tx
    .select({
      units: sql<number>`coalesce(sum(${lotConsumptions.quantity}), 0)::int`,
      cost: sql<string>`coalesce(sum(${lotConsumptions.cost}), 0)::text`,
    })
    .from(lotConsumptions)
    .where(eq(lotConsumptions.lotId, lot.id));
  const left = lot.quantity - Number(used?.units ?? 0);
  if (input.quantity > left) {
    throw new CogsError(
      left > 0
        ? `Only ${left} ${left === 1 ? "unit is" : "units are"} left in this lot.`
        : "Nothing is left in this lot.",
    );
  }
  // The lot's cost of one; the last units take what's left, so the lot adds up exactly.
  const total = parseDecimal(lot.productCost) + parseDecimal(lot.landedCost);
  const cost = roundUnits(
    input.quantity === left
      ? total - parseDecimal(used?.cost ?? "0")
      : divRound(total * BigInt(input.quantity), BigInt(lot.quantity)),
    Math.min(minorUnits(input.baseCurrency), AMOUNT_SCALE),
  );
  return { lot, cost };
}

/** Takes units out of a lot, at its cost, against an account. */
export async function takeOutOfStock(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    lotId: string;
    quantity: number;
    date: string;
    accountId: string;
    notes: string | null;
    baseCurrency: string;
  },
): Promise<{ id: string; cost: string }> {
  const { lot, cost } = await takeFromLot(tx, input);
  const [account] = await tx
    .select({ id: accounts.id, subtype: accounts.subtype, isArchived: accounts.isArchived })
    .from(accounts)
    .where(eq(accounts.id, input.accountId));
  const inventory = await ensureSystemAccount(tx, input.orgId, "inventory");
  if (
    !account ||
    account.isArchived ||
    account.id === inventory ||
    isMoneyAccountSubtype(account.subtype)
  ) {
    throw new CogsError(
      "Choose where its cost goes: Owner drawings, a write-off, or another category.",
    );
  }
  const [product] = await tx
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, lot.productId));
  const [removal] = await tx
    .insert(stockRemovals)
    .values({
      organizationId: input.orgId,
      lotId: lot.id,
      removedOn: input.date,
      quantity: input.quantity,
      cost: formatDecimal(cost),
      accountId: account.id,
      notes: input.notes,
      createdBy: input.userId,
    })
    .returning({ id: stockRemovals.id });
  if (!removal) throw new CogsError("This couldn't be saved.");
  await tx.insert(lotConsumptions).values({
    organizationId: input.orgId,
    lotId: lot.id,
    removalId: removal.id,
    kind: "removal",
    quantity: input.quantity,
    cost: formatDecimal(cost),
  });
  const entryId = await postLines(tx, {
    orgId: input.orgId,
    userId: input.userId,
    baseCurrency: input.baseCurrency,
    date: input.date,
    memo: `Taken out of stock · ${product?.name ?? "A product"} × ${input.quantity}${input.notes ? ` · ${input.notes}` : ""}`,
    source: "stock_removal",
    sourceId: removal.id,
    lines: [
      { accountId: account.id, amount: cost },
      { accountId: inventory, amount: -cost },
    ],
  });
  if (entryId) {
    await tx
      .update(stockRemovals)
      .set({ journalEntryId: entryId })
      .where(eq(stockRemovals.id, removal.id));
  }
  return { id: removal.id, cost: formatDecimal(cost) };
}

/**
 * Moves units from a lot to another product (they were that product all along: a label or a
 * listing mixed up): they leave this lot and make a new one there, on the day, at the same cost.
 * Inventory stays Inventory, so nothing posts.
 */
export async function moveStock(
  tx: Transaction,
  input: {
    orgId: string;
    userId: string | null;
    lotId: string;
    quantity: number;
    date: string;
    productId: string;
    notes: string | null;
    baseCurrency: string;
  },
): Promise<{ id: string; lotId: string; cost: string }> {
  const { lot, cost } = await takeFromLot(tx, input);
  if (input.productId === lot.productId) {
    throw new CogsError("Choose another product: these units are this one already.");
  }
  const named = await tx
    .select({ id: products.id, name: products.name, isArchived: products.isArchived })
    .from(products)
    .where(inArray(products.id, [lot.productId, input.productId]));
  const from = named.find((p) => p.id === lot.productId);
  const to = named.find((p) => p.id === input.productId);
  if (!to || to.isArchived) throw new CogsError("Choose the product they really are.");
  const [moved] = await tx
    .insert(inventoryLots)
    .values({
      organizationId: input.orgId,
      productId: to.id,
      source: "moved",
      receivedOn: input.date,
      quantity: input.quantity,
      currency: lot.currency,
      productCost: formatDecimal(cost),
      landedCost: "0",
      notes:
        `From ${from?.name ?? "another product"}${input.notes ? ` · ${input.notes}` : ""}`.slice(
          0,
          500,
        ),
    })
    .returning({ id: inventoryLots.id });
  if (!moved) throw new CogsError("This couldn't be saved.");
  const [removal] = await tx
    .insert(stockRemovals)
    .values({
      organizationId: input.orgId,
      lotId: lot.id,
      removedOn: input.date,
      quantity: input.quantity,
      cost: formatDecimal(cost),
      movedToLotId: moved.id,
      notes: input.notes,
      createdBy: input.userId,
    })
    .returning({ id: stockRemovals.id });
  if (!removal) throw new CogsError("This couldn't be saved.");
  await tx.insert(lotConsumptions).values({
    organizationId: input.orgId,
    lotId: lot.id,
    removalId: removal.id,
    kind: "removal",
    quantity: input.quantity,
    cost: formatDecimal(cost),
  });
  return { id: removal.id, lotId: moved.id, cost: formatDecimal(cost) };
}

/** Puts the units back into their lot: reverses the entry, or removes a move's new lot. */
export async function putBackInStock(
  tx: Transaction,
  input: { orgId: string; userId: string | null; removalId: string },
): Promise<void> {
  const [removal] = await tx
    .select()
    .from(stockRemovals)
    .where(eq(stockRemovals.id, input.removalId))
    .for("update");
  if (!removal) throw new CogsError("This was already put back.", "not_found");
  if (removal.movedToLotId) {
    const [used] = await tx
      .select({ id: lotConsumptions.id })
      .from(lotConsumptions)
      .where(eq(lotConsumptions.lotId, removal.movedToLotId))
      .limit(1);
    if (used) {
      throw new CogsError(
        "Some of the units moved are already sold or taken out. Undo those first.",
        "state",
      );
    }
  }
  if (removal.journalEntryId) {
    await reverseJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      entryId: removal.journalEntryId,
      date: removal.removedOn,
    });
  }
  // Its lot_consumptions row goes with it (cascade); a move's new lot goes after it.
  await tx.delete(stockRemovals).where(eq(stockRemovals.id, removal.id));
  if (removal.movedToLotId) {
    await tx.delete(inventoryLots).where(eq(inventoryLots.id, removal.movedToLotId));
  }
}

/** What was taken out of these lots by hand, or moved to another product, oldest first. */
export async function stockRemovalsFor(
  tx: Transaction,
  lotIds: string[],
): Promise<StockRemovalRow[]> {
  if (!lotIds.length) return [];
  return tx
    .select({
      id: stockRemovals.id,
      lotId: stockRemovals.lotId,
      removedOn: stockRemovals.removedOn,
      quantity: stockRemovals.quantity,
      cost: stockRemovals.cost,
      accountId: stockRemovals.accountId,
      accountName: accounts.name,
      movedToProductName: products.name,
      notes: stockRemovals.notes,
      journalEntryId: stockRemovals.journalEntryId,
    })
    .from(stockRemovals)
    .leftJoin(accounts, eq(accounts.id, stockRemovals.accountId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, stockRemovals.movedToLotId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(inArray(stockRemovals.lotId, lotIds)))
    .orderBy(asc(stockRemovals.removedOn), asc(stockRemovals.createdAt));
}
