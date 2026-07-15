import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { recomputeTaxOffsetCache } from "./taxOffsetCache.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

describe("recomputeTaxOffsetCache", () => {
  it("does not floor taxable exposure at zero", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const db = {
      businessExpense: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("50") } }),
      },
      lineCauseAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("25") } }),
      },
      orderSnapshotLine: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { subtotal: decimal("100"), materialCost: decimal("20"), packagingCost: decimal("10"), netContribution: decimal("60") } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      adjustment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netContribAdj: decimal("-5"), laborAdj: decimal("0"), equipmentAdj: decimal("0") } }),
      },
      taxOffsetCache: {
        upsert,
      },
    };

    const result = await recomputeTaxOffsetCache("shop-1", db as any);

    expect(result.cumulativeNetContrib.toString()).toBe("55");
    expect(result.deductionPool.toString()).toBe("75");
    expect(result.taxableExposure.toString()).toBe("-10");
    expect(result.widgetTaxSuppressed).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          taxableExposure: decimal("-10"),
        }),
      }),
    );
  });

  it("adjusts the deduction pool when 501(c)(3) allocations are reduced by adjustments", async () => {
    const db = {
      businessExpense: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("10") } }),
      },
      lineCauseAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("20") } }),
      },
      orderSnapshotLine: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { subtotal: decimal("120"), materialCost: decimal("10"), packagingCost: decimal("10"), netContribution: decimal("100") } }),
        findMany: vi.fn().mockResolvedValue([
          {
            netContribution: decimal("40"),
            adjustments: [{ netContribAdj: decimal("-10") }],
            causeAllocations: [{ amount: decimal("20") }],
          },
        ]),
      },
      adjustment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netContribAdj: decimal("-10"), laborAdj: decimal("5"), equipmentAdj: decimal("2") } }),
      },
      taxOffsetCache: {
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    };

    const result = await recomputeTaxOffsetCache("shop-1", db as any);

    expect(result.deductionPool.toString()).toBe("25");
    expect(result.cumulativeNetContrib.toString()).toBe("90");
    expect(result.taxableExposure.toString()).toBe("72");
    expect(db.lineCauseAllocation.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is501c3: true,
        }),
      }),
    );
  });

  it("ignores extreme allocation ratios from near-zero net contribution lines", async () => {
    const db = {
      businessExpense: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("0") } }),
      },
      lineCauseAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("20") } }),
      },
      orderSnapshotLine: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { subtotal: decimal("130"), materialCost: decimal("20"), packagingCost: decimal("10"), netContribution: decimal("100") } }),
        findMany: vi.fn().mockResolvedValue([
          {
            netContribution: decimal("0.01"),
            adjustments: [{ netContribAdj: decimal("1.00") }],
            causeAllocations: [{ amount: decimal("20") }],
          },
        ]),
      },
      adjustment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netContribAdj: decimal("1"), laborAdj: decimal("0"), equipmentAdj: decimal("0") } }),
      },
      taxOffsetCache: {
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    };

    const result = await recomputeTaxOffsetCache("shop-1", db as any);

    expect(result.deductionPool.toString()).toBe("20");
    expect(result.taxableExposure.toString()).toBe("81");
  });
});
