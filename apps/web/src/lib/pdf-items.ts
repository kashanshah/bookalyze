import type { PdfTextItem } from "@bookalyze/core";

/** Each page's text with its position, read in the browser by pdf.js. The file isn't uploaded. */
export async function readPdfItems(file: File): Promise<PdfTextItem[]> {
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
  return items;
}
