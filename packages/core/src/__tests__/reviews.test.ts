import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_SETTINGS,
  hasPromotion,
  parseSolicitationActions,
  type ReviewOrder,
  refundReason,
  reviewHold,
  reviewSendDay,
  reviewWindow,
  zonedInstant,
} from "../commerce/reviews";

const order: ReviewOrder = {
  status: "Shipped",
  channelId: "ca",
  fulfillment: "amazon",
  isBusiness: false,
  isReplacement: false,
  earliestDelivery: "2026-09-03",
  latestDelivery: "2026-09-05",
  skus: ["MAPLE-MUG"],
  hasPromotion: false,
};
const settings = { ...DEFAULT_REVIEW_SETTINGS, enabled: true };

describe("reviewWindow", () => {
  it("opens 5 days after the earliest delivery and closes 30 after the latest", () => {
    expect(reviewWindow(order)).toEqual({ opens: "2026-09-08", closes: "2026-10-05" });
    expect(reviewWindow({ earliestDelivery: null, latestDelivery: "2026-09-05" })).toEqual({
      opens: "2026-09-10",
      closes: "2026-10-05",
    });
    expect(reviewWindow({ earliestDelivery: null, latestDelivery: null })).toBeNull();
  });
});

describe("reviewSendDay", () => {
  it("asks the chosen days after delivery, within Amazon's window, on an allowed weekday", () => {
    // 2026-09-12 is a Saturday.
    expect(reviewSendDay(order, settings, "2026-09-01")).toBe("2026-09-12");
    expect(reviewSendDay(order, { ...settings, sendDays: [1, 2, 3, 4, 5] }, "2026-09-01")).toBe(
      "2026-09-14",
    );
    // Never before the window opens, nor in the past.
    expect(reviewSendDay(order, { ...settings, daysAfterDelivery: 1 }, "2026-09-01")).toBe(
      "2026-09-08",
    );
    expect(reviewSendDay(order, settings, "2026-09-20")).toBe("2026-09-20");
  });

  it("gives up once the window has closed (keeping its last day free)", () => {
    expect(reviewSendDay(order, settings, "2026-10-04")).toBe("2026-10-04");
    expect(reviewSendDay(order, settings, "2026-10-05")).toBeNull();
    expect(reviewSendDay({ ...order, latestDelivery: null }, settings, "2026-09-01")).toBeNull();
  });
});

describe("reviewHold", () => {
  it("waits for shipping and a delivery date, and never asks cancelled orders", () => {
    expect(reviewHold({ ...order, status: "Unshipped" }, null)).toEqual({
      reason: "Not shipped yet",
      waiting: true,
    });
    expect(reviewHold({ ...order, latestDelivery: null }, null)?.waiting).toBe(true);
    expect(reviewHold({ ...order, status: "Canceled" }, null)?.waiting).toBe(false);
    expect(reviewHold(order, null)).toBeNull();
    expect(reviewHold(order, settings)).toBeNull();
  });

  it("applies the automatic request filters", () => {
    const reason = (o: Partial<ReviewOrder>, s: Partial<typeof settings>) =>
      reviewHold({ ...order, ...o }, { ...settings, ...s })?.reason;
    expect(reason({}, { channelIds: ["us"] })).toMatch(/marketplace/);
    expect(reason({}, { fulfillment: "merchant" })).toMatch(/FBA/);
    expect(reason({ isReplacement: true }, {})).toBe("Replacement order");
    expect(reason({ isReplacement: true }, { skipReplacements: false })).toBeUndefined();
    expect(reason({ isBusiness: true }, { skipBusiness: true })).toBe("Business order");
    expect(reason({ hasPromotion: true }, { skipPromotions: true })).toMatch(/promotion/);
    expect(reason({}, { excludedSkus: ["MAPLE-MUG"] })).toMatch(/MAPLE-MUG/);
    expect(reason({}, { startsFrom: "2026-09-06" })).toMatch(/before/);
  });
});

describe("zonedInstant", () => {
  it("finds the hour in the company's timezone, across daylight saving", () => {
    expect(zonedInstant("2026-07-01", 10, "America/Toronto").toISOString()).toBe(
      "2026-07-01T14:00:00.000Z",
    );
    expect(zonedInstant("2026-12-01", 10, "America/Toronto").toISOString()).toBe(
      "2026-12-01T15:00:00.000Z",
    );
    expect(zonedInstant("2026-12-01", 9, "Asia/Dubai").toISOString()).toBe(
      "2026-12-01T05:00:00.000Z",
    );
  });
});

describe("Amazon's answers", () => {
  it("reads whether a review request is offered", () => {
    expect(
      parseSolicitationActions({
        _links: { actions: [{ href: "/x", name: "productReviewAndSellerFeedback" }] },
      }),
    ).toBe(true);
    expect(
      parseSolicitationActions({
        _embedded: {
          actions: [{ _links: { self: { name: "productReviewAndSellerFeedback" } } }],
        },
      }),
    ).toBe(true);
    expect(parseSolicitationActions({ _links: { actions: [] } })).toBe(false);
    expect(parseSolicitationActions(null)).toBe(false);
  });

  it("finds refunds, A-to-z claims and chargebacks", () => {
    const events = (e: Record<string, unknown[]>) => ({ payload: { FinancialEvents: e } });
    expect(refundReason(events({ ShipmentEventList: [{}] }))).toBeNull();
    expect(refundReason(events({ RefundEventList: [{}] }))).toMatch(/Refunded/);
    expect(refundReason(events({ GuaranteeClaimEventList: [{}] }))).toMatch(/A-to-z/);
    expect(refundReason(events({ ChargebackEventList: [{}] }))).toMatch(/bank/);
    expect(refundReason({})).toBeNull();
  });

  it("spots promotions", () => {
    expect(hasPromotion([null, "0.0000"])).toBe(false);
    expect(hasPromotion([null, "2.5000"])).toBe(true);
  });
});
