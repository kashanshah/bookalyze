/**
 * A company's brand on the documents it sends: logo, accent colour, footer, an Arabic name, and
 * optionally a full-page letterhead the document is printed on. Each company sets its own on
 * Company → Brand; documents without one use the neutral defaults below.
 */

/** Points: 72 to the inch. A4 is 595 × 842. */
export const LETTERHEAD_MARGIN_MAX = 300;
/** A comfortable default for a letterhead with a header band and a footer strip. */
export const DEFAULT_LETTERHEAD_MARGINS = { top: 120, bottom: 72 } as const;

export const LETTERHEAD_PAGES = ["first", "all"] as const;
export type LetterheadPages = (typeof LETTERHEAD_PAGES)[number];

/** The ink used when a company hasn't picked a colour: a deep slate that prints well. */
export const DEFAULT_ACCENT = "#1F2937";

export const BRAND_FOOTER_MAX = 600;
export const BRAND_NAME_MAX = 200;

/** Logo and letterhead files a document can draw. HEIC and WebP can't be embedded in a PDF. */
export const BRAND_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;
export const LETTERHEAD_TYPES = ["application/pdf", ...BRAND_IMAGE_TYPES] as const;

export type BrandSettings = {
  /** "#RRGGBB", or null for the default. */
  accentColor: string | null;
  /** Bank details, payment terms or a thank-you line, printed at the bottom of every page. */
  footer: string | null;
  /** The company name in Arabic, printed under the English name. */
  nameArabic: string | null;
  /** Shown top-left, unless a letterhead is set (the letterhead carries its own logo). */
  logoAttachmentId: string | null;
  letterheadAttachmentId: string | null;
  /** The space the letterhead's header and footer take, kept free of content. */
  letterheadTop: number;
  letterheadBottom: number;
  letterheadPages: LetterheadPages;
};

export const EMPTY_BRAND: BrandSettings = {
  accentColor: null,
  footer: null,
  nameArabic: null,
  logoAttachmentId: null,
  letterheadAttachmentId: null,
  letterheadTop: DEFAULT_LETTERHEAD_MARGINS.top,
  letterheadBottom: DEFAULT_LETTERHEAD_MARGINS.bottom,
  letterheadPages: "first",
};

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** "#1f2937", "1F2937" or "#123" as "#1F2937" / "#112233", or null when it isn't a colour. */
export function normalizeHexColor(value: string | null | undefined): string | null {
  const match = HEX.exec(value?.trim() ?? "");
  if (!match?.[1]) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return `#${hex.toUpperCase()}`;
}

/** The colour as 0–1 channels, for a PDF. Falls back to the default accent. */
export function hexToRgb(value: string | null | undefined): { r: number; g: number; b: number } {
  const hex = normalizeHexColor(value) ?? DEFAULT_ACCENT;
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/**
 * Whether white text reads on this colour (WCAG relative luminance). Used for the table header
 * band, so a pale accent gets dark text instead.
 */
export function isDarkColor(value: string | null | undefined): boolean {
  const { r, g, b } = hexToRgb(value);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance < 0.4;
}

/** Margins clamped to what fits on a page with room left for the document. */
export function clampLetterheadMargin(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(LETTERHEAD_MARGIN_MAX, Math.max(0, Math.round(value)));
}
