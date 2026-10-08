import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import bidiFactory from "bidi-js";
import { type PDFDocument, type PDFFont, type PDFPage, type RGB, StandardFonts } from "pdf-lib";

/**
 * Text for PDFs in any mix of English and Arabic. Latin text uses the standard Helvetica (no
 * file to embed, prints anywhere); Arabic uses Noto Sans Arabic, embedded as a subset so the
 * letters join. Runs are put in reading order with the Unicode bidi algorithm, so an Arabic
 * name inside an English line (or the other way round) reads correctly. Anything neither font
 * has (Chinese, say) is left out rather than failing the PDF.
 */

/** One weight: the Latin font and the Arabic font that go with it. */
export type Face = { latin: PDFFont; arabic: PDFFont };

const bidi = bidiFactory();

/** Fonts ship with the app (SIL Open Font License, see fonts/OFL.txt). */
const FONT_DIR = join(process.cwd(), "src/server/fonts");
const fontFiles = new Map<string, Promise<Buffer>>();
function fontFile(name: string): Promise<Buffer> {
  let file = fontFiles.get(name);
  if (!file) {
    file = readFile(join(FONT_DIR, name));
    fontFiles.set(name, file);
  }
  return file;
}

/** The regular and bold faces for a document. */
export async function embedFaces(doc: PDFDocument): Promise<{ regular: Face; bold: Face }> {
  doc.registerFontkit(fontkit);
  const [arabic, arabicBold] = await Promise.all([
    fontFile("NotoSansArabic-Regular.ttf"),
    fontFile("NotoSansArabic-Bold.ttf"),
  ]);
  return {
    regular: {
      latin: await doc.embedFont(StandardFonts.Helvetica),
      arabic: await doc.embedFont(arabic, { subset: true }),
    },
    bold: {
      latin: await doc.embedFont(StandardFonts.HelveticaBold),
      arabic: await doc.embedFont(arabicBold, { subset: true }),
    },
  };
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

const charsets = new WeakMap<PDFFont, Set<number>>();
function has(font: PDFFont, char: string): boolean {
  let set = charsets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsets.set(font, set);
  }
  return set.has(char.codePointAt(0) ?? 0);
}

/** Which font draws this character, or null when neither has it. */
function fontFor(char: string, face: Face): PDFFont | null {
  if (ARABIC.test(char)) return has(face.arabic, char) ? face.arabic : null;
  if (has(face.latin, char)) return face.latin;
  return has(face.arabic, char) ? face.arabic : null;
}

/** The text the faces can draw (line breaks kept). */
export function drawable(value: string, face: Face): string {
  return Array.from(value)
    .filter((c) => c === "\n" || fontFor(c, face) !== null)
    .join("");
}

type Run = { text: string; font: PDFFont };

/** One line as runs in the order they're drawn, left to right. */
function runs(line: string, face: Face): Run[] {
  const text = drawable(line, face).replace(/\n/g, " ");
  if (!text) return [];
  const { levels } = bidi.getEmbeddingLevels(text);
  const pieces: { text: string; font: PDFFont; level: number }[] = [];
  let unit = 0;
  for (const char of Array.from(text)) {
    const level = levels[unit] ?? 0;
    unit += char.length;
    // A space takes the font of what's around it, so runs don't break at every word.
    const font = char === " " ? (pieces.at(-1)?.font ?? face.latin) : fontFor(char, face);
    if (!font) continue;
    const last = pieces.at(-1);
    if (last && last.font === font && last.level === level) last.text += char;
    else pieces.push({ text: char, font, level });
  }
  // Unicode bidi rule L2: reverse each stretch at or above a level, from the highest level down
  // to the lowest odd one.
  const highest = Math.max(...pieces.map((p) => p.level));
  const lowestOdd = Math.min(...pieces.map((p) => p.level).filter((l) => l % 2 === 1));
  for (let level = highest; level >= lowestOdd; level--) {
    for (let start = 0; start < pieces.length; start++) {
      if ((pieces[start]?.level ?? 0) < level) continue;
      let end = start;
      while (end + 1 < pieces.length && (pieces[end + 1]?.level ?? 0) >= level) end++;
      pieces.splice(start, end - start + 1, ...pieces.slice(start, end + 1).reverse());
      start = end;
    }
  }
  return pieces.map((piece) => {
    // The Arabic font lays its own text out right to left; other right-to-left text (spaces,
    // brackets, punctuation inside Arabic) is reversed here, with brackets mirrored.
    const rtl = piece.level % 2 === 1 && piece.font !== face.arabic;
    return {
      font: piece.font,
      text: rtl
        ? Array.from(piece.text)
            .reverse()
            .map((c) => bidi.getMirroredCharacter(c) ?? c)
            .join("")
        : piece.text,
    };
  });
}

/** How wide a line is at this size. */
export function widthOf(line: string, face: Face, size: number): number {
  return runs(line, face).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
}

/** Draws one line starting at x (its left edge). */
export function drawLine(
  page: PDFPage,
  line: string,
  options: { x: number; y: number; size: number; face: Face; color: RGB },
): void {
  let x = options.x;
  for (const run of runs(line, options.face)) {
    page.drawText(run.text, {
      x,
      y: options.y,
      size: options.size,
      font: run.font,
      color: options.color,
    });
    x += run.font.widthOfTextAtSize(run.text, options.size);
  }
}

/** Splits text into lines that fit the width (at spaces; line breaks kept). */
export function wrap(value: string, face: Face, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of drawable(value, face).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (widthOf(next, face, size) > width && line) {
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
