import { describe, expect, it } from "vitest";
import {
  addMonthsIso,
  type ComplianceInput,
  complianceCalendar,
  reminderDue,
} from "../entity/compliance";

const base: ComplianceInput = {
  country: "CA",
  entityType: "corporation",
  jurisdiction: "CA-ON",
  incorporationDate: "2020-03-15",
  fiscal: { endMonth: 12, endDay: 31 },
  taxRegistrations: [],
  identifiers: [],
  documents: [],
  custom: [],
};
const due = (input: ComplianceInput, from: string, to: string) =>
  complianceCalendar(input, from, to).map((i) => [i.dueDate, i.key]);

describe("addMonthsIso", () => {
  it("keeps month ends and clamps other days", () => {
    expect(addMonthsIso("2026-12-31", 2)).toBe("2027-02-28");
    expect(addMonthsIso("2026-12-31", 6)).toBe("2027-06-30");
    expect(addMonthsIso("2026-08-30", 6)).toBe("2027-02-28");
    expect(addMonthsIso("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("complianceCalendar", () => {
  it("gives an Ontario corporation its T2 balance, T2 return and annual return", () => {
    expect(due(base, "2027-01-01", "2027-12-31")).toEqual([
      ["2027-02-28", "rule:ca_t2_balance"],
      ["2027-05-14", "rule:ca_on_annual_return"],
      ["2027-06-30", "rule:ca_t2"],
    ]);
  });

  it("files a federal annual return with Corporations Canada, and skips years before incorporation", () => {
    const federal = {
      ...base,
      jurisdiction: "CA-FED",
      incorporationDate: "2026-06-01",
      fiscal: { endMonth: 12, endDay: 31, firstFiscalYearStart: "2026-06-01" },
    };
    const items = complianceCalendar(federal, "2026-01-01", "2027-12-31");
    expect(items.map((i) => [i.dueDate, i.key])).toEqual([
      ["2027-02-28", "rule:ca_t2_balance"],
      ["2027-06-30", "rule:ca_t2"],
      ["2027-07-31", "rule:ca_federal_annual_return"],
    ]);
    expect(items[2]?.hint).toMatch(/Corporations Canada/);
  });

  it("adds a sales tax return for each filing period", () => {
    const hst = {
      id: "hst",
      authority: "CRA (GST/HST)",
      filingFrequency: "quarterly" as const,
      effectiveFrom: "2026-01-01",
      isActive: true,
    };
    const quarterly = { ...base, jurisdiction: null, taxRegistrations: [hst] };
    expect(
      complianceCalendar(quarterly, "2026-04-01", "2026-12-31")
        .filter((i) => i.source === "tax")
        .map((i) => i.dueDate),
    ).toEqual(["2026-04-30", "2026-07-31", "2026-10-31"]);
    const annual = {
      ...quarterly,
      taxRegistrations: [{ ...hst, filingFrequency: "annual" as const }],
    };
    expect(
      complianceCalendar(annual, "2027-01-01", "2027-12-31")
        .filter((i) => i.source === "tax")
        .map((i) => i.dueDate),
    ).toEqual(["2027-03-31"]);
  });

  it("puts a Dubai trade license renewal and a corporate tax return on the calendar", () => {
    const dubai: ComplianceInput = {
      ...base,
      country: "AE",
      entityType: "sole_proprietorship",
      jurisdiction: "AE-DU",
      incorporationDate: "2025-11-10",
      identifiers: [
        { id: "lic", kind: "ae_trade_license", label: "Trade license", expiresOn: "2026-11-09" },
        { id: "ct", kind: "ae_ct_trn", label: "CT TRN", expiresOn: null },
      ],
    };
    expect(due(dubai, "2026-01-01", "2026-12-31")).toEqual([
      ["2026-09-30", "rule:ae_corporate_tax"],
      ["2026-11-09", "identifier:lic"],
    ]);
  });

  it("repeats items added by hand and shows expiring documents", () => {
    const own: ComplianceInput = {
      ...base,
      jurisdiction: null,
      entityType: "partnership",
      documents: [{ id: "ins", title: "Insurance policy", expiresOn: "2026-08-01" }],
      custom: [
        {
          id: "wsib",
          title: "WSIB premium",
          notes: null,
          firstDue: "2026-01-31",
          recurrence: "quarterly",
        },
      ],
    };
    expect(due(own, "2026-03-01", "2026-12-31")).toEqual([
      ["2026-04-30", "custom:wsib"],
      ["2026-07-31", "custom:wsib"],
      ["2026-08-01", "document:ins"],
      ["2026-10-31", "custom:wsib"],
    ]);
  });
});

describe("reminderDue", () => {
  const leads = [30, 7, 1, 0];
  it("sends the lead time that has just arrived, once", () => {
    expect(reminderDue("2026-06-30", "2026-05-15", leads, new Set())).toBeNull();
    expect(reminderDue("2026-06-30", "2026-06-05", leads, new Set())).toBe(30);
    expect(reminderDue("2026-06-30", "2026-06-05", leads, new Set([30]))).toBeNull();
    // A missed run still sends the latest reminder.
    expect(reminderDue("2026-06-30", "2026-06-29", leads, new Set([30]))).toBe(1);
    expect(reminderDue("2026-06-30", "2026-06-30", leads, new Set([30, 7, 1]))).toBe(0);
    expect(reminderDue("2026-06-30", "2026-07-01", leads, new Set())).toBeNull();
  });
});
