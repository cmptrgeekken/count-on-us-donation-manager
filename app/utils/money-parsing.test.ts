import { describe, expect, it } from "vitest";
import {
  parseOptionalNonNegativeMoney,
  parseOptionalPositiveDecimal,
  parsePercentInputToRate,
  parseRequiredPositiveMoney,
} from "./money-parsing";

describe("money parsing", () => {
  it("rounds money inputs to two decimals", () => {
    expect(parseRequiredPositiveMoney("12.345", "Purchase price").toString()).toBe("12.35");
    expect(parseOptionalNonNegativeMoney("4.994", "Hourly rate")?.toString()).toBe("4.99");
  });

  it("parses positive decimal operational values with higher precision", () => {
    expect(parseOptionalPositiveDecimal("10.12345", "Purchase quantity")?.toString()).toBe("10.1235");
  });

  it("parses percent inputs into four-decimal stored rates", () => {
    expect(parsePercentInputToRate("2.90", "Payment rate").toString()).toBe("0.029");
    expect(parsePercentInputToRate("5.55", "Mistake buffer").toString()).toBe("0.0555");
  });

  it("rejects invalid money values", () => {
    expect(() => parseRequiredPositiveMoney("-1", "Purchase price")).toThrow();
    expect(() => parsePercentInputToRate("101", "Payment rate")).toThrow();
  });
});
