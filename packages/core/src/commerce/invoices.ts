import { TAX_PACKS } from "../accounting/tax";
import { formatDecimal, parseDecimal } from "../money";

/**
 * A customer invoice for one marketplace order. It is a document for the buyer (a PDF they
 * asked for), not a ledger entry: the books still come from settlements. Buyer email is never
 * part of this.
 */

export type InvoiceSeller = {
  legalName: string;
  tradeName: string | null;
  address: string | null;
  /** Trade license number, when the company has one. */
  tradeLicense: string | null;
  /** GST/HST or VAT number. Only set when the company is registered to charge that tax. */
  taxNumber: string | null;
  /** "VAT", "GST/HST", or "sales tax". */
  taxName: string;
  registered: boolean;
};

export type InvoiceBuyer = {
  name: string | null;
  company: string | null;
  taxNumber: string | null;
  address: string | null;
};

export type InvoiceItem = {
  title: string | null;
  sku: string | null;
  quantity: number;
  itemPrice: string | null;
  itemTax: string | null;
  shippingPrice: string | null;
  shippingTax: string | null;
  promotionDiscount: string | null;
  /** Free or discounted shipping, as a positive amount. Older orders don't have it (undefined). */
  shippingDiscount?: string | null;
};

export type OrderInvoiceLine = {
  title: string;
  sku: string | null;
  quantity: number;
  /** One unit's price. Missing on invoices issued before unit prices were shown. */
  unitPrice?: string;
  /** The line's price for the whole quantity, before tax. */
  amount: string;
};

export type OrderInvoice = {
  /** "INV-0001". Assigned when the invoice is first saved. */
  number: string;
  title: "Invoice" | "Tax invoice";
  /** The title in Arabic, printed beside the English one. */
  titleArabic?: string;
  /** "Not registered for VAT." when the company isn't registered. */
  registrationNote: string | null;
  seller: {
    legalName: string;
    tradeName: string | null;
    address: string | null;
    tradeLicense: string | null;
    taxNumber: string | null;
    /** "TRN", "GST/HST number", or "Tax number". */
    taxNumberLabel: string;
  };
  buyer: InvoiceBuyer;
  orderNumber: string;
  marketplace: string;
  currency: string;
  /** YYYY-MM-DD, the day the order was placed. */
  purchasedOn: string;
  /** YYYY-MM-DD, the day the invoice was first issued. */
  invoiceDate: string;
  lines: OrderInvoiceLine[];
  /** Omitted when zero. */
  shipping: string | null;
  /** A positive amount taken off. Omitted when zero. */
  discounts: string | null;
  /** Shipping given free or reduced, a positive amount. Omitted when zero. */
  shippingDiscount?: string | null;
  /**
   * Seller tax when the company is registered. Otherwise Amazon's figure, labelled as reported
   * by Amazon so it isn't read as tax the company charged.
   */
  tax: { kind: "seller" | "amazon"; label: string; amount: string } | null;
  /** The marketplace's order total. */
  total: string;
  /** Given back to the buyer, when any. A positive amount. */
  refunded: string | null;
  paymentNote: string;
};

export const INVOICE_PAYMENT_NOTE =
  "Amazon has already collected this payment. This invoice is for your records.";

export const INVOICE_TITLES_ARABIC = { Invoice: "فاتورة", "Tax invoice": "فاتورة ضريبية" } as const;

/** "INV-0001". */
export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}

/** The name of sales tax in the company's country, for the invoice's wording. */
export function salesTaxName(countryCode: string): string {
  if (countryCode === "AE") return "VAT";
  if (countryCode === "CA") return "GST/HST";
  return "sales tax";
}

function taxNumberLabel(taxName: string): string {
  if (taxName === "VAT") return "TRN";
  if (taxName === "GST/HST") return "GST/HST number";
  return "Tax number";
}

