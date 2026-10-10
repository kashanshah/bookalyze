import { describe, expect, it } from "vitest";
import type { PdfTextItem } from "../banking/pdf-statement";
import {
  alibabaDate,
  alibabaMoney,
  alibabaPurchaseDraft,
  looseName,
  matchAlibabaProduct,
  readAlibabaReceipt,
} from "../inventory/alibaba-receipt";

// A synthetic receipt laid out like Alibaba.com's: seller, buyer and ship-to columns, the order
// number and date, an items table (quantity, unit price, total; long titles wrap), then the
// totals and payment block. Made-up companies and numbers.
function receipt(
  rows: { title: string[]; qty: string; unit: string; total: string }[],
  totals: [string, string][],
  extra: PdfTextItem[] = [],
): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  const t = (text: string, x: number, y: number, page = 1) =>
    items.push({ text, x, y, width: text.length * 5, page });
  t("Receipt", 36, 1190);
  t("Receipt number: #900000000001", 36, 1167);
  t("Marketplace Operator:", 752, 1182);
  t("Alibaba.com Singapore E-Commerce Private Limited", 594, 1163);
  t("Sold by:", 36, 1074);
  t("Maple Glassworks Co., Ltd.", 36, 1055);
  t("No. 1, Example Road,", 36, 1040);
  t("Ningbo, Zhejiang, CN", 36, 1026);
  t("Buyer's company address:", 321, 1074);
  t("EXAMPLE TRADING", 321, 1055);
  t("Ship to:", 607, 1074);
  t("Example Warehouse", 607, 1055);
  t("Order number:", 36, 952);
  t("#900000000001", 125, 952);
  t("Order date:", 321, 953);
  t("6:34 PM, Sep 2nd, 2026 (PDT)", 380, 953);
  t("Order details", 43, 918);
  t("Item description", 43, 884);
  t("Qty", 528, 884);
  t("Unit price", 649, 891);
  t("(excl. tax)", 649, 877);
  t("Total amount", 782, 891);
  t("(excl. tax)", 800, 877);
  let y = 851;
  for (const row of rows) {
    row.title.forEach((line, i) => {
      t(line, 43, y - i * 13);
    });
    t(row.qty, 513, y);
    t(row.unit, 640, y);
    t(row.total, 791, y);
    y -= 40;
  }
  for (const [label, amount] of totals) {
    t(label, 464, y);
    t(amount, 782, y);
    y -= 31;
  }
  items.push(...extra.map((item) => ({ ...item, y: item.y - (851 - y) })));
  t("This receipt is not a tax invoice.", 45, 336);
  return items;
}

const cups = receipt(
  [
    {
      title: ["Double Wall Glass Cup 350ml"],
      qty: "560.00",
      unit: "AED 13.47",
      total: "AED 7,537.85",
    },
    {
      title: ["Bamboo Lid for Glass Cup Eco Friendly Wholesale Custom Logo", "MG-LID-01"],
      qty: "500.00",
      unit: "AED 2.00",
      total: "AED 1,000.00",
    },
  ],
  [
    ["Subtotal", "AED 8,537.85"],
    ["Shipping fee", "AED 579.55"],
    ["Order total", "AED 9,117.40"],
    ["Order total in USD", "USD 2,438.48"],
  ],
  [
    { text: "*Currency in order contract is USD", x: 470, y: 851, width: 138, page: 1 },
    { text: "(1 USD = 3.739012 AED)", x: 741, y: 851, width: 101, page: 1 },
    { text: "Payment processing fee", x: 468, y: 800, width: 113, page: 1 },
    { text: "AED 242.78", x: 794, y: 800, width: 57, page: 1 },
  ],
);

describe("Alibaba receipt values", () => {
  it("reads dates and money as printed", () => {
    expect(alibabaDate("12:44 AM, Jul 22nd, 2026 (PDT)")).toBe("2026-07-22");
    expect(alibabaDate("Paid on September 3, 2024 (Apple Pay)")).toBe("2024-09-03");
    expect(alibabaDate("soon")).toBeNull();
    expect(alibabaMoney("USD 1,645.00")).toEqual({ currency: "USD", amount: "1645.00" });
    expect(alibabaMoney("(USD 2,235.93)")).toEqual({ currency: "USD", amount: "2235.93" });
    expect(alibabaMoney("-")).toBeNull();
    expect(alibabaMoney("XYZ 5.00")).toBeNull();
  });

  it("matches names loosely", () => {
    expect(looseName("Maple Glassworks Co., Ltd.")).toBe("maple glassworks");
    expect(looseName("MAPLE GLASSWORKS LIMITED")).toBe("maple glassworks");
  });
});

