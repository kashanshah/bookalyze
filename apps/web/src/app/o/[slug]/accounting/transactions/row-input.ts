import type { TransactionFormInput } from "@/lib/validation/accounting";
import type { TxRow } from "./types";

/** One change made on the list itself, without opening the transaction. */
export type RowPatch = {
  date?: string;
  memo?: string;
  amount?: string;
  moneyAccountId?: string;
  categoryId?: string;
};

/** Trims "125.5000" to "125.50"-style input values. */
export function toInput(amount: string): string {
  return amount.replace(/(\.\d\d\d*?)0+$/, "$1").replace(/\.00$/, "");
}

const trimRate = (rate: string) => (rate.includes(".") ? rate.replace(/\.?0+$/, "") : rate);

/**
 * The full save input for a listed transaction with `patch` applied, exactly as the edit dialog
 * would send it unchanged. Saving replaces the entry with a corrected one, like any edit.
 */
export function rowInput(row: TxRow, baseCurrency: string, patch: RowPatch): TransactionFormInput {
  const common = {
    id: row.id,
    kind: row.kind,
    date: patch.date ?? row.date,
    memo: patch.memo ?? row.memo ?? "",
  };
  if (row.kind === "transfer") {
    const crossCurrency = Boolean(row.receivedCurrency && row.receivedCurrency !== row.currency);
    const needsRate = crossCurrency
      ? row.currency !== baseCurrency && row.receivedCurrency !== baseCurrency
      : row.currency !== baseCurrency;
    return {
      ...common,
      fromAccountId: row.fromAccountId,
      toAccountId: row.toAccountId,
      amount: patch.amount ?? row.amount,
      received: crossCurrency ? row.receivedAmount : undefined,
      fxRate: needsRate ? trimRate(row.fxRate) : undefined,
      contactId: "",
    };
  }
  const splits = row.splits.map((s, i) => ({
    accountId: i === 0 && patch.categoryId ? patch.categoryId : s.accountId,
    amount: i === 0 && patch.amount ? patch.amount : s.amount,
    description: s.description ?? "",
    taxRateId: s.taxRateId ?? "",
  }));
  return {
    ...common,
    moneyAccountId:
      patch.moneyAccountId ?? (row.needsAccount ? "" : (row.moneyAccountIds[0] ?? "")),
    splits,
    fxRate: row.currency !== baseCurrency ? trimRate(row.fxRate) : undefined,
    contactId: row.contactId ?? "",
  };
}
