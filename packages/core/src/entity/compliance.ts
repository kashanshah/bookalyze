import { type FiscalYearConfig, fiscalYearFor, type IsoDate } from "../fiscal";
import type { ComplianceRecurrence } from "./registry";

/**
 * The compliance calendar: what each company has to file or renew, and when. Items come from
 * - rules for where the company is incorporated (Canada: T2 return and balance, annual return;
 *   UAE: corporate tax return once registered),
 * - its sales tax registrations (one return per filing period),
 * - licenses and documents with an expiry date,
 * - items someone added by hand, optionally repeating.
 * Nothing here is stored: the calendar is worked out from the company's details each time, and
 * only "done" ticks and sent reminders are kept (by item key and due date).
 *
 * The rules give the usual deadline. They're a reminder, not advice: special cases (a CCPC's
 * longer payment window, a filing extension) are mentioned in the hint where they matter.
 */

export type ComplianceSource = "rule" | "tax" | "document" | "custom";

export type ComplianceItem = {
  /** Stable for every occurrence of the same obligation, e.g. "rule:ca_t2". */
  key: string;
  title: string;
  dueDate: IsoDate;
  source: ComplianceSource;
  /** One plain sentence on what it is or where it's filed. */
  hint?: string;
  /** The record it comes from (custom item, document, identifier or tax registration). */
  refId?: string;
};

export type ComplianceInput = {
  country: string;
  entityType: string;
  jurisdiction: string | null;
  incorporationDate: IsoDate | null;
  fiscal: FiscalYearConfig;
  taxRegistrations: readonly {
    id: string;
    authority: string;
    filingFrequency: "monthly" | "quarterly" | "annual";
    effectiveFrom: IsoDate | null;
    isActive: boolean;
  }[];
  identifiers: readonly { id: string; kind: string; label: string; expiresOn: IsoDate | null }[];
  documents: readonly { id: string; title: string; expiresOn: IsoDate | null }[];
  custom: readonly {
    id: string;
    title: string;
    notes: string | null;
    firstDue: IsoDate;
    recurrence: ComplianceRecurrence;
  }[];
};

// --- dates ---------------------------------------------------------------------------------

