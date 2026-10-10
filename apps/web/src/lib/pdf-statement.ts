import { type PdfStatementRead, readPdfStatement } from "@bookalyze/core";
import { readPdfItems } from "./pdf-items";

/**
 * Reads a bank's PDF statement in the browser: pdf.js gives each page's text with its position,
 * and core `readPdfStatement` rebuilds the transactions from it. The file isn't uploaded.
 */
export async function readPdfStatementFile(file: File): Promise<PdfStatementRead> {
  return readPdfStatement(await readPdfItems(file));
}