const AUTHORITY_PATTERNS: [RegExp, string][] = [
  [/federal tax authority|\bfta\b/i, "AE"],
  [/zakat|zatca|saudi/i, "SA"],
  [/canada revenue|\bcra\b|revenu qu[eé]bec/i, "CA"],
  [/hmrc|his majesty|her majesty/i, "GB"],
];

/** The country a tax registration is with, from its authority's name, or null when unknown. */
export function registrationCountry(authority: string): string | null {
  const name = authority.trim();
  const pack = TAX_PACKS.find((p) => p.authority.toLowerCase() === name.toLowerCase());
  if (pack) return pack.country;
  return AUTHORITY_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/**
 * Whether an invoice from a company in `country` may be a tax invoice, and the number to print.
 * It takes an active registration with that country's authority (or one whose authority isn't
 * recognised) that has a number: a VAT tax invoice must show the seller's TRN, so a registration
 * saved without one, or one in another country (KSA VAT for a UAE company), doesn't count.
 */
export function invoiceRegistration(input: {
  country: string;
  registrations: readonly {
    authority: string;
    registrationNumber: string | null;
    isActive: boolean;
  }[];
  /** A TRN or GST/HST number saved under Company → registration numbers. */
  identifierNumber: string | null;
}): { registered: boolean; taxNumber: string | null } {
  const here = input.registrations.filter((row) => {
    if (!row.isActive) return false;
    const country = registrationCountry(row.authority);
    return country === null || country === input.country;
  });
  if (!here.length) return { registered: false, taxNumber: null };
  const number =
    here.map((row) => row.registrationNumber?.trim()).find((value) => value) ||
    input.identifierNumber?.trim() ||
    null;
  return number ? { registered: true, taxNumber: number } : { registered: false, taxNumber: null };
}

/**
 * A product title short enough to read on an invoice line: marketplace titles run to 200
 * characters of keywords. Cut at a word boundary, preferring a separator ("|", " - ", ","),
 * once it's past a readable length.
 */
export function invoiceLineTitle(title: string, max = 90): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const separator = Math.max(
    head.lastIndexOf(" | "),
    head.lastIndexOf(" - "),
    head.lastIndexOf(", "),
  );
  if (separator >= 40) return head.slice(0, separator).trim();
  const space = head.lastIndexOf(" ");
  return `${(space >= 40 ? head.slice(0, space) : head).replace(/[,;:|-]+$/, "").trim()}…`;
}

/** One unit's price from a line total, rounded half up to 2 decimals (exact when it divides). */
function unitPriceOf(amountUnits: bigint, quantity: number): string | undefined {
  if (quantity <= 1) return quantity === 1 ? formatDecimal(amountUnits) : undefined;
  // parseDecimal works in 10^-4 units; round the per-unit price to cents.
  const q = BigInt(quantity);
  const cents = (amountUnits * 2n + q * 100n) / (q * 200n);
  return formatDecimal(cents * 100n);
}

const blank = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function sumAmounts(values: (string | null | undefined)[]): bigint {
  return values.reduce((total, value) => total + (value ? parseDecimal(value) : 0n), 0n);
}

function present(units: bigint): string | null {
  return units === 0n ? null : formatDecimal(units);
}

/**
 * Turns an order and the selling company into the invoice document. Amounts stay exact
 * decimals. The order total is Amazon's figure, not a sum of the lines (gift wrap and similar
 * aren't stored).
 */
