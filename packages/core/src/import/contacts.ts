import type { CsvTable } from "./csv";
import { type ContactRole, contactKeyOf } from "./plan";
import { normalizeHeader } from "./sources";

/**
 * Customer and vendor lists exported from other software (Wave's customers.csv and vendors.csv,
 * QuickBooks and Xero contact exports…). Columns are recognised by name. Bank account numbers are
 * deliberately not read: they'd need encrypted storage.
 */

export const CONTACT_FIELDS = {
  name: [
    "customer name",
    "vendor name",
    "supplier name",
    "contact name",
    "display name",
    "name",
    "company",
    "company name",
    "customer",
    "vendor",
    "supplier",
  ],
  email: ["email", "email address", "e mail"],
  firstName: ["contact first name", "first name", "firstname"],
  lastName: ["contact last name", "last name", "lastname", "surname"],
  phone: ["phone", "phone number", "telephone", "work phone"],
  mobile: ["mobile", "mobile phone", "cell", "cell phone"],
  tollFree: ["toll free"],
  website: ["website", "web", "url"],
  currency: ["customer currency", "vendor currency", "currency"],
  taxNumber: [
    "tax number",
    "tax id",
    "business number",
    "gst number",
    "hst number",
    "vat number",
    "tax registration number",
    "abn",
  ],
  address1: [
    "address line 1",
    "address 1",
    "address",
    "street",
    "billing address line 1",
    "po address line 1",
  ],
  address2: ["address line 2", "address 2", "billing address line 2", "po address line 2"],
  city: ["city", "town", "billing city", "po city"],
  region: ["province state", "province", "state", "region", "billing state", "po region"],
  postalCode: [
    "postal code zip code",
    "postal code",
    "zip code",
    "zip",
    "postcode",
    "billing zip",
    "po postal code",
  ],
  country: ["country", "billing country", "po country"],
  notes: ["notes", "note", "memo"],
} as const;

export type ContactField = keyof typeof CONTACT_FIELDS;
export type ContactMapping = Partial<Record<ContactField, number>>;

export type ImportContactDetails = {
  key: string;
  name: string;
  role: ContactRole;
  email?: string;
  phone?: string;
  taxNumber?: string;
  address?: string;
  notes?: string;
};

export function guessContactColumns(headers: readonly string[]): ContactMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ContactMapping = {};
  const used = new Set<number>();
  for (const field of Object.keys(CONTACT_FIELDS) as ContactField[]) {
    for (const alias of CONTACT_FIELDS[field]) {
      const index = normalized.findIndex((h, i) => h === alias && !used.has(i));
      if (index !== -1) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  return mapping;
}

/** Whether a contact list is of customers or vendors, from its file name and columns. */
export function contactListRole(fileName: string, headers: readonly string[]): ContactRole {
  const text = `${fileName} ${headers.join(" ")}`.toLowerCase();
  const customer = /customer|client/.test(text);
  const vendor = /vendor|supplier/.test(text);
  return customer && !vendor ? "customer" : vendor && !customer ? "vendor" : "both";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reads a contact list. Rows without a name are skipped. */
export function readContactList(
  table: CsvTable,
  role: ContactRole,
  mapping: ContactMapping = guessContactColumns(table.headers),
): ImportContactDetails[] {
  const out = new Map<string, ImportContactDetails>();
  if (mapping.name === undefined) return [];
  for (const row of table.rows) {
    const cell = (field: ContactField) => {
      const index = mapping[field];
      return index === undefined ? "" : (row[index] ?? "").trim();
    };
    const name = cell("name");
    if (!name) continue;
    const email = cell("email");
    const phone = cell("phone") || cell("mobile") || cell("tollFree");
    const cityLine = [cell("city"), cell("region"), cell("postalCode")].filter(Boolean).join(", ");
    const address = [cell("address1"), cell("address2"), cityLine, cell("country")]
      .filter(Boolean)
      .join("\n");
    const person = [cell("firstName"), cell("lastName")].filter(Boolean).join(" ");
    const notes = [
      person ? `Contact: ${person}` : "",
      cell("website") ? `Website: ${cell("website")}` : "",
      cell("currency") ? `Currency: ${cell("currency")}` : "",
      cell("notes"),
    ]
      .filter(Boolean)
      .join("\n");
    const key = contactKeyOf(name);
    out.set(key, {
      key,
      name: name.slice(0, 200),
      role,
      ...(EMAIL.test(email) ? { email: email.slice(0, 254) } : {}),
      ...(phone ? { phone: phone.slice(0, 50) } : {}),
      ...(cell("taxNumber") ? { taxNumber: cell("taxNumber").slice(0, 50) } : {}),
      ...(address ? { address: address.slice(0, 500) } : {}),
      ...(notes ? { notes: notes.slice(0, 2000) } : {}),
    });
  }
  return [...out.values()];
}

/**
 * Combines contacts named in transactions with contact lists: details come from the lists, roles
 * merge (a vendor that's also a customer becomes "both"), and listed contacts without
 * transactions are kept too.
 */
export function mergeContacts(
  fromEntries: readonly { key: string; name: string; role: ContactRole }[],
  lists: readonly ImportContactDetails[],
): ImportContactDetails[] {
  const merged = new Map<string, ImportContactDetails>();
  const role = (a: ContactRole, b: ContactRole): ContactRole => (a === b ? a : "both");
  for (const c of [...fromEntries, ...lists]) {
    const existing = merged.get(c.key);
    if (!existing) merged.set(c.key, { ...c });
    else
      merged.set(c.key, {
        ...existing,
        ...c,
        name: existing.name,
        role: role(existing.role, c.role),
      });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
