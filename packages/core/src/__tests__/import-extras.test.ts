import { describe, expect, it } from "vitest";
import {
  contactListRole,
  matchReceipt,
  mergeContacts,
  parseReceiptFileName,
  readContactList,
  readCsvTable,
} from "../import";

// Synthetic lists in Wave's column layout. No real people or companies.
const CUSTOMERS = `customer_name,email,contact_first_name,contact_last_name,customer_currency,account_number,phone,fax,mobile,toll_free,website,country,province/state,address_line_1,address_line_2,city,postal_code/zip_code,shipping_address,ship-to_contact,ship-to_country,ship-to_province/state,ship-to_address_line_1,ship-to_address_line_2,ship-to_city,ship-to_postal_code/zip_code,ship-to_phone,delivery_instructions
Lakeside Studio Ltd.,hello@lakeside.example,Jamie,Rivera,CAD,,416-555-0100,,,,https://lakeside.example,Canada,Ontario,1 Example St.,Unit 2,Toronto,M5V 0A1,False,,,,9 Ship St.,,Ottawa,,,
Quiet Walk-in,,,,,,,,,,,,,,,,,False,,,,,,,,,
`;
const VENDORS = `vendor_name,email,contact_first_name,contact_last_name,vendor_currency,account_number,phone,fax,mobile,toll_free,website,country,province/state,address_line_1,address_line_2,city,postal_code/zip_code
Paper Co,not-an-email,,,USD,XX00TEST0000000000,,,+1 555 0101,,,United States,California,"10 Market St, Floor 2",,San Francisco,94105
`;

describe("contact lists", () => {
  it("reads Wave's customer list into contacts with address and notes", () => {
    const table = readCsvTable(CUSTOMERS);
    const role = contactListRole("customers.csv", table.headers);
    expect(role).toBe("customer");
    expect(readContactList(table, role)).toEqual([
      {
        key: "lakeside studio ltd.",
        name: "Lakeside Studio Ltd.",
        role: "customer",
        email: "hello@lakeside.example",
        phone: "416-555-0100",
        address: "1 Example St.\nUnit 2\nToronto, Ontario, M5V 0A1\nCanada",
        notes: "Contact: Jamie Rivera\nWebsite: https://lakeside.example\nCurrency: CAD",
      },
      { key: "quiet walk-in", name: "Quiet Walk-in", role: "customer" },
    ]);
  });

  it("reads vendors, skips bad emails and never keeps bank account numbers", () => {
    const table = readCsvTable(VENDORS);
    const [vendor] = readContactList(table, contactListRole("vendors.csv", table.headers));
    expect(vendor).toEqual({
      key: "paper co",
      name: "Paper Co",
      role: "vendor",
      phone: "+1 555 0101",
      address: "10 Market St, Floor 2\nSan Francisco, California, 94105\nUnited States",
      notes: "Currency: USD",
    });
    expect(JSON.stringify(vendor)).not.toContain("XX00TEST");
  });

  it("merges list details into contacts found in transactions", () => {
    const merged = mergeContacts(
      [
        { key: "paper co", name: "Paper Co", role: "customer" },
        { key: "only in entries", name: "Only In Entries", role: "vendor" },
      ],
      [{ key: "paper co", name: "PAPER CO", role: "vendor", email: "a@b.example" }],
    );
    expect(merged).toEqual([
      { key: "only in entries", name: "Only In Entries", role: "vendor" },
      { key: "paper co", name: "Paper Co", role: "both", email: "a@b.example" },
    ]);
  });
});

describe("receipt files", () => {
  it("reads the date and merchant from Wave's file names", () => {
    expect(parseReceiptFileName("2025-02-01-Sizzler_Kabab.jpg")).toEqual({
      date: "2025-02-01",
      words: ["sizzler", "kabab"],
    });
    expect(parseReceiptFileName("2025-02-06-CHAI__GRILL.jpg")).toEqual({
      date: "2025-02-06",
      words: ["chai", "grill"],
    });
    expect(parseReceiptFileName("IMG_2041.HEIC")).toEqual({ date: null, words: [] });
  });

  const candidates = [
    { id: "a", date: "2025-02-01", text: "SIZZLER KABAB MISSISSAUGA ON" },
    { id: "b", date: "2025-02-02", text: "Sizzler Kabab" },
    { id: "c", date: "2025-02-01", text: "Office rent" },
    { id: "d", date: "2025-02-06", text: "Chai Grill" },
    { id: "e", date: "2025-02-06", text: "CHAI GRILL #2" },
  ];

  it("matches by shared words, preferring the closest date", () => {
    expect(matchReceipt(parseReceiptFileName("2025-02-01-Sizzler_Kabab.jpg"), candidates)).toBe(
      "a",
    );
    expect(matchReceipt(parseReceiptFileName("2025-02-03-Sizzler_Kabab.jpg"), candidates)).toBe(
      "b",
    );
  });

  it("leaves ties, unknown names and far-off dates for the inbox", () => {
    expect(matchReceipt(parseReceiptFileName("2025-02-06-CHAI__GRILL.jpg"), candidates)).toBeNull();
    expect(matchReceipt(parseReceiptFileName("2025-02-01-Costco.jpg"), candidates)).toBeNull();
    expect(
      matchReceipt(parseReceiptFileName("2025-03-01-Sizzler_Kabab.jpg"), candidates),
    ).toBeNull();
  });
});
