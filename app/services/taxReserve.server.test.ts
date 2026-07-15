import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  applyEstimatedTaxReserveToAllocations,
  computeEstimatedTaxReserve,
  computeTaxableWeight,
  taxDeductionModes,
} from "./taxReserve.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

describe("computeTaxableWeight", () => {
  it("returns the non-501c3 share for non_501c3_only mode", () => {
    const result = computeTaxableWeight(
      [
        { is501c3: true, allocated: decimal("60.00") },
        { is501c3: false, allocated: decimal("40.00") },
      ],
      taxDeductionModes.NON_501C3_ONLY,
    );

    expect(result.toString()).toBe("0.4");
  });

  it("returns 1 for all_causes mode", () => {
    const result = computeTaxableWeight([], taxDeductionModes.ALL_CAUSES);
    expect(result.toString()).toBe("1");
  });
});

describe("computeEstimatedTaxReserve", () => {
  it("computes the period reserve from the taxable base and weight", () => {
    const result = computeEstimatedTaxReserve({
      totalNetContribution: decimal("100.00"),
      businessExpenseTotal: decimal("20.00"),
      allocations: [
        { is501c3: true, allocated: decimal("60.00") },
        { is501c3: false, allocated: decimal("40.00") },
      ],
      effectiveTaxRate: decimal("0.25"),
      taxDeductionMode: taxDeductionModes.NON_501C3_ONLY,
    });

    expect(result.taxableBase.toString()).toBe("80");
    expect(result.taxableWeight.toString()).toBe("0.4");
    expect(result.estimatedTaxReserve.toString()).toBe("8");
  });
});

describe("applyEstimatedTaxReserveToAllocations", () => {
  const allocations = [
    { causeId: "501", is501c3: true, allocated: decimal("60") },
    { causeId: "other-a", is501c3: false, allocated: decimal("30") },
    { causeId: "other-b", is501c3: false, allocated: decimal("10") },
  ];

  it("deducts proportionally from non-501c3 causes only", () => {
    const result = applyEstimatedTaxReserveToAllocations(
      allocations,
      decimal("8"),
      taxDeductionModes.NON_501C3_ONLY,
    );

    expect(result.map((row) => row.allocated.toString())).toEqual(["60", "24", "8"]);
    expect(result.map((row) => row.taxReserveDeduction.toString())).toEqual(["0", "6", "2"]);
  });

  it("deducts proportionally from all causes", () => {
    const result = applyEstimatedTaxReserveToAllocations(
      allocations,
      decimal("10"),
      taxDeductionModes.ALL_CAUSES,
    );

    expect(result.map((row) => row.allocated.toString())).toEqual(["54", "27", "9"]);
  });

  it("does not deduct in don't-deduct mode", () => {
    const result = applyEstimatedTaxReserveToAllocations(
      allocations,
      decimal("10"),
      taxDeductionModes.DONT_DEDUCT,
    );

    expect(result.map((row) => row.allocated.toString())).toEqual(["60", "30", "10"]);
  });
});