describe("readAlibabaReceipt", () => {
  it("reads the seller, order, items and totals", () => {
    const read = readAlibabaReceipt(cups);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.receipt).toMatchObject({
      orderNumber: "900000000001",
      orderDate: "2026-09-02",
      seller: "Maple Glassworks Co., Ltd.",
      sellerAddress: "No. 1, Example Road, Ningbo, Zhejiang, CN",
      currency: "AED",
      subtotal: "8537.85",
      shipping: "579.55",
      orderTotal: "9117.40",
      processingFee: "242.78",
      contract: { currency: "USD", total: "2438.48", rate: "3.739012" },
    });
    expect(read.receipt.lines).toEqual([
      {
        description: "Double Wall Glass Cup 350ml",
        quantity: "560.00",
        unitPrice: "13.47",
        total: "7537.85",
      },
      {
        description: "Bamboo Lid for Glass Cup Eco Friendly Wholesale Custom Logo MG-LID-01",
        quantity: "500.00",
        unitPrice: "2.00",
        total: "1000.00",
      },
    ]);
  });

  it("reads a shipping fee of '-' as none", () => {
    const read = readAlibabaReceipt(
      receipt(
        [{ title: ["Freight service"], qty: "411.25", unit: "USD 1.0000", total: "USD 411.25" }],
        [
          ["Subtotal", "USD 411.25"],
          ["Shipping fee", "-"],
          ["Order total", "USD 411.25"],
        ],
      ),
    );
    expect(read.ok && read.receipt.shipping).toBeNull();
    expect(read.ok && read.receipt.contract).toBeNull();
  });

  it("refuses what isn't an Alibaba receipt", () => {
    const read = readAlibabaReceipt([{ text: "Statement", x: 10, y: 800, width: 50, page: 1 }]);
    expect(read).toEqual({ ok: false, error: expect.stringContaining("Alibaba.com receipt") });
  });
});

describe("alibabaPurchaseDraft", () => {
  const products = [
    { id: "cup", name: "Double Wall Glass Cup", sku: "MG-CUP-350" },
    { id: "glass", name: "Glass", sku: null },
    { id: "lid", name: "Bamboo lid", sku: "MG-LID-01" },
  ];

  it("prefills the vendor, products, costs and notes", () => {
    const read = readAlibabaReceipt(cups);
    if (!read.ok) throw new Error(read.error);
    const draft = alibabaPurchaseDraft(read.receipt, {
      suppliers: [{ id: "v1", name: "MAPLE GLASSWORKS LIMITED" }],
      products,
    });
    expect(draft).toMatchObject({
      supplierId: "v1",
      newSupplier: null,
      currency: "AED",
      orderDate: "2026-09-02",
      reference: "900000000001",
    });
    // The longest matching name wins; a SKU in the title wins outright.
    expect(draft.lines.map((l) => [l.productId, l.quantity, l.unitCost])).toEqual([
      ["cup", "560", "13.4604464286"],
      ["lid", "500", "2"],
    ]);
    expect(draft.lines[0]?.note).toContain("worked out from the total");
    expect(draft.lines[1]?.note).toBeNull();
    expect(draft.notes).toBe(
      [
        "From Alibaba.com order 900000000001.",
        "Shipping fee AED 579.55: add it to the delivery's costs when it arrives.",
        "Payment processing fee AED 242.78.",
        "Contract currency USD: USD 2,438.48 (1 USD = 3.739012 AED).",
      ].join("\n"),
    );
    // The cost of one is kept exactly, so the lines add up to Alibaba's to the fils.
    expect(draft.checks).toEqual([]);
  });

  it("offers the seller as a new vendor and flags lines billed by amount", () => {
    const read = readAlibabaReceipt(
      receipt(
        [
          {
            title: ["Sea freight to Canada"],
            qty: "411.25",
            unit: "USD 1.0000",
            total: "USD 411.25",
          },
        ],
        [["Subtotal", "USD 411.25"]],
      ),
    );
    if (!read.ok) throw new Error(read.error);
    const draft = alibabaPurchaseDraft(read.receipt, { suppliers: [], products });
    expect(draft.newSupplier).toEqual({
      name: "Maple Glassworks Co., Ltd.",
      address: "No. 1, Example Road, Ningbo, Zhejiang, CN",
    });
    expect(draft.lines).toEqual([
      expect.objectContaining({ productId: "", quantity: "1", unitCost: "411.25", byAmount: true }),
    ]);
    expect(draft.checks).toHaveLength(3);
  });

  it("matches products by every word of their name, or by SKU", () => {
    expect(matchAlibabaProduct("Custom glass bottle", products)).toBe("glass");
    expect(matchAlibabaProduct("Item MG-CUP-350 wholesale", products)).toBe("cup");
    expect(matchAlibabaProduct("Steel straw", products)).toBeNull();
  });
});
