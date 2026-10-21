import { describe, expect, it } from "vitest";
import {
  inboxRecipient,
  invoiceInboxAddress,
  invoiceInboxToken,
  messagingAllowsInvoice,
  parseInvoiceRequestEmail,
  senderName,
} from "../commerce/invoice-requests";

describe("parseInvoiceRequestEmail", () => {
  it("reads Amazon's subject, forwarded or not", () => {
    const expected = { externalOrderId: "171-0000000-0000001", buyerName: "Sample Buyer" };
    expect(
      parseInvoiceRequestEmail({
        subject: "Invoice request from Amazon customer Sample Buyer (Order: 171-0000000-0000001)",
      }),
    ).toEqual(expected);
    expect(
      parseInvoiceRequestEmail({
        subject:
          "Fwd: FW: Invoice request from Amazon customer Sample Buyer (Order: 171-0000000-0000001)",
      }),
    ).toEqual(expected);
  });

  it("falls back to any invoice email that names an order", () => {
    expect(
      parseInvoiceRequestEmail({ subject: "Invoice please", text: "My order 406-1234567-7654321" }),
    ).toEqual({ externalOrderId: "406-1234567-7654321", buyerName: null });
  });

  it("ignores everything else", () => {
    expect(
      parseInvoiceRequestEmail({ subject: "(#123456) Gmail Forwarding Confirmation" }),
    ).toBeNull();
    expect(
      parseInvoiceRequestEmail({ subject: "Your order 171-0000000-0000001 shipped" }),
    ).toBeNull();
    expect(parseInvoiceRequestEmail({ subject: null })).toBeNull();
  });
});

describe("invoice inbox addresses", () => {
  const token = "abcdefghijklmnopqrstuvwx";
  it("round-trips the token", () => {
    const address = invoiceInboxAddress(token, "in.example.com");
    expect(address).toBe(`invoices-${token}@in.example.com`);
    expect(invoiceInboxToken([`Seller <${address.toUpperCase()}>`], "in.example.com")).toBe(token);
  });

  it("ignores other addresses and domains", () => {
    expect(invoiceInboxToken(["someone@in.example.com"], "in.example.com")).toBeNull();
    expect(invoiceInboxToken([`invoices-${token}@other.com`], "in.example.com")).toBeNull();
  });
});

describe("messagingAllowsInvoice", () => {
  it("finds the invoice action in either HAL list", () => {
    expect(
      messagingAllowsInvoice({
        _links: {
          actions: [{ href: "/messaging/v1/orders/1/messages/invoice", name: "sendInvoice" }],
        },
      }),
    ).toBe(true);
    expect(messagingAllowsInvoice({ _embedded: { actions: [{ name: "sendInvoice" }] } })).toBe(
      true,
    );
  });

  it("is false without it", () => {
    expect(
      messagingAllowsInvoice({ _links: { actions: [{ name: "confirmDeliveryDetails" }] } }),
    ).toBe(false);
    expect(messagingAllowsInvoice(null)).toBe(false);
  });
});

describe("inboxRecipient", () => {
  const token = "abcdefghijklmnopqrstuvwx";
  it("tells the receipts address from the invoices one", () => {
    expect(invoiceInboxAddress(token, "in.example.com", "receipts")).toBe(
      `receipts-${token}@in.example.com`,
    );
    expect(
      inboxRecipient(
        [`{"to":["seller@example.com"],"x-forwarded-to":"receipts-${token}@in.example.com"}`],
        "in.example.com",
      ),
    ).toEqual({ kind: "receipts", token });
    expect(invoiceInboxToken([`receipts-${token}@in.example.com`], "in.example.com")).toBeNull();
  });
});

describe("senderName", () => {
  it("uses the display name, else the brand part of the domain", () => {
    expect(senderName("Noon <no-reply@noon.com>")).toBe("Noon");
    expect(senderName('"Sample Supplier LLC" <billing@example.com>')).toBe("Sample Supplier LLC");
    expect(senderName("receipts@mail.example.com")).toBe("Example");
    expect(senderName("orders@amazon.co.uk")).toBe("Amazon");
    expect(senderName(null)).toBeNull();
  });
});
