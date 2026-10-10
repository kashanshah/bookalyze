import type { PdfTextItem } from "../banking/pdf-statement";
import { formatDecimal, parseDecimal } from "../money";
import { getCurrency } from "../reference-data";
import { purchaseLineTotal, purchaseOrderTotal, unitCostFromTotal } from "./purchasing";

/**
 * Alibaba.com order receipts (the PDF "Receipt" from an order's page) read into a draft purchase
 * order: the seller, order number and date, each item with its quantity and price, and the
 * shipping fee, payment fee and contract currency for the notes. The PDF is read in the browser
 * from pdf.js's positioned text; nothing is saved until someone checks the form and saves it.
 */

export type AlibabaReceiptLine = {
  description: string;
  /** As printed: "560.00", or "411.25" for a service billed by amount. */
  quantity: string;
  unitPrice: string;
  total: string;
};

export type AlibabaReceipt = {
  orderNumber: string;
  /** The order date as printed (Alibaba writes Pacific time), ISO. */
  orderDate: string | null;
  seller: string | null;
  /** Address lines under the seller's name. */
  sellerAddress: string | null;
  currency: string;
  lines: AlibabaReceiptLine[];
  subtotal: string | null;
  shipping: string | null;
  orderTotal: string | null;
  processingFee: string | null;
  /** "*Currency in order contract is USD (1 USD = 3.739012 AED)", with the total in it. */
  contract: { currency: string; total: string | null; rate: string | null } | null;
};

export type AlibabaReceiptRead =
  | { ok: true; receipt: AlibabaReceipt }
  | { ok: false; error: string };

const NOT_ALIBABA =
  "This doesn't look like an Alibaba.com receipt. Download it from the order's page on Alibaba (Receipt), then try again.";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "12:44 AM, Jul 22nd, 2026 (PDT)" or "July 23, 2026" → "2026-07-22". */
