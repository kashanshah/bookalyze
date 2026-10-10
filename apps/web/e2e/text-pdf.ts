// A one-page PDF of positioned text in Helvetica, for end-to-end tests that upload PDFs.

export type PdfText = { text: string; x: number; y: number; right?: boolean };

// Helvetica widths (per 1000 units) for what the tests print, to right-align numbers.
const WIDTH: Record<string, number> = { ",": 278, ".": 278, "(": 333, ")": 333, " ": 278 };
const widthOf = (t: string, size: number) =>
  [...t].reduce((w, c) => w + (WIDTH[c] ?? (/[0-9$]/.test(c) ? 556 : 560)), 0) * (size / 1000);

const escapePdf = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);

export function textPdf(
  texts: readonly PdfText[],
  page: { size: number; width: number; height: number },
): Buffer {
  const content = texts
    .map((t) => {
      const x = t.right ? t.x - widthOf(t.text, page.size) : t.x;
      return `BT /F1 ${page.size} Tf 1 0 0 1 ${x.toFixed(2)} ${t.y} Tm (${escapePdf(t.text)}) Tj ET`;
    })
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
