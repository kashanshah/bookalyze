import "server-only";
import {
  csvAmount,
  DEFAULT_LOGO_HEIGHT,
  formatDecimal,
  hexToRgb,
  isDarkColor,
  type OrderInvoice,
  parseDecimal,
} from "@bookalyze/core";
import { type PDFDocument as Doc, PDFDocument, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import type { DocumentBrand } from "./brand";
import { drawable, drawLine, embedFaces, type Face, widthOf, wrap } from "./pdf-text";

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 48;
const INK = rgb(0.11, 0.13, 0.16);
const MUTED = rgb(0.4, 0.42, 0.46);
const RULE = rgb(0.86, 0.87, 0.9);
const PANEL = rgb(0.965, 0.969, 0.976);
const WHITE = rgb(1, 1, 1);

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

const NO_BRAND: DocumentBrand = {
  accentColor: null,
  footer: null,
  nameArabic: null,
  logoHeight: DEFAULT_LOGO_HEIGHT,
  letterheadTop: 0,
  letterheadBottom: 0,
  letterheadLeft: MARGIN,
  letterheadRight: MARGIN,
  letterheadPages: "first",
  logo: null,
  letterhead: null,
};

type Background =
  | { kind: "pdf"; page: Awaited<ReturnType<Doc["embedPdf"]>>[number] }
  | { kind: "image"; image: PDFImage };

async function embedImage(doc: Doc, file: { bytes: Uint8Array; contentType: string }) {
  return file.contentType === "image/png" ? doc.embedPng(file.bytes) : doc.embedJpg(file.bytes);
}

/** The letterhead as something every page can draw, or null when it can't be read. */
async function embedLetterhead(doc: Doc, brand: DocumentBrand): Promise<Background | null> {
  const file = brand.letterhead;
  if (!file) return null;
  try {
    if (file.contentType === "application/pdf") {
      const [page] = await doc.embedPdf(file.bytes, [0]);
      return page ? { kind: "pdf", page } : null;
    }
    return { kind: "image", image: await embedImage(doc, file) };
  } catch {
    // A damaged or encrypted file: the invoice is still issued, on a plain page.
    return null;
  }
}

/** Fits a box inside max width × height, keeping its shape. */
function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: width * scale, height: height * scale };
}

/**
 * A customer invoice as a PDF, in the company's brand: its logo (or full letterhead), accent
 * colour, Arabic name and footer. Helvetica for Latin text, Noto Sans Arabic for Arabic (see
 * pdf-text.ts). Invoices saved before newer fields existed (unit prices, shipping discounts)
 * still render: those parts are left out.
 */
