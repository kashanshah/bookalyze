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
 * Dr the chosen account / Cr Inventory.
 */

export type StockRemovalRow = {
  id: string;
  lotId: string;
  removedOn: string;
  quantity: number;
  cost: string;
  accountId: string;
  accountName: string;
  notes: string | null;
  journalEntryId: string | null;
};

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
  // The lot's cost of one; the last units take what's left, so the lot adds up exactly.
  const total = parseDecimal(lot.productCost) + parseDecimal(lot.landedCost);
  const cost = roundUnits(
    input.quantity === left
      ? total - parseDecimal(used?.cost ?? "0")
      : divRound(total * BigInt(input.quantity), BigInt(lot.quantity)),
    Math.min(minorUnits(input.baseCurrency), AMOUNT_SCALE),
  );
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

/** Puts the units back into their lot and reverses the entry. */
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
  if (removal.journalEntryId) {
    await reverseJournalEntry(tx, {
      orgId: input.orgId,
      userId: input.userId,
      entryId: removal.journalEntryId,
      date: removal.removedOn,
    });
  }
  // Its lot_consumptions row goes with it (cascade).
  await tx.delete(stockRemovals).where(eq(stockRemovals.id, removal.id));
}

/** What was taken out of these lots by hand, oldest first. */
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
      notes: stockRemovals.notes,
      journalEntryId: stockRemovals.journalEntryId,
    })
    .from(stockRemovals)
    .innerJoin(accounts, eq(accounts.id, stockRemovals.accountId))
    .where(and(inArray(stockRemovals.lotId, lotIds)))
    .orderBy(asc(stockRemovals.removedOn), asc(stockRemovals.createdAt));
}
