import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { adjustAllocationForLineChange } from "./allocationAdjustment.server";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("adjustAllocationForLineChange", () => {
  it("scales a partial refund proportionally", () => {
    const result = adjustAllocationForLineChange({
      baseAmount: decimal("50"),
      lineNetContribution: decimal("100"),
      lineAdjustmentTotal: decimal("-25"),
    });
    expect(result.amount.toString()).toBe("37.5");
    expect(result.reviewRequired).toBe(false);
  });

  it("reduces a full refund allocation to zero", () => {
    const result = adjustAllocationForLineChange({
      baseAmount: decimal("50"),
      lineNetContribution: decimal("100"),
      lineAdjustmentTotal: decimal("-100"),
    });
    expect(result.amount.toString()).toBe("0");
    expect(result.reviewRequired).toBe(false);
  });

  it("flags a nonzero adjustment against zero contribution", () => {
    const result = adjustAllocationForLineChange({
      baseAmount: decimal("0"),
      lineNetContribution: decimal("0"),
      lineAdjustmentTotal: decimal("1"),
    });
    expect(result.reviewReason).toBe("ZERO_NET_CONTRIBUTION");
  });

  it("flags ratios greater than ten without changing the allocation", () => {
    const result = adjustAllocationForLineChange({
      baseAmount: decimal("0.01"),
      lineNetContribution: decimal("0.01"),
      lineAdjustmentTotal: decimal("-5"),
    });
    expect(result.amount.toString()).toBe("0.01");
    expect(result.reviewReason).toBe("EXTREME_ADJUSTMENT_RATIO");
  });
});