export async function renderOrderInvoicePdf(
  invoice: OrderInvoice,
  brand: DocumentBrand = NO_BRAND,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { regular: font, bold } = await embedFaces(doc);
  doc.setTitle(invoice.number);
  doc.setAuthor(invoice.seller.legalName || "Invoice");
  doc.setCreator("Bookalyze");

  const accentRgb = hexToRgb(brand.accentColor);
  const ACCENT = rgb(accentRgb.r, accentRgb.g, accentRgb.b);
  const onAccent = isDarkColor(brand.accentColor) ? WHITE : INK;
  // A pale accent still fills bands, but text in it would be hard to read on white.
  const accentText = onAccent === WHITE ? ACCENT : INK;
  const letterhead = await embedLetterhead(doc, brand);
  const logo =
    brand.logo && !letterhead ? await embedImage(doc, brand.logo).catch(() => null) : null;

  // A letterhead may have a side band; its side margins then hold on every page, so the
  // columns line up from page to page.
  const left = letterhead ? brand.letterheadLeft : MARGIN;
  const right = WIDTH - (letterhead ? brand.letterheadRight : MARGIN);
  const contentWidth = right - left;
  const footerLines = (brand.footer ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  /** Room the footer (brand lines and page number) needs above the bottom margin. */
  const footerSpace = 18 + footerLines.length * 10;
  const pages: PDFPage[] = [];
  let page = undefined as unknown as PDFPage;
  let y = 0;
  let bottom = MARGIN;

  /** Starts a page: draws the letterhead when it applies and sets the safe area. */
  const newPage = () => {
    page = doc.addPage([WIDTH, HEIGHT]);
    pages.push(page);
    const withLetterhead = letterhead && (pages.length === 1 || brand.letterheadPages === "all");
    if (withLetterhead) {
      if (letterhead.kind === "pdf") {
        page.drawPage(letterhead.page, { x: 0, y: 0, width: WIDTH, height: HEIGHT });
      } else {
        page.drawImage(letterhead.image, { x: 0, y: 0, width: WIDTH, height: HEIGHT });
      }
      y = HEIGHT - Math.max(brand.letterheadTop, 24);
      bottom = Math.max(brand.letterheadBottom, 24) + footerSpace;
    } else {
      y = HEIGHT - MARGIN;
      bottom = MARGIN + footerSpace - 18;
    }
  };
  newPage();

  const ensure = (height: number) => {
    if (y - height >= bottom) return false;
    newPage();
    return true;
  };

  const text = (
    value: string,
    options: { x?: number; size?: number; face?: Face; color?: typeof INK; width?: number } = {},
  ) => {
    const size = options.size ?? 10;
    const face = options.face ?? font;
    const lines = wrap(value, face, size, options.width ?? contentWidth);
    for (const line of lines) {
      ensure(size + 3);
      if (line)
        drawLine(page, line, {
          x: options.x ?? left,
          y,
          size,
          face,
          color: options.color ?? INK,
        });
      y -= size + 3;
    }
  };

  const rightText = (value: string, atY: number, size: number, face: Face, color = INK) =>
    drawLine(page, value, { x: right - widthOf(value, face, size), y: atY, size, face, color });

  // --- header ---------------------------------------------------------------------------------
  const headerTop = y;
  const titleSize = 24;
  const title = invoice.title.toUpperCase();
  rightText(title, headerTop - titleSize + 4, titleSize, bold, accentText);
  let rightY = headerTop - titleSize - 14;
  if (invoice.titleArabic) {
    rightText(invoice.titleArabic, rightY, 12, bold, accentText);
    rightY -= 20;
  }
  rightText(invoice.number, rightY, 11, bold, INK);
  rightY -= 14;

  const leftWidth = contentWidth - 200;
  // Text is drawn on its baseline, so the first line starts about a cap height lower.
  const capHeight = (size: number) => size * 0.72;
  if (logo) {
    // The height is the company's choice; a very wide logo is capped at the left column.
    const box = fitWithin(logo.width, logo.height, leftWidth, brand.logoHeight);
    page.drawImage(logo, {
      x: left,
      y: headerTop - box.height,
      width: box.width,
      height: box.height,
    });
    y = headerTop - box.height - 16 - capHeight(12);
  } else {
    y = headerTop - capHeight(12);
  }
  text(invoice.seller.legalName, { size: 12, face: bold, width: leftWidth });
  y -= 2;
  if (brand.nameArabic?.trim())
    text(brand.nameArabic.trim(), { size: 11, face: bold, width: leftWidth });
  const sellerLines = [
    invoice.seller.tradeName && invoice.seller.tradeName !== invoice.seller.legalName
      ? invoice.seller.tradeName
      : null,
    ...(invoice.seller.address ?? "").split(/\r?\n/),
    invoice.seller.tradeLicense ? `Trade licence ${invoice.seller.tradeLicense}` : null,
    invoice.seller.taxNumber
      ? `${invoice.seller.taxNumberLabel} ${invoice.seller.taxNumber}`
      : null,
  ].filter((line): line is string => Boolean(line?.trim()));
  // Below the title block on the right, the seller's lines can run wider.
  const sellerWidth = () => (y < rightY - 4 ? contentWidth * 0.72 : leftWidth);
  for (const line of sellerLines)
    text(line.trim(), { size: 9.5, color: MUTED, width: sellerWidth() });
  y = Math.min(y, rightY) - 10;

  ensure(4);
  page.drawRectangle({ x: left, y, width: contentWidth, height: 2, color: ACCENT });
  y -= 26;

  // --- bill to and details --------------------------------------------------------------------
  const blockTop = y;
  const detailsX = left + contentWidth * 0.55;
  const detailsWidth = right - detailsX;
  text("BILL TO", { size: 8, face: bold, color: MUTED, width: detailsX - left - 16 });
  y -= 2;
  const buyerLines = [
    invoice.buyer.name,
    invoice.buyer.company,
    invoice.buyer.taxNumber ? `Tax number ${invoice.buyer.taxNumber}` : null,
    ...(invoice.buyer.address ?? "").split(/\r?\n/),
  ].filter((line): line is string => Boolean(line && drawable(line, font).trim()));
  if (buyerLines.length) {
    buyerLines.forEach((line, index) => {
      text(line.trim(), {
        size: index === 0 ? 11 : 9.5,
        face: index === 0 ? bold : font,
        color: index === 0 ? INK : MUTED,
        width: detailsX - left - 16,
      });
    });
  } else {
    text("Not provided", { size: 10, color: MUTED });
  }
  const leftBottom = y;

  const details: [string, string][] = [
    ["Invoice date", longDate(invoice.invoiceDate)],
    ["Order", invoice.orderNumber],
    ["Marketplace", invoice.marketplace],
    ["Purchased", longDate(invoice.purchasedOn)],
  ];
  const rowHeight = 15;
  const panelHeight = details.length * rowHeight + 12;
  page.drawRectangle({
    x: detailsX - 10,
    y: blockTop - panelHeight + 10,
    width: detailsWidth + 10,
    height: panelHeight,
    color: PANEL,
  });
  details.forEach(([label, value], index) => {
    const rowY = blockTop - index * rowHeight - 2;
    drawLine(page, label, { x: detailsX, y: rowY, size: 9, face: font, color: MUTED });
    drawLine(page, value, {
      x: right - 10 - widthOf(value, bold, 9),
      y: rowY,
      size: 9,
      face: bold,
      color: INK,
    });
  });
  y = Math.min(leftBottom, blockTop - panelHeight) - 18;

  // --- items ----------------------------------------------------------------------------------
  const qtyRight = left + contentWidth * 0.66;
  const unitRight = left + contentWidth * 0.83;
  const descWidth = contentWidth * 0.66 - 50;
  const headerRow = () => {
    ensure(22);
    page.drawRectangle({ x: left, y: y - 7, width: contentWidth, height: 21, color: ACCENT });
    const size = 8.5;
    drawLine(page, "DESCRIPTION", { x: left + 8, y, size, face: bold, color: onAccent });
    const qty = "QTY";
    drawLine(page, qty, {
      x: qtyRight - widthOf(qty, bold, size),
      y,
      size,
      face: bold,
      color: onAccent,
    });
    const unit = "UNIT PRICE";
    drawLine(page, unit, {
      x: unitRight - widthOf(unit, bold, size),
      y,
      size,
      face: bold,
      color: onAccent,
    });
    const amount = "AMOUNT";
    drawLine(page, amount, {
      x: right - 8 - widthOf(amount, bold, size),
      y,
      size,
      face: bold,
      color: onAccent,
    });
    y -= 26;
  };
  headerRow();

  let subtotal = 0n;
  for (const line of invoice.lines) {
    subtotal += parseDecimal(line.amount);
    const size = 9.5;
    const titleLines = wrap(line.title, font, size, descWidth);
    const height = titleLines.length * (size + 3) + (line.sku ? 11 : 0) + 8;
    if (ensure(height)) headerRow();
    const top = y;
    for (const part of titleLines) {
      if (part) drawLine(page, part, { x: left + 8, y, size, face: font, color: INK });
      y -= size + 3;
    }
    if (line.sku) {
      drawLine(page, `SKU ${line.sku}`, { x: left + 8, y, size: 8, face: font, color: MUTED });
      y -= 11;
    }
    const qty = String(line.quantity);
    drawLine(page, qty, {
      x: qtyRight - widthOf(qty, font, size),
      y: top,
      size,
      face: font,
      color: INK,
    });
    if (line.unitPrice) {
      const unit = money(line.unitPrice, invoice.currency);
      drawLine(page, unit, {
        x: unitRight - widthOf(unit, font, size),
        y: top,
        size,
        face: font,
        color: INK,
      });
    }
    const amount = money(line.amount, invoice.currency);
    drawLine(page, amount, {
      x: right - 8 - widthOf(amount, font, size),
      y: top,
      size,
      face: font,
      color: INK,
    });
    y -= 4;
    page.drawLine({
      start: { x: left, y: y + 2 },
      end: { x: right, y: y + 2 },
      thickness: 0.5,
      color: RULE,
    });
    y -= 10;
  }

  // --- totals ---------------------------------------------------------------------------------
  const labelX = left + contentWidth * 0.55;
  const totalRow = (label: string, amount: string, emphasis = false) => {
    const size = emphasis ? 11 : 9.5;
    if (emphasis) {
      ensure(26);
      page.drawRectangle({
        x: labelX - 10,
        y: y - 8,
        width: right - labelX + 10,
        height: 24,
        color: ACCENT,
      });
      drawLine(page, label, { x: labelX, y, size, face: bold, color: onAccent });
      drawLine(page, amount, {
        x: right - 8 - widthOf(amount, bold, size),
        y,
        size,
        face: bold,
        color: onAccent,
      });
      y -= 28;
      return;
    }
    ensure(size + 7);
    drawLine(page, label, { x: labelX, y, size, face: font, color: MUTED });
    drawLine(page, amount, {
      x: right - 8 - widthOf(amount, font, size),
      y,
      size,
      face: font,
      color: INK,
    });
    y -= size + 7;
  };

  y -= 2;
  totalRow("Subtotal", money(formatDecimal(subtotal), invoice.currency));
  if (invoice.shipping) totalRow("Shipping", money(invoice.shipping, invoice.currency));
  if (invoice.shippingDiscount) {
    totalRow("Shipping discount", money(invoice.shippingDiscount, invoice.currency, true));
  }
  if (invoice.discounts) totalRow("Discounts", money(invoice.discounts, invoice.currency, true));
  if (invoice.tax) totalRow(invoice.tax.label, money(invoice.tax.amount, invoice.currency));
  y -= 4;
  totalRow("Total", money(invoice.total, invoice.currency), true);
  if (invoice.refunded) {
    totalRow("Refunded", money(invoice.refunded, invoice.currency, true));
    y -= 2;
    text("This order was refunded in whole or in part. This invoice shows what was ordered.", {
      size: 8.5,
      color: MUTED,
    });
  }

  // --- notes ----------------------------------------------------------------------------------
  y -= 10;
  if (invoice.registrationNote) text(invoice.registrationNote, { size: 8.5, color: MUTED });
  text(invoice.paymentNote, { size: 8.5, color: MUTED });

  // --- footer on every page -------------------------------------------------------------------
  pages.forEach((p, index) => {
    const withLetterhead = letterhead && (index === 0 || brand.letterheadPages === "all");
    const base = withLetterhead ? Math.max(brand.letterheadBottom, 24) + 6 : MARGIN - 18;
    const pageLabel = pages.length > 1 ? `Page ${index + 1} of ${pages.length}` : "";
    let lineY = base + 10 * footerLines.length;
    if (footerLines.length) {
      p.drawLine({
        start: { x: left, y: lineY + 8 },
        end: { x: right, y: lineY + 8 },
        thickness: 0.5,
        color: RULE,
      });
    }
    for (const line of footerLines) {
      const lines = wrap(line, font, 8, contentWidth - 80);
      const first = lines[0] ?? "";
      drawLine(p, first, { x: left, y: lineY, size: 8, face: font, color: MUTED });
      lineY -= 10;
    }
    if (pageLabel) {
      drawLine(p, pageLabel, {
        x: right - widthOf(pageLabel, font, 8),
        y: base,
        size: 8,
        face: font,
        color: MUTED,
      });
    }
  });

  return doc.save();
}
