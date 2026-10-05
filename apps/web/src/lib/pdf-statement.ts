import { type PdfStatementRead, type PdfTextItem, readPdfStatement } from "@bookalyze/core";

/**
 * Reads a bank's PDF statement in the browser: pdf.js gives each page's text with its position,
 * and core `readPdfStatement` rebuilds the transactions from it. The file isn't uploaded.
 */
export async function readPdfStatementFile(file: File): Promise<PdfStatementRead> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const items: PdfTextItem[] = [];
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      items.push({
        text: item.str,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        width: item.width,
        page,
      });
    }
  }
  return readPdfStatement(items);
}
