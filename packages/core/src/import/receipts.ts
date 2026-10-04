/**
 * Receipts exported from other software as files named by date and merchant, the way Wave names
 * them ("2025-02-01-Sizzler_Kabab.jpg"). The date and name are used to find the transaction a
 * receipt belongs to.
 */

export type ReceiptFileInfo = { date: string | null; words: string[] };

const STOP_WORDS = new Set([
  "the",
  "and",
  "inc",
  "ltd",
  "llc",
  "corp",
  "co",
  "of",
  "receipt",
  "img",
  "scan",
]);

/** Lower-case words of three or more letters or digits, without common filler. */
export function matchWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)),
    ),
  ];
}

/** The date and merchant words in a receipt's file name. */
export function parseReceiptFileName(fileName: string): ReceiptFileInfo {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const m = /^(\d{4})-(\d{2})-(\d{2})[-_ ]?(.*)$/.exec(base);
  if (!m) return { date: null, words: matchWords(base) };
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const valid = !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
  return { date: valid ? date : null, words: matchWords(m[4] ?? "") };
}

export type ReceiptCandidate = {
  id: string;
  date: string;
  /** Description and customer or vendor name, searched for the receipt's words. */
  text: string;
};

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * The transaction a receipt belongs to: the closest in date (within `windowDays`) sharing the
 * most words with its name. Null when nothing shares a word, or two candidates tie, so a receipt
 * is never attached to the wrong transaction (it goes to the inbox instead).
 */
export function matchReceipt(
  receipt: ReceiptFileInfo,
  candidates: readonly ReceiptCandidate[],
  windowDays = 3,
): string | null {
  if (!receipt.date || !receipt.words.length) return null;
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const c of candidates) {
    const days = dayDiff(receipt.date, c.date);
    if (days > windowDays) continue;
    const words = new Set(matchWords(c.text));
    const shared = receipt.words.filter((w) => words.has(w)).length;
    if (!shared) continue;
    // Shared words count most; closeness in days breaks ties.
    const score = shared * 10 - days;
    if (!best || score > best.score) {
      best = { id: c.id, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  return best && !tie ? best.id : null;
}
