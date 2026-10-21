import { describe, expect, it } from "vitest";
import {
  emailAddressOf,
  emailNameOf,
  stripQuotedReply,
  supportRecipient,
  supportReplyAddress,
  supportTicketLabel,
} from "../support";

describe("support tickets", () => {
  it("labels ticket numbers", () => {
    expect(supportTicketLabel(1)).toBe("T-0001");
    expect(supportTicketLabel(42)).toBe("T-0042");
    expect(supportTicketLabel(12345)).toBe("T-12345");
  });

  it("finds the ticket token in a reply address", () => {
    const token = "a1b2c3d4e5f6a1b2c3d4e5f6";
    const address = supportReplyAddress(token, "in.example.com");
    expect(address).toBe(`support-${token}@in.example.com`);
    expect(supportRecipient([`Bookalyze <${address.toUpperCase()}>`], "in.example.com")).toBe(
      token,
    );
    expect(supportRecipient([`invoices-${token}@in.example.com`], "in.example.com")).toBeNull();
    expect(supportRecipient([address], "other.example.com")).toBeNull();
  });

  it("reads the sender", () => {
    expect(emailAddressOf('"Sam Seller" <Sam@Example.com>')).toBe("sam@example.com");
    expect(emailAddressOf("sam@example.com")).toBe("sam@example.com");
    expect(emailAddressOf("no address")).toBeNull();
    expect(emailNameOf('"Sam Seller" <sam@example.com>')).toBe("Sam Seller");
    expect(emailNameOf("sam@example.com")).toBeNull();
  });

  it("keeps only the new part of an emailed reply", () => {
    expect(
      stripQuotedReply(
        "Thanks, that fixed it.\n\nOn Tue, Oct 21, 2026 at 9:14 AM Bookalyze Support <support-x@in.example.com> wrote:\n> Try connecting again.",
      ),
    ).toBe("Thanks, that fixed it.");
    expect(
      stripQuotedReply(
        "Still broken.\r\n\r\nOn Tue, Oct 21, 2026 at 9:14 AM Bookalyze\r\nSupport wrote:\r\n> hi",
      ),
    ).toBe("Still broken.");
    expect(stripQuotedReply("Yes please.\n\n-----Original Message-----\nFrom: x")).toBe(
      "Yes please.",
    );
    expect(stripQuotedReply("Here it is.\n\nFrom: Bookalyze Support\nSent: Tuesday")).toBe(
      "Here it is.",
    );
    expect(stripQuotedReply("Line one\n\n\n\nLine two\n-- \nSam")).toBe("Line one\n\nLine two");
    expect(stripQuotedReply("> only quoted")).toBe("");
  });
});
