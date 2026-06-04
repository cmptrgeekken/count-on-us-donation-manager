import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cartonizeOrderPackaging, reconcileSnapshotPackaging } from "./packaging.server";

const { recomputeTaxOffsetCache } = vi.hoisted(() => ({
  recomputeTaxOffsetCache: vi.fn(),
}));

vi.mock("./taxOffsetCache.server", () => ({
  recomputeTaxOffsetCache,
}));

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

function packageFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id === "pkg-small" ? "Small mailer" : "Large box",
    length: decimal(id === "pkg-small" ? "6" : "12"),
    width: decimal(id === "pkg-small" ? "6" : "12"),
    height: decimal(id === "pkg-small" ? "1" : "4"),
    emptyWeightGrams: decimal("10"),
    maxWeightGrams: decimal(id === "pkg-small" ? "100" : "1000"),
    materialLines: [
      {
        quantity: decimal(id === "pkg-small" ? "1" : "2"),
        material: { perUnitCost: decimal("0.25") },
      },
    ],
    ...overrides,
  };
}

describe("cartonizeOrderPackaging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("chooses one package when all units fit together", async () => {
    const db = {
      shippingPackage: { findMany: vi.fn().mockResolvedValue([packageFixture("pkg-small"), packageFixture("pkg-large")]) },
      variantCostConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            variantId: "variant-1",
            preferredPackageId: null,
            packedLength: decimal("2"),
            packedWidth: decimal("2"),
            packedHeight: decimal("0.25"),
            packedWeightGrams: decimal("15"),
            canSharePackage: true,
          },
        ]),
      },
    };

    const result = await cartonizeOrderPackaging(
      "shop-1",
      [{ id: "line-1", variantId: "variant-1", quantity: 2, subtotal: decimal("20"), packagingCost: decimal("1") }],
      db,
    );

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]).toMatchObject({ packageId: "pkg-small", quantity: 1, confidence: "high" });
    expect(result.totalMaterialCost.toString()).toBe("0.25");
  });

  it("creates multiple packages for units that cannot share", async () => {
    const db = {
      shippingPackage: { findMany: vi.fn().mockResolvedValue([packageFixture("pkg-small")]) },
      variantCostConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            variantId: "variant-1",
            preferredPackageId: null,
            packedLength: decimal("2"),
            packedWidth: decimal("2"),
            packedHeight: decimal("0.25"),
            packedWeightGrams: decimal("15"),
            canSharePackage: false,
          },
        ]),
      },
    };

    const result = await cartonizeOrderPackaging(
      "shop-1",
      [{ id: "line-1", variantId: "variant-1", quantity: 2, subtotal: decimal("20"), packagingCost: decimal("1") }],
      db,
    );

    expect(result.allocations[0]).toMatchObject({ packageId: "pkg-small", quantity: 2 });
    expect(result.reviewReasons).toContain("multiple_packages");
  });

  it("falls back with low confidence when dimensions are missing", async () => {
    const db = {
      shippingPackage: { findMany: vi.fn().mockResolvedValue([packageFixture("pkg-small")]) },
      variantCostConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            variantId: "variant-1",
            preferredPackageId: "pkg-small",
            packedLength: null,
            packedWidth: null,
            packedHeight: null,
            packedWeightGrams: null,
            canSharePackage: true,
          },
        ]),
      },
    };

    const result = await cartonizeOrderPackaging(
      "shop-1",
      [{ id: "line-1", variantId: "variant-1", quantity: 1, subtotal: decimal("20"), packagingCost: decimal("1") }],
      db,
    );

    expect(result.allocations[0]).toMatchObject({ packageId: "pkg-small", confidence: "low" });
    expect(result.reviewReasons).toContain("missing_variant_dimensions");
  });
});

describe("reconcileSnapshotPackaging", () => {
  it("creates proportional packaging adjustments and an audit signature", async () => {
    const adjustmentCreate = vi.fn().mockResolvedValue({});
    const auditLogCreate = vi.fn().mockResolvedValue({});
    const db = {
      shippingPackage: { findMany: vi.fn().mockResolvedValue([packageFixture("pkg-small")]) },
      variantCostConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            variantId: "variant-1",
            preferredPackageId: null,
            packedLength: decimal("2"),
            packedWidth: decimal("2"),
            packedHeight: decimal("0.25"),
            packedWeightGrams: decimal("15"),
            canSharePackage: true,
          },
        ]),
      },
      orderSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-04-15T00:00:00Z") }),
      },
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({ id: "period-1", status: "OPEN" }),
      },
      orderPackageAllocation: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      packagingReviewItem: {
        create: vi.fn().mockResolvedValue({}),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: auditLogCreate,
      },
      adjustment: {
        create: adjustmentCreate,
      },
    };

    await reconcileSnapshotPackaging(
      "shop-1",
      "snapshot-1",
      [
        { id: "line-1", variantId: "variant-1", quantity: 1, subtotal: decimal("30"), packagingCost: decimal("1.00") },
        { id: "line-2", variantId: "variant-1", quantity: 1, subtotal: decimal("10"), packagingCost: decimal("1.00") },
      ],
      db,
    );

    expect(db.orderPackageAllocation.upsert).toHaveBeenCalledOnce();
    expect(adjustmentCreate).toHaveBeenCalledTimes(2);
    expect(adjustmentCreate.mock.calls[0][0].data.packagingAdj.toString()).toBe("-1.3125");
    expect(adjustmentCreate.mock.calls[1][0].data.packagingAdj.toString()).toBe("-0.4375");
    expect(auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "PACKAGING_RECONCILIATION_PROCESSED" }),
    }));
    expect(recomputeTaxOffsetCache).toHaveBeenCalledWith("shop-1", db);
  });

  it("does not create adjustments for closed periods", async () => {
    const db = {
      shippingPackage: { findMany: vi.fn().mockResolvedValue([packageFixture("pkg-small")]) },
      variantCostConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            variantId: "variant-1",
            preferredPackageId: null,
            packedLength: decimal("2"),
            packedWidth: decimal("2"),
            packedHeight: decimal("0.25"),
            packedWeightGrams: decimal("15"),
            canSharePackage: true,
          },
        ]),
      },
      orderSnapshot: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date("2026-04-15T00:00:00Z") }) },
      reportingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1", status: "CLOSED" }) },
      orderPackageAllocation: { upsert: vi.fn().mockResolvedValue({}) },
      packagingReviewItem: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { findFirst: vi.fn() },
      adjustment: { create: vi.fn() },
    };

    await reconcileSnapshotPackaging(
      "shop-1",
      "snapshot-1",
      [{ id: "line-1", variantId: "variant-1", quantity: 1, subtotal: decimal("30"), packagingCost: decimal("1.00") }],
      db,
    );

    expect(db.adjustment.create).not.toHaveBeenCalled();
    expect(db.packagingReviewItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reason: "closed_period_true_up_required" }),
    }));
  });
});
