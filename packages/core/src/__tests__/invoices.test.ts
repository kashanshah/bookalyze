import { describe, expect, it } from "vitest";
import {
  type InvoiceItem,
  type InvoiceSeller,
  invoiceLineTitle,
  invoiceRegistration,
  parseBuyerInfo,
  prepareOrderInvoice,
  registrationCountry,
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
    expect(doc.titleArabic).toBe("فاتورة");
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
      {
        title: "Stone coaster",
        sku: "COASTER",
        quantity: 2,
        unitPrice: "20.0000",
        amount: "40.0000",
      },
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
    expect(doc.titleArabic).toBe("فاتورة ضريبية");
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

describe("shipping discounts", () => {
  it("shows a shipping discount Amazon reported", () => {
    const doc = invoice({ total: "41.2500", items: [item({ shippingDiscount: "5.0000" })] });
    expect(doc.shipping).toBe("5.0000");
    expect(doc.shippingDiscount).toBe("5.0000");
  });

  it("leaves it off when Amazon reported none", () => {
    expect(invoice({ items: [item({ shippingDiscount: "0.0000" })] }).shippingDiscount).toBeNull();
  });

  it("treats shipping as free on older orders when the total leaves it out", () => {
    // Lines 40 + shipping 5 − discount 1 = 44, but Amazon charged 39: the shipping was free.
    const doc = invoice({ total: "39.0000", items: [item({ itemTax: null, shippingTax: null })] });
    expect(doc.shippingDiscount).toBe("5.0000");
  });

  it("doesn't guess on older orders when the total doesn't line up that way", () => {
    expect(invoice({ total: "41.0000" }).shippingDiscount).toBeNull();
  });
});

describe("registrationCountry", () => {
  it("knows the main tax authorities", () => {
    expect(registrationCountry("Federal Tax Authority (VAT)")).toBe("AE");
    expect(registrationCountry("ZATCA")).toBe("SA");
    expect(registrationCountry("Canada Revenue Agency")).toBe("CA");
    expect(registrationCountry("HMRC")).toBe("GB");
    expect(registrationCountry("Somewhere else")).toBeNull();
  });
});

describe("invoiceRegistration", () => {
  const fta = {
    authority: "Federal Tax Authority (VAT)",
    registrationNumber: null,
    isActive: true,
  };

  it("isn't registered with a registration that has no number", () => {
    expect(
      invoiceRegistration({ country: "AE", registrations: [fta], identifierNumber: null }),
    ).toEqual({ registered: false, taxNumber: null });
  });

  it("uses the registration's number, or the saved TRN", () => {
    expect(
      invoiceRegistration({
        country: "AE",
        registrations: [{ ...fta, registrationNumber: "100000000000003" }],
        identifierNumber: null,
      }),
    ).toEqual({ registered: true, taxNumber: "100000000000003" });
    expect(
      invoiceRegistration({
        country: "AE",
        registrations: [fta],
        identifierNumber: "100000000000003",
      }),
    ).toEqual({ registered: true, taxNumber: "100000000000003" });
  });

  it("ignores another country's registration and inactive ones", () => {
    expect(
      invoiceRegistration({
        country: "AE",
        registrations: [
          {
            authority: "Canada Revenue Agency",
            registrationNumber: "123456789 RT0001",
            isActive: true,
          },
          { ...fta, registrationNumber: "100000000000003", isActive: false },
        ],
        identifierNumber: null,
      }),
    ).toEqual({ registered: false, taxNumber: null });
  });
});

describe("invoiceLineTitle", () => {
  it("keeps short titles", () => {
    expect(invoiceLineTitle("  Stone   coaster ")).toBe("Stone coaster");
  });

  it("cuts long marketplace titles at a separator or word", () => {
    const long =
      "Glass coffee mugs set of 4, 350 ml double wall borosilicate cups with handle | clear tea cups for latte cappuccino espresso";
    const short = invoiceLineTitle(long);
    expect(short.length).toBeLessThanOrEqual(91);
    expect(long.startsWith(short.replace(/…$/, ""))).toBe(true);
    expect(short).not.toMatch(/\s$/);
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
