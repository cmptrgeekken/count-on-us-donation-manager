import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { capCauseAllocations, computeDonationPool } from "./donationPool.server";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("donation pool", () => {
  it("retains profit that was not committed through cause percentages", () => {
    const result = computeDonationPool({
      totalNetContribution: decimal("100"),
      shopifyCharges: decimal("0"),
      externalSettlementFees: decimal("0"),
      artistPayouts: decimal("0"),
      estimatedTaxReserve: decimal("0"),
      taxTrueUpSurplus: decimal("0"),
      taxTrueUpShortfall: decimal("0"),
      requestedDonation: decimal("60"),
    });

    expect(result.donationPool.toString()).toBe("60");
    expect(result.retainedByShop.toString()).toBe("40");
  });

  it("caps requested donations at capacity after global deductions", () => {
    const result = computeDonationPool({
      totalNetContribution: decimal("100"),
      shopifyCharges: decimal("3"),
      externalSettlementFees: decimal("0"),
      artistPayouts: decimal("0"),
      estimatedTaxReserve: decimal("0"),
      taxTrueUpSurplus: decimal("0"),
      taxTrueUpShortfall: decimal("0"),
      requestedDonation: decimal("100"),
    });

    expect(result.availableDonationCapacity.toString()).toBe("97");
    expect(result.donationPool.toString()).toBe("97");
    expect(result.retainedByShop.toString()).toBe("0");
  });

  it("treats a negative charge amount as a credit that restores capacity", () => {
    const result = computeDonationPool({
      totalNetContribution: decimal("100"),
      shopifyCharges: decimal("-3"),
      externalSettlementFees: decimal("0"),
      artistPayouts: decimal("0"),
      estimatedTaxReserve: decimal("0"),
      taxTrueUpSurplus: decimal("0"),
      taxTrueUpShortfall: decimal("0"),
      requestedDonation: decimal("100"),
    });

    expect(result.availableDonationCapacity.toString()).toBe("103");
    expect(result.donationPool.toString()).toBe("100");
    expect(result.retainedByShop.toString()).toBe("3");
  });

  it("caps multiple causes proportionally and reconciles the residual", () => {
    const result = capCauseAllocations(
      [{ causeId: "a", allocated: decimal("75") }, { causeId: "b", allocated: decimal("25") }],
      decimal("97"),
    );

    expect(result.map((row) => row.allocated.toString())).toEqual(["72.75", "24.25"]);
    expect(result.reduce((sum, row) => sum.add(row.allocated), decimal("0")).toString()).toBe("97");
  });

  it("floors donation capacity and allocations at zero", () => {
    const pool = computeDonationPool({
      totalNetContribution: decimal("2"),
      shopifyCharges: decimal("3"),
      externalSettlementFees: decimal("0"),
      artistPayouts: decimal("0"),
      estimatedTaxReserve: decimal("0"),
      taxTrueUpSurplus: decimal("0"),
      taxTrueUpShortfall: decimal("0"),
      requestedDonation: decimal("2"),
    });
    const allocations = capCauseAllocations([{ allocated: decimal("2") }], pool.donationPool);

    expect(pool.donationPool.toString()).toBe("0");
    expect(allocations[0]?.allocated.toString()).toBe("0");
  });
});