const parse = (d: IsoDate) => ({ y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) });
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fmt = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function addDaysIso(date: IsoDate, days: number): IsoDate {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * `months` after `date`. A month end stays a month end (Jan 31 + 1 → Feb 28), which is how
 * "within six months after the year end" deadlines are counted; other days are clamped.
 */
export function addMonthsIso(date: IsoDate, months: number): IsoDate {
  const { y, m, d } = parse(date);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  const monthEnd = d === daysIn(y, m);
  return fmt(ty, tm, monthEnd ? daysIn(ty, tm) : Math.min(d, daysIn(ty, tm)));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parse(from);
  const b = parse(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** Fiscal year ends from the year before `from` up to `to`. */
function fiscalYearEnds(fiscal: FiscalYearConfig, from: IsoDate, to: IsoDate): IsoDate[] {
  const ends: IsoDate[] = [];
  let end = fiscalYearFor(addMonthsIso(from, -24), { ...fiscal, firstFiscalYearStart: null }).end;
  while (end <= to) {
    ends.push(end);
    end = fiscalYearFor(addDaysIso(end, 1), { ...fiscal, firstFiscalYearStart: null }).end;
  }
  return ends;
}

/** Anniversaries of `date` (same month and day) from the year before `from` up to `to`. */
function anniversaries(date: IsoDate, from: IsoDate, to: IsoDate): IsoDate[] {
  const { m, d } = parse(date);
  const out: IsoDate[] = [];
  for (let y = parse(from).y - 1; y <= parse(to).y; y++) {
    const day = fmt(y, m, Math.min(d, daysIn(y, m)));
    if (day > date) out.push(day);
  }
  return out;
}

// --- rules ---------------------------------------------------------------------------------

function canadaRules(input: ComplianceInput, from: IsoDate, to: IsoDate): ComplianceItem[] {
  if (input.country !== "CA" || input.entityType !== "corporation") return [];
  const items: ComplianceItem[] = [];
  const started = input.incorporationDate ?? input.fiscal.firstFiscalYearStart ?? null;
  for (const yearEnd of fiscalYearEnds(input.fiscal, from, to)) {
    if (started && yearEnd < started) continue;
    items.push(
      {
        key: "rule:ca_t2_balance",
        title: "Pay corporate income tax owing (T2 balance)",
        dueDate: addMonthsIso(yearEnd, 2),
        source: "rule",
        hint: "Two months after the year end; three for a Canadian-controlled private corporation claiming the small business deduction.",
      },
      {
        key: "rule:ca_t2",
        title: "File the T2 corporate income tax return",
        dueDate: addMonthsIso(yearEnd, 6),
        source: "rule",
        hint: "Six months after the year end, with the CRA.",
      },
    );
  }
  const filer =
    input.jurisdiction === "CA-FED"
      ? { key: "rule:ca_federal_annual_return", where: "Corporations Canada" }
      : input.jurisdiction === "CA-ON"
        ? { key: "rule:ca_on_annual_return", where: "the Ontario Business Registry" }
        : null;
  if (filer && input.incorporationDate) {
    for (const anniversary of anniversaries(input.incorporationDate, from, to)) {
      items.push({
        key: filer.key,
        title: "File the annual return",
        dueDate: addDaysIso(anniversary, 60),
        source: "rule",
        hint: `With ${filer.where}, within 60 days after the anniversary of incorporation.`,
      });
    }
  }
  return items;
}

function uaeRules(input: ComplianceInput, from: IsoDate, to: IsoDate): ComplianceItem[] {
  if (input.country !== "AE") return [];
  if (!input.identifiers.some((i) => i.kind === "ae_ct_trn")) return [];
  return fiscalYearEnds(input.fiscal, from, to)
    .filter((end) => !input.incorporationDate || end >= input.incorporationDate)
    .map((yearEnd) => ({
      key: "rule:ae_corporate_tax",
      title: "File the corporate tax return and pay",
      dueDate: addMonthsIso(yearEnd, 9),
      source: "rule" as const,
      hint: "With the Federal Tax Authority, nine months after the year end.",
    }));
}

/** One return per filing period of each active sales tax registration. */
function salesTaxReturns(input: ComplianceInput, from: IsoDate, to: IsoDate): ComplianceItem[] {
  const items: ComplianceItem[] = [];
  const uae = input.country === "AE";
  for (const reg of input.taxRegistrations) {
    if (!reg.isActive) continue;
    const periodEnds: IsoDate[] = [];
    if (reg.filingFrequency === "annual") {
      periodEnds.push(...fiscalYearEnds(input.fiscal, from, to));
    } else {
      const step = reg.filingFrequency === "monthly" ? 1 : 3;
      // Quarters follow the fiscal year: start from a fiscal year end and step forward.
      let end = fiscalYearEnds(input.fiscal, from, to)[0] ?? from;
      if (step === 1) end = fmt(parse(end).y, parse(end).m, daysIn(parse(end).y, parse(end).m));
      while (end <= to) {
        periodEnds.push(end);
        end = addMonthsIso(end, step);
      }
    }
    for (const periodEnd of periodEnds) {
      if (reg.effectiveFrom && periodEnd < reg.effectiveFrom) continue;
      const dueDate = uae
        ? addDaysIso(periodEnd, 28)
        : reg.filingFrequency === "annual"
          ? addMonthsIso(periodEnd, 3)
          : addMonthsIso(periodEnd, 1);
      items.push({
        key: `tax:${reg.id}`,
        title: `File the ${reg.authority} return`,
        dueDate,
        source: "tax",
        refId: reg.id,
        hint: uae
          ? "VAT return and payment, 28 days after the period ends."
          : reg.filingFrequency === "annual"
            ? "Annual filer: three months after the year end."
            : "One month after the period ends.",
      });
    }
  }
  return items;
}

function expiries(input: ComplianceInput): ComplianceItem[] {
  const items: ComplianceItem[] = [];
  for (const id of input.identifiers) {
    if (!id.expiresOn) continue;
    items.push({
      key: `identifier:${id.id}`,
      title: id.kind === "ae_trade_license" ? "Renew the trade license" : `Renew ${id.label}`,
      dueDate: id.expiresOn,
      source: "document",
      refId: id.id,
      hint: "It expires on this date. Renewals can usually start a month before.",
    });
  }
  for (const doc of input.documents) {
    if (!doc.expiresOn) continue;
    items.push({
      key: `document:${doc.id}`,
      title: `${doc.title} expires`,
      dueDate: doc.expiresOn,
      source: "document",
      refId: doc.id,
    });
  }
  return items;
}

function customItems(input: ComplianceInput, to: IsoDate): ComplianceItem[] {
  const step = { once: 0, monthly: 1, quarterly: 3, yearly: 12 } as const;
  const items: ComplianceItem[] = [];
  for (const c of input.custom) {
    let due = c.firstDue;
    for (let i = 0; due <= to && i < 600; i++) {
      items.push({
        key: `custom:${c.id}`,
        title: c.title,
        dueDate: due,
        source: "custom",
        refId: c.id,
        ...(c.notes ? { hint: c.notes } : {}),
      });
      if (!step[c.recurrence]) break;
      due = addMonthsIso(c.firstDue, step[c.recurrence] * (i + 1));
    }
  }
  return items;
}

/** Everything due from `from` to `to` (inclusive), soonest first. */
export function complianceCalendar(
  input: ComplianceInput,
  from: IsoDate,
  to: IsoDate,
): ComplianceItem[] {
  return [
    ...canadaRules(input, from, to),
    ...uaeRules(input, from, to),
    ...salesTaxReturns(input, from, to),
    ...expiries(input),
    ...customItems(input, to),
  ]
    .filter((item) => item.dueDate >= from && item.dueDate <= to)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
}

/** "rule:ca_t2|2027-06-30": what a "done" tick or a sent reminder is stored under. */
export const occurrenceKey = (item: Pick<ComplianceItem, "key" | "dueDate">) =>
  `${item.key}|${item.dueDate}`;

/**
 * Which reminder (lead time in days) to send today for an item, if any: the smallest lead time
 * that has arrived and wasn't sent yet. Overdue items get none; the calendar shows them.
 */
export function reminderDue(
  dueDate: IsoDate,
  today: IsoDate,
  leadDays: readonly number[],
  sent: ReadonlySet<number>,
): number | null {
  const left = daysBetween(today, dueDate);
  if (left < 0) return null;
  const arrived = leadDays.filter((lead) => left <= lead).sort((a, b) => a - b);
  const smallest = arrived[0];
  if (smallest === undefined || sent.has(smallest)) return null;
  return smallest;
}
