import "server-only";
import { currencies } from "@bookalyze/core/reference-data";
import { listProducts, supplierOptions, type Transaction } from "@bookalyze/db";

/** What the purchase order form needs: vendors, active products, currencies (main one first). */
export async function formOptions(tx: Transaction, baseCurrency: string) {
  const [suppliers, products] = [await supplierOptions(tx), await listProducts(tx)];
  return {
    suppliers,
    products: products
      .filter((p) => !p.isArchived)
      .map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
    currencies: [
      ...currencies.filter((c) => c.code === baseCurrency),
      ...currencies.filter((c) => c.code !== baseCurrency),
    ].map((c) => ({ code: c.code, name: c.name })),
  };
}
