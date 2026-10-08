import "server-only";
import { csvAmount, type OrderInvoice } from "@bookalyze/core";
import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 48;
const INK = rgb(0.11, 0.13, 0.16);
const MUTED = rgb(0.38, 0.4, 0.44);
const RULE = rgb(0.82, 0.83, 0.86);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A date the standard PDF font can draw, e.g. "7 Oct 2026". */
function longDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const name = MONTHS[Number(month) - 1];
  return name && day && year ? `${Number(day)} ${name} ${year}` : iso;
}

/** Amounts as "AED 1,250.00", so the PDF never depends on a currency symbol the font lacks. */
function money(amount: string, currency: string, signed = false): string {
  // Rounded to the currency's minor units: "1250.0000" AED → "1250.00", JPY → "1250".
  const rounded = csvAmount(amount, currency);
  const negative = rounded.startsWith("-");
  const [whole, fraction] = rounded.replace("-", "").split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${currency} ${grouped}${fraction ? `.${fraction}` : ""}`;
  return negative || signed ? `-${body}` : body;
}

const charsets = new WeakMap<PDFFont, Set<number>>();

/**
 * The text the font can draw. The standard fonts cover Latin text and punctuation (’ – € …);
 * anything else (Arabic, say) is left out rather than failing the whole PDF.
 */
function drawable(value: string, font: PDFFont, _size?: number): string {
  let set = charsets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsets.set(font, set);
  }
  const known = set;
  return Array.from(value)
    .filter((c) => c === "\n" || known.has(c.codePointAt(0) ?? 0))
    .join("");
}

function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of drawable(value, font, size).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

/** A customer invoice as a PDF. Standard fonts only, so it prints anywhere. */
export async function renderOrderInvoicePdf(invoice: OrderInvoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(invoice.number);
  doc.setAuthor(drawable(invoice.seller.legalName, font, 12) || "Invoice");

  let page = doc.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - MARGIN;
  const right = WIDTH - MARGIN;
  const contentWidth = right - MARGIN;

  const ensure = (height: number) => {
    if (y - height >= MARGIN) return;
    page = doc.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
  };

  const text = (
    value: string,
    options: { x?: number; size?: number; face?: PDFFont; color?: typeof INK; width?: number } = {},
  ) => {
    const size = options.size ?? 10;
    const face = options.face ?? font;
    const color = options.color ?? INK;
    const lines = wrap(value, face, size, options.width ?? contentWidth);
    ensure(lines.length * (size + 3));
    for (const line of lines) {
      if (line) page.drawText(line, { x: options.x ?? MARGIN, y, size, font: face, color });
      y -= size + 3;
    }
  };

  const gap = (n: number) => {
    y -= n;
  };

  text(invoice.title, { size: 20, face: bold, width: contentWidth - 140 });
  const number = drawable(invoice.number, bold, 12);
  page.drawText(number, {
    x: right - bold.widthOfTextAtSize(number, 12),
    y: HEIGHT - MARGIN - 2,
    size: 12,
    font: bold,
    color: INK,
  });
  gap(6);

  const sellerLines = [
    invoice.seller.legalName,
    invoice.seller.tradeName && invoice.seller.tradeName !== invoice.seller.legalName
      ? invoice.seller.tradeName
      : null,
    invoice.seller.address,
    invoice.seller.tradeLicense ? `Trade license ${invoice.seller.tradeLicense}` : null,
    invoice.seller.taxNumber
      ? `${invoice.seller.taxNumberLabel} ${invoice.seller.taxNumber}`
      : null,
  ].filter((line): line is string => Boolean(line));
  for (const line of sellerLines) text(line, { size: 10, color: MUTED, width: contentWidth - 140 });
  gap(8);

  text("Bill to", { size: 9, face: bold, color: MUTED });
  const buyerLines = [
    invoice.buyer.name,
    invoice.buyer.company,
    invoice.buyer.taxNumber ? `Tax number ${invoice.buyer.taxNumber}` : null,
    invoice.buyer.address,
  ].filter((line): line is string => Boolean(line && drawable(line, font).trim()));
  if (buyerLines.length) {
    for (const line of buyerLines) text(line, { size: 11 });
  } else {
    text("Not provided", { size: 11, color: MUTED });
  }
  gap(8);
  text(
    [
      `Order ${invoice.orderNumber}`,
      invoice.marketplace,
      `Purchased ${longDate(invoice.purchasedOn)}`,
      `Invoice date ${longDate(invoice.invoiceDate)}`,
    ].join("  ·  "),
    { size: 9, color: MUTED },
  );
  gap(8);
  ensure(8);
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: right, y },
    thickness: 0.6,
    color: RULE,
  });
  gap(14);

  const qtyX = MARGIN + 360;
  const drawRow = (title: string, qty: string, amount: string, face: PDFFont, color = INK) => {
    const size = 10;
    const titleLines = wrap(title, face, size, 330);
    ensure(titleLines.length * (size + 3) + 2);
    const top = y;
    for (const line of titleLines) {
      if (line) page.drawText(line, { x: MARGIN, y, size, font: face, color });
      y -= size + 3;
    }
    const amountText = drawable(amount, face, size);
    page.drawText(drawable(qty, face, size), { x: qtyX, y: top, size, font: face, color });
    page.drawText(amountText, {
      x: right - face.widthOfTextAtSize(amountText, size),
      y: top,
      size,
      font: face,
      color,
    });
  };

  drawRow("Item", "Qty", "Amount", bold, MUTED);
  gap(4);
  for (const line of invoice.lines) {
    const detail = line.sku && line.sku !== line.title ? `${line.title} · ${line.sku}` : line.title;
    drawRow(detail, String(line.quantity), money(line.amount, invoice.currency), font);
    gap(2);
  }

  gap(6);
  ensure(8);
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: right, y },
    thickness: 0.6,
    color: RULE,
  });
  gap(14);

  const totalRow = (label: string, amount: string, face = font) => {
    const size = 10;
    ensure(size + 6);
    page.drawText(drawable(label, face, size), {
      x: MARGIN + 250,
      y,
      size,
      font: face,
      color: INK,
    });
    const value = drawable(amount, face, size);
    page.drawText(value, {
      x: right - face.widthOfTextAtSize(value, size),
      y,
      size,
      font: face,
      color: INK,
    });
    y -= size + 5;
  };

  if (invoice.shipping) totalRow("Shipping", money(invoice.shipping, invoice.currency));
  if (invoice.discounts) totalRow("Discounts", money(invoice.discounts, invoice.currency, true));
  if (invoice.tax) totalRow(invoice.tax.label, money(invoice.tax.amount, invoice.currency));
  totalRow("Order total", money(invoice.total, invoice.currency), bold);
  if (invoice.refunded) {
    totalRow("Refunded", money(invoice.refunded, invoice.currency, true));
    gap(4);
    text("This order was refunded in whole or in part. This invoice shows what was ordered.", {
      size: 9,
      color: MUTED,
    });
  }
  if (invoice.registrationNote) {
    gap(6);
    text(invoice.registrationNote, { size: 9, color: MUTED });
  }
  gap(14);
  text(invoice.paymentNote, { size: 9, color: MUTED });

  return doc.save();
}
