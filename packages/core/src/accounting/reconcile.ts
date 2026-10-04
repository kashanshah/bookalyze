import { formatDecimal, parseDecimal } from "../money";
import { type AccountType, accountTypes } from "./accounts";

/**
 * Reconciling an account against a statement. Balances read the way the statement shows them:
 * a bank account's balance is what's in it (debits up), a credit card's is what's owed (credits
 * up). Line amounts are signed ledger amounts (debits positive) in the account's currency.
 */

/** A ledger amount in the account's natural direction (what its statement would show). */
export function naturalAmount(type: AccountType, amount: string): string {
  const units = parseDecimal(amount);
  return formatDecimal(accountTypes[type].normalBalance === "debit" ? units : -units);
}

export type ReconciliationTotals = {
  /** Balance cleared by earlier reconciliations: the last statement's ending balance. */
  opening: string;
  /** Net of lines ticked in this reconciliation. */
  clearedChange: string;
  clearedBalance: string;
  statementBalance: string;
  /** Statement minus cleared. Zero means the account agrees with the statement. */
  difference: string;
  balanced: boolean;
};

export function reconciliationTotals(input: {
  type: AccountType;
  /** Ledger amounts of every line cleared by earlier, completed reconciliations. */
  previouslyCleared: readonly string[];
  /** Ledger amounts of the lines ticked in this one. */
  cleared: readonly string[];
  /** As the statement shows it. */
  statementBalance: string;
}): ReconciliationTotals {
  const natural = (amounts: readonly string[]) =>
    amounts.reduce((sum, a) => sum + parseDecimal(naturalAmount(input.type, a)), 0n);
  const opening = natural(input.previouslyCleared);
  const change = natural(input.cleared);
  const statement = parseDecimal(input.statementBalance);
  const difference = statement - (opening + change);
  return {
    opening: formatDecimal(opening),
    clearedChange: formatDecimal(change),
    clearedBalance: formatDecimal(opening + change),
    statementBalance: formatDecimal(statement),
    difference: formatDecimal(difference),
    balanced: difference === 0n,
  };
}
