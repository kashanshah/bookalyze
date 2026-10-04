/**
 * A small, forgiving CSV reader for exports from other accounting software: quoted fields with
 * commas and line breaks, doubled quotes, a byte-order mark, Windows line endings, and comma,
 * semicolon or tab delimiters (Excel in many European locales saves with semicolons).
 */

export type CsvTable = {
  headers: string[];
  rows: string[][];
  /** Each data row's line number in the file (1-based, counting the header), for messages. */
  lineNumbers: number[];
};

/** The delimiter that splits the first line into the most fields. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/));
  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t", "|"]) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === candidate && !quoted) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Parses CSV text into rows of fields. Blank lines are skipped. */
export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  return parseCsvLines(input, delimiter).rows;
}

/** Rows, plus the line each row starts on in the file (1-based). */
function parseCsvLines(
  input: string,
  delimiter = detectDelimiter(input),
): { rows: string[][]; lines: number[] } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  const lines: number[] = [];
  let line = 1;
  let rowStart = 1;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0]?.trim()) {
      rows.push(row);
      lines.push(rowStart);
    }
    row = [];
    field = "";
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      field = "";
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      endRow();
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line++;
      rowStart = line;
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== "" || row.length) endRow();
  return { rows, lines };
}

/**
 * The header row and the data rows. Exports often start with a title block ("Journal Report",
 * the company name, the date range): the header is taken as the first of the first 15 rows with
 * the most non-empty cells.
 */
export function readCsvTable(input: string): CsvTable {
  const { rows, lines } = parseCsvLines(input);
  let headerIndex = 0;
  let widest = 0;
  rows.slice(0, 15).forEach((row, index) => {
    const filled = row.filter((c) => c.trim()).length;
    if (filled > widest) {
      widest = filled;
      headerIndex = index;
    }
  });
  const headers = (rows[headerIndex] ?? []).map((h) => h.trim());
  const data: string[][] = [];
  const lineNumbers: number[] = [];
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const cells = headers.map((_, c) => (r[c] ?? "").trim());
    if (!cells.some((c) => c)) return;
    data.push(cells);
    lineNumbers.push(lines[headerIndex + 1 + i] ?? headerIndex + i + 2);
  });
  return { headers, rows: data, lineNumbers };
}
