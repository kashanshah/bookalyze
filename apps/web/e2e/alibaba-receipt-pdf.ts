// Builds an Alibaba.com order receipt PDF for end-to-end tests: synthetic companies and numbers,
// laid out like Alibaba's (seller, buyer and ship-to columns; an items table; totals).

import { type PdfText, textPdf } from "./text-pdf";

export function alibabaReceiptPdf(input: {
  orderNumber: string;
  orderDate: string;
  seller: string[];
  items: { title: string[]; qty: string; unit: string; total: string }[];
  totals: [string, string][];
}): Buffer {
  const texts: PdfText[] = [
    { text: "Receipt", x: 36, y: 1190 },
    { text: `Receipt number: #${input.orderNumber}`, x: 36, y: 1167 },
    { text: "Marketplace Operator:", x: 752, y: 1182 },
    { text: "Alibaba.com Singapore E-Commerce Private Limited", x: 594, y: 1163 },
    { text: "Sold by:", x: 36, y: 1074 },
    ...input.seller.map((text, i) => ({ text, x: 36, y: 1055 - i * 14 })),
    { text: "Buyer's company address:", x: 321, y: 1074 },
    { text: "EXAMPLE TRADING", x: 321, y: 1055 },
    { text: "Ship to:", x: 607, y: 1074 },
    { text: "Example Warehouse", x: 607, y: 1055 },
    { text: "Order number:", x: 36, y: 952 },
    { text: `#${input.orderNumber}`, x: 125, y: 952 },
    { text: "Order date:", x: 321, y: 953 },
    { text: input.orderDate, x: 380, y: 953 },
    { text: "Order details", x: 43, y: 918 },
    { text: "Item description", x: 43, y: 884 },
    { text: "Qty", x: 528, y: 884 },
    { text: "Unit price", x: 649, y: 891 },
    { text: "(excl. tax)", x: 649, y: 877 },
    { text: "Total amount", x: 782, y: 891 },
    { text: "(excl. tax)", x: 800, y: 877 },
  ];
  let y = 851;
  for (const item of input.items) {
    item.title.forEach((text, i) => {
      texts.push({ text, x: 43, y: y - i * 13 });
    });
    texts.push({ text: item.qty, x: 545, y, right: true });
    texts.push({ text: item.unit, x: 697, y, right: true });
    texts.push({ text: item.total, x: 848, y, right: true });
    y -= 40;
  }
  for (const [label, amount] of input.totals) {
    texts.push({ text: label, x: 464, y });
    texts.push({ text: amount, x: 848, y, right: true });
    y -= 31;
  }
  texts.push({ text: "This receipt is not a tax invoice.", x: 45, y: 336 });
  return textPdf(texts, { size: 9, width: 892, height: 1263 });
}
