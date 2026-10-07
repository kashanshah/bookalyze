import { describe, expect, it } from "vitest";
import {
  type InvoiceItem,
  type InvoiceSeller,
  parseBuyerInfo,
  prepareOrderInvoice,
} from "../commerce/invoices";

const seller = (over: Partial<InvoiceSeller> = {}): InvoiceSeller => ({
  legalName: "Kazomo For Online Selling",
  tradeName: null,
  address: "Dubai, UAE",
  tradeLicense: "DL-100",
  taxNumber: null,
  taxName: "VAT",
  registered: false,
  ...over,
});

const item = (over: Partial<InvoiceItem> = {}): InvoiceItem => ({
  title: "Stone coaster",
  sku: "COASTER",
  quantity: 2,
  itemPrice: "40.0000",
  itemTax: "2.0000",
  shippingPrice: "5.0000",
  shippingTax: "0.2500",
  promotionDiscount: "1.0000",
  ...over,
});

const invoice = (over: Partial<Parameters<typeof prepareOrderInvoice>[0]> = {}) =>
  prepareOrderInvoice({
    number: "INV-0001",
    seller: seller(),
    buyer: { name: "Amina Rahman", company: null, taxNumber: null, address: null },
    orderNumber: "406-0000001-0000001",
    marketplace: "Amazon.ae",
    currency: "AED",
    purchasedOn: "2026-10-01",
    invoiceDate: "2026-10-07",
    total: "46.2500",
    refunded: null,
    items: [item()],
    ...over,
  });

describe("prepareOrderInvoice", () => {
  it("calls Amazon's tax Amazon's, and says the company is not registered", () => {
    const doc = invoice();
    expect(doc.title).toBe("Invoice");
    expect(doc.registrationNote).toBe("Not registered for VAT.");
    expect(doc.tax).toEqual({
      kind: "amazon",
      label: "Tax reported by Amazon",
      amount: "2.2500",
    });
    expect(doc.seller.taxNumber).toBeNull();
    expect(doc.shipping).toBe("5.0000");
    expect(doc.discounts).toBe("1.0000");
    expect(doc.lines).toEqual([
      { title: "Stone coaster", sku: "COASTER", quantity: 2, amount: "40.0000" },
    ]);
    expect(doc.paymentNote).toMatch(/already collected/i);
  });

  it("is a tax invoice when the company is registered, with its own tax", () => {
    const doc = invoice({
      seller: seller({
        registered: true,
        taxName: "GST/HST",
        taxNumber: "123456789 RT0001",
        tradeLicense: null,
      }),
    });
    expect(doc.title).toBe("Tax invoice");
    expect(doc.registrationNote).toBeNull();
    expect(doc.seller.taxNumber).toBe("123456789 RT0001");
    expect(doc.seller.taxNumberLabel).toBe("GST/HST number");
    expect(doc.tax).toEqual({ kind: "seller", label: "GST/HST", amount: "2.2500" });
  });

  it("leaves tax off when nothing was collected, and notes a refund", () => {
    const doc = invoice({
      refunded: "10.0000",
      items: [
        item({ itemTax: null, shippingTax: "0", shippingPrice: null, promotionDiscount: null }),
      ],
    });
    expect(doc.tax).toBeNull();
    expect(doc.shipping).toBeNull();
    expect(doc.discounts).toBeNull();
    expect(doc.refunded).toBe("10.0000");
  });
});

describe("parseBuyerInfo", () => {
  it("keeps the name, company and tax number, and drops the email", () => {
    const buyer = parseBuyerInfo({
      payload: {
        AmazonOrderId: "406-0000001-0000001",
        BuyerInfo: {
          BuyerEmail: "buyer@example.com",
          BuyerName: "Amina Rahman",
          BuyerTaxInfo: {
            CompanyLegalName: "Acme Trading LLC",
            TaxClassifications: [
              { Name: "VAT", Value: "100234567800003" },
              { Name: "Other", Value: "ignore-me" },
            ],
          },
        },
      },
    });
    expect(buyer).toEqual({
      name: "Amina Rahman",
      company: "Acme Trading LLC",
      taxNumber: "100234567800003",
      address: null,
    });
    expect(buyer).not.toHaveProperty("email");
    expect(JSON.stringify(buyer)).not.toContain("buyer@example.com");
  });

  it("is empty when Amazon sent no buyer block", () => {
    expect(parseBuyerInfo({ payload: { AmazonOrderId: "1" } })).toEqual({
      name: null,
      company: null,
      taxNumber: null,
      address: null,
    });
  });
});
