/** What the create-invoice dialog shows. Strings the user can edit are never null. */

export type InvoiceBuyerFields = {
  name: string;
  company: string;
  taxNumber: string;
  address: string;
};

export type InvoiceDraft = {
  existingNumber: string | null;
  seller: { label: string; value: string }[];
  missingAddress: boolean;
  buyer: InvoiceBuyerFields;
  /** Why Amazon's name and tax number aren't filled in, when they aren't. */
  amazonNote: string | null;
  lines: { title: string; sku: string | null; quantity: number; amount: string }[];
  shipping: string | null;
  discounts: string | null;
  tax: { label: string; amount: string } | null;
  total: string;
  refunded: string | null;
  currency: string;
  registrationNote: string | null;
  title: string;
};
