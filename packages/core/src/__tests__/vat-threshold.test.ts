import { describe, expect, it } from "vitest";
import { vatThresholdStatus } from "../accounting/vat-threshold";

describe("vatThresholdStatus", () => {
  const ae = (sales: string, registered = false) =>
    vatThresholdStatus({ country: "AE", registered, sales });

  it("says nothing well below the thresholds", () => {
    expect(ae("100000")).toBeNull();
  });

  it("notes the voluntary line", () => {
    expect(ae("187500")?.level).toBe("voluntary");
  });

  it("warns from 80% of the mandatory threshold", () => {
    expect(ae("299999")?.level).toBe("voluntary");
    const status = ae("300000");
    expect(status?.level).toBe("approaching");
    expect(status?.percent).toBe(80);
  });

  it("is due at the threshold", () => {
    expect(ae("375000")?.level).toBe("over");
    expect(ae("500000")?.percent).toBe(133);
  });

  it("says nothing once registered, or for a country with no rule", () => {
    expect(ae("500000", true)).toBeNull();
    expect(vatThresholdStatus({ country: "ZZ", registered: false, sales: "1000000" })).toBeNull();
  });

  it("has no voluntary step in Canada", () => {
    expect(vatThresholdStatus({ country: "CA", registered: false, sales: "20000" })).toBeNull();
    expect(vatThresholdStatus({ country: "CA", registered: false, sales: "24000" })?.level).toBe(
      "approaching",
    );
  });
});