export function alibabaDate(text: string): string | null {
  const m = /\b([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?, (\d{4})\b/.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf((m[1] ?? "").slice(0, 3).toLowerCase());
  const day = Number(m[2]);
  if (month < 0 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "USD 1,645.00" → { currency: "USD", amount: "1645.00" }. */
export function alibabaMoney(text: string): { currency: string; amount: string } | null {
  const m = /^\(?([A-Z]{3}) ?(-?[\d,]+(?:\.\d+)?)\)?$/.exec(text.trim());
  if (!m?.[1] || !m[2] || !getCurrency(m[1])) return null;
  return { currency: m[1], amount: m[2].replace(/,/g, "") };
}

const QUANTITY = /^\d[\d,]*(?:\.\d+)?$/;

/** Items in reading order: page by page, top to bottom, left to right. */
function ordered(items: readonly PdfTextItem[]): PdfTextItem[] {
  return items
    .filter((item) => item.text.trim())
    .map((item) => ({ ...item, text: item.text.replace(/\s+/g, " ").trim() }))
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
}

const sameLine = (a: PdfTextItem, b: PdfTextItem) => a.page === b.page && Math.abs(a.y - b.y) < 4;
/** Further down the document than `a`. */
const below = (a: PdfTextItem, b: PdfTextItem) =>
  b.page > a.page || (b.page === a.page && b.y < a.y - 2);

export function readAlibabaReceipt(input: readonly PdfTextItem[]): AlibabaReceiptRead {
  const items = ordered(input);
  const find = (pattern: RegExp, from?: PdfTextItem) =>
    items.find((item) => pattern.test(item.text) && (!from || below(from, item) || item === from));
  /** The text to the right of a label on its line ("Order number:" → "#2773…"). */
  const rightOf = (label: PdfTextItem | undefined) =>
    label
      ? items
          .filter((item) => sameLine(item, label) && item.x > label.x + label.width - 1)
          .sort((a, b) => a.x - b.x)
      : [];
  /** "Order number: #123" in one piece, or the label with its value beside it. */
  const labelled = (name: RegExp): string | null => {
    const label = find(name);
    if (!label) return null;
    const own = label.text.replace(name, "").trim();
    return own || (rightOf(label)[0]?.text ?? null);
  };

  const isAlibaba = items.some((item) => /alibaba\.com/i.test(item.text));
  const orderNumber = (labelled(/^Order number:?/i) ?? labelled(/^Receipt number:?/i))
    ?.replace(/^#/, "")
    .trim();
  const header = find(/^Item description$/i);
  const qtyHead = header ? items.find((i) => sameLine(i, header) && /^Qty$/i.test(i.text)) : null;
  if (!isAlibaba || !orderNumber || !header || !qtyHead) return { ok: false, error: NOT_ALIBABA };

  // Seller: the column under "Sold by:", down to the first gap.
  let seller: string | null = null;
  let sellerAddress: string | null = null;
  const soldBy = find(/^Sold by:?$/i);
  if (soldBy) {
    const column = items
      .filter((i) => below(soldBy, i) && Math.abs(i.x - soldBy.x) < 6 && i.page === soldBy.page)
      .sort((a, b) => b.y - a.y);
    const block: PdfTextItem[] = [];
    for (const item of column) {
      const last = block.at(-1) ?? soldBy;
      if (last.y - item.y > 24) break;
      block.push(item);
    }
    seller = block[0]?.text ?? null;
    sellerAddress =
      block
        .slice(1)
        .map((i) => i.text)
        .join(" ")
        .slice(0, 500) || null;
  }

  // The items table: from the header down to "Subtotal". A row starts at its quantity; the
  // description is everything left of the quantity column from that line to the next row.
  const end = find(/^Subtotal$/i, header);
  const body = items.filter(
    (i) =>
      below(header, i) &&
      !/^\(excl\. tax\)$/i.test(i.text) &&
      (!end || (!below(end, i) && !sameLine(i, end))),
  );
  const descriptionEdge = qtyHead.x - 40;
  const anchors = body.filter(
    (i) => QUANTITY.test(i.text) && i.x >= descriptionEdge && i.x < qtyHead.x + qtyHead.width + 30,
  );
  const lines: AlibabaReceiptLine[] = [];
  let currency: string | null = null;
  anchors.forEach((anchor, n) => {
    const next = anchors[n + 1];
    const money = rightOf(anchor)
      .map((i) => alibabaMoney(i.text))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    const description = body
      .filter(
        (i) =>
          i.x < descriptionEdge &&
          (sameLine(i, anchor) || below(anchor, i)) &&
          (!next || (below(i, next) && !sameLine(i, next))),
      )
      .map((i) => i.text)
      .join(" ");
    const unit = money[0];
    const total = money.at(-1);
    if (!unit || !total) return;
    currency ??= total.currency;
    lines.push({
      description: description.slice(0, 300),
      quantity: anchor.text.replace(/,/g, ""),
      unitPrice: unit.amount,
      total: total.amount,
    });
  });
  if (!lines.length || !currency) {
    return {
      ok: false,
      error: "This Alibaba receipt has no items this page could read. Fill the order in by hand.",
    };
  }

  const amountAfter = (name: RegExp): string | null => {
    const label = find(name, header);
    if (!label) return null;
    for (const item of rightOf(label)) {
      const money = alibabaMoney(item.text);
      if (money) return money.amount;
      if (item.text === "-") return null;
    }
    return null;
  };
  const contractNote = items.find((i) => /currency in order contract is/i.test(i.text));
  const rateItem = contractNote
    ? [contractNote, ...rightOf(contractNote)].find((i) =>
        /1 [A-Z]{3} = [\d.]+ [A-Z]{3}/.test(i.text),
      )
    : null;
  const contractCurrency = contractNote
    ? /contract is ([A-Z]{3})/i.exec(contractNote.text)?.[1]?.toUpperCase()
    : undefined;
  const rate = rateItem ? /1 [A-Z]{3} = ([\d.]+) [A-Z]{3}/.exec(rateItem.text)?.[1] : undefined;

  return {
    ok: true,
    receipt: {
      orderNumber: orderNumber.slice(0, 80),
      orderDate: alibabaDate(labelled(/^Order date:?/i) ?? ""),
      seller: seller?.slice(0, 200) ?? null,
      sellerAddress,
      currency,
      lines,
      subtotal: amountAfter(/^Subtotal$/i),
      shipping: amountAfter(/^Shipping fee$/i),
      orderTotal: amountAfter(/^Order total$/i),
      processingFee: amountAfter(/^Payment processing fee$/i),
      contract:
        contractCurrency && contractCurrency !== currency
          ? {
              currency: contractCurrency,
              total: amountAfter(new RegExp(`^Order total in ${contractCurrency}$`, "i")),
              rate: rate ?? null,
            }
          : null,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The draft purchase order

export type AlibabaDraftLine = {
  productId: string;
  quantity: string;
  unitCost: string;
  /** Alibaba's description, shown under the line so the right product can be picked. */
  description: string;
  /** What to check on this line, in plain words. */
  note: string | null;
  /** Billed by amount (freight, a service), not whole units. */
  byAmount: boolean;
};

export type AlibabaDraft = {
  supplierId: string;
  /** The seller's name when no vendor matches it yet (offered as a new vendor). */
  newSupplier: { name: string; address: string | null } | null;
  currency: string;
  orderDate: string | null;
  reference: string;
  notes: string;
  lines: AlibabaDraftLine[];
  /** Things to look at before saving. */
  checks: string[];
  /** The receipt's item subtotal, to compare with the form's total. */
  subtotal: string | null;
};

/** Lower case letters and digits only, with company suffixes dropped, for matching names. */
export function looseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(co|company|ltd|limited|llc|inc|corp|corporation|trading|technology|tech)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (text: string) =>
  new Set(
    looseName(text)
      .split(" ")
      .filter((w) => w.length > 1),
  );

/**
 * The product an Alibaba line is for: same SKU, or the product whose name's words all appear in
 * the description (the longest such name wins). Alibaba titles are long; product names short.
 */
export function matchAlibabaProduct(
  description: string,
  products: readonly { id: string; name: string; sku: string | null }[],
): string | null {
  const text = words(description);
  const loose = ` ${looseName(description)} `;
  let best: { id: string; score: number } | null = null;
  for (const product of products) {
    if (product.sku && loose.includes(` ${looseName(product.sku)} `) && looseName(product.sku)) {
      return product.id;
    }
    const name = [...words(product.name)];
    if (!name.length || !name.every((w) => text.has(w))) continue;
    if (!best || name.length > best.score) best = { id: product.id, score: name.length };
  }
  return best?.id ?? null;
}

const show = (amount: string, currency: string) => {
  const [whole = "0", frac = ""] = amount.split(".");
  const digits = Math.max(getCurrency(currency)?.minorUnits ?? 2, 0);
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${digits ? `.${frac.padEnd(digits, "0").slice(0, digits)}` : ""}`;
};

/**
 * A purchase order draft from a receipt: the vendor whose name matches the seller, products
 * matched by name or SKU, a cost of one that adds up to Alibaba's line total, and the fees and
 * contract currency in the notes. Nothing here is saved.
 */
export function alibabaPurchaseDraft(
  receipt: AlibabaReceipt,
  options: {
    suppliers: readonly { id: string; name: string }[];
    products: readonly { id: string; name: string; sku: string | null }[];
  },
): AlibabaDraft {
  const { currency } = receipt;
  const checks: string[] = [];
  const seller = receipt.seller ? looseName(receipt.seller) : "";
  const supplier = seller ? options.suppliers.find((s) => looseName(s.name) === seller) : undefined;

  const lines = receipt.lines.map((line): AlibabaDraftLine => {
    const productId = matchAlibabaProduct(line.description, options.products) ?? "";
    const whole = /^\d+(\.0+)?$/.test(line.quantity);
    if (!whole) {
      // Billed by amount (freight, services): one line for the whole amount.
      return {
        productId,
        quantity: "1",
        unitCost: line.total,
        description: line.description,
        byAmount: true,
        note: `Alibaba bills ${line.quantity} × ${show(line.unitPrice, currency)} here, not whole units. It's kept as 1 for ${show(line.total, currency)}.`,
      };
    }
    const quantity = Number.parseInt(line.quantity, 10);
    let unitCost = line.unitPrice;
    let note: string | null = null;
    if (
      quantity > 0 &&
      purchaseLineTotal(quantity, unitCost, currency) !== formatDecimal(parseDecimal(line.total))
    ) {
      // Alibaba rounds the price it prints; work it out from the line total, exactly.
      unitCost = unitCostFromTotal(line.total, quantity) ?? unitCost;
      note = `Alibaba prints ${show(line.unitPrice, currency)} each but charges ${show(line.total, currency)} for ${quantity}: the cost of one is worked out from the total.`;
    }
    return {
      productId,
      quantity: String(quantity),
      unitCost: plain(unitCost),
      description: line.description,
      note,
      byAmount: false,
    };
  });

  if (!supplier && receipt.seller) {
    checks.push(`${receipt.seller} isn't one of your vendors yet.`);
  }
  const unmatched = lines.filter((l) => !l.productId).length;
  if (unmatched) {
    checks.push(
      unmatched === 1
        ? "Choose the product for the line Alibaba describes."
        : `Choose the product for ${unmatched} lines, from Alibaba's descriptions.`,
    );
  }
  if (lines.some((l) => l.byAmount)) {
    checks.push(
      "Some lines are billed by amount, not units: freight or a service. Freight usually belongs on a delivery's costs instead.",
    );
  }

  if (receipt.subtotal) {
    const total = purchaseOrderTotal(
      lines.map((l) => ({ quantity: Number(l.quantity), unitCost: l.unitCost })),
      currency,
    );
    if (parseDecimal(total) !== parseDecimal(receipt.subtotal)) {
      checks.push(
        `These lines come to ${show(total, currency)}; Alibaba's items come to ${show(receipt.subtotal, currency)}. Adjust a cost if they must match to the cent.`,
      );
    }
  }

  const notes = [
    `From Alibaba.com order ${receipt.orderNumber}.`,
    receipt.shipping
      ? `Shipping fee ${show(receipt.shipping, currency)}: add it to the delivery's costs when it arrives.`
      : null,
    receipt.processingFee
      ? `Payment processing fee ${show(receipt.processingFee, currency)}.`
      : null,
    receipt.contract
      ? `Contract currency ${receipt.contract.currency}${receipt.contract.total ? `: ${show(receipt.contract.total, receipt.contract.currency)}` : ""}${receipt.contract.rate ? ` (1 ${receipt.contract.currency} = ${receipt.contract.rate} ${currency})` : ""}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    supplierId: supplier?.id ?? "",
    newSupplier:
      !supplier && receipt.seller ? { name: receipt.seller, address: receipt.sellerAddress } : null,
    currency,
    orderDate: receipt.orderDate,
    reference: receipt.orderNumber,
    notes,
    lines,
    checks,
    subtotal: receipt.subtotal,
  };
}

/** "13.4604" stays; "1.0000" → "1". */
function plain(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