export function prepareOrderInvoice(input: {
  number: string;
  seller: InvoiceSeller;
  buyer: InvoiceBuyer;
  orderNumber: string;
  marketplace: string;
  currency: string;
  purchasedOn: string;
  invoiceDate: string;
  total: string;
  refunded: string | null;
  items: readonly InvoiceItem[];
}): OrderInvoice {
  const taxUnits = sumAmounts(input.items.flatMap((item) => [item.itemTax, item.shippingTax]));
  const registered = input.seller.registered;
  const lineUnits = input.items.map((item) => (item.itemPrice ? parseDecimal(item.itemPrice) : 0n));
  const shippingUnits = sumAmounts(input.items.map((item) => item.shippingPrice));
  const discountUnits = sumAmounts(input.items.map((item) => item.promotionDiscount));
  const knowsShippingDiscount = input.items.some((item) => item.shippingDiscount !== undefined);
  let shippingDiscountUnits = sumAmounts(input.items.map((item) => item.shippingDiscount));
  if (!knowsShippingDiscount && shippingUnits > 0n) {
    // Orders saved before shipping discounts were kept: when the lines and shipping come to
    // exactly the shipping more than Amazon's total, the shipping was free.
    const lines = lineUnits.reduce((a, b) => a + b, 0n);
    const gap = lines + shippingUnits - discountUnits - parseDecimal(input.total);
    if (gap === shippingUnits) shippingDiscountUnits = shippingUnits;
  }
  const title = registered ? "Tax invoice" : "Invoice";
  return {
    number: input.number,
    title,
    titleArabic: INVOICE_TITLES_ARABIC[title],
    registrationNote: registered ? null : `Not registered for ${input.seller.taxName}.`,
    seller: {
      legalName: input.seller.legalName.trim(),
      tradeName: blank(input.seller.tradeName),
      address: blank(input.seller.address),
      tradeLicense: blank(input.seller.tradeLicense),
      taxNumber: registered ? blank(input.seller.taxNumber) : null,
      taxNumberLabel: taxNumberLabel(input.seller.taxName),
    },
    buyer: {
      name: blank(input.buyer.name),
      company: blank(input.buyer.company),
      taxNumber: blank(input.buyer.taxNumber),
      address: blank(input.buyer.address),
    },
    orderNumber: input.orderNumber,
    marketplace: input.marketplace,
    currency: input.currency,
    purchasedOn: input.purchasedOn,
    invoiceDate: input.invoiceDate,
    lines: input.items.map((item, index) => {
      const units = lineUnits[index] ?? 0n;
      const unitPrice = unitPriceOf(units, item.quantity);
      return {
        title: invoiceLineTitle(blank(item.title) ?? blank(item.sku) ?? "Item"),
        sku: blank(item.sku),
        quantity: item.quantity,
        ...(unitPrice ? { unitPrice } : {}),
        amount: formatDecimal(units),
      };
    }),
    shipping: present(shippingUnits),
    discounts: present(discountUnits),
    shippingDiscount: present(shippingDiscountUnits),
    tax:
      taxUnits === 0n
        ? null
        : registered
          ? { kind: "seller", label: input.seller.taxName, amount: formatDecimal(taxUnits) }
          : { kind: "amazon", label: "Tax reported by Amazon", amount: formatDecimal(taxUnits) },
    total: formatDecimal(parseDecimal(input.total)),
    refunded: present(input.refunded ? parseDecimal(input.refunded) : 0n),
    paymentNote: INVOICE_PAYMENT_NOTE,
  };
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * The buyer's name, company and tax number from one Orders API response. Email is ignored, even
 * when Amazon includes it, and is not returned.
 */
export function parseBuyerInfo(json: unknown): InvoiceBuyer {
  const root = record(json);
  const payload = record(root.payload);
  const order = payload.AmazonOrderId ? payload : root.AmazonOrderId ? root : payload;
  const buyer = record(order.BuyerInfo);
  const tax = record(buyer.BuyerTaxInfo);
  const classifications = Array.isArray(tax.TaxClassifications) ? tax.TaxClassifications : [];
  const numbers = classifications.flatMap((row) => {
    const item = record(row);
    const value = text(item.Value);
    return value ? [{ name: text(item.Name), value }] : [];
  });
  const preferred = numbers.find((item) => /vat|trn|gst/i.test(item.name));
  return {
    name: text(buyer.BuyerName) || null,
    company: text(tax.CompanyLegalName) || null,
    taxNumber: (preferred ?? numbers[0])?.value ?? null,
    address: null,
  };
}
