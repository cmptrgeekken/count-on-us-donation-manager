import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  bulkReviewOrderLifecycles,
  deriveLifecycleState,
  mergeOrderLifecycle,
  reconcileLifecycleAdjustmentsForSnapshot,
  resolveEligibleQuantity,
} from "./orderLifecycle.server";

describe("order lifecycle eligibility", () => {
  it("normalizes Shopify lifecycle states", () => {
    expect(deriveLifecycleState({ financial_status: "paid" })).toBe("active");
    expect(deriveLifecycleState({ financial_status: "partially_refunded" })).toBe("partially_refunded");
    expect(deriveLifecycleState({ financial_status: "refunded" })).toBe("fully_refunded");
    expect(deriveLifecycleState({ financial_status: "paid", cancelled_at: "2026-07-14T00:00:00Z" })).toBe("canceled");
    expect(deriveLifecycleState({})).toBe("unknown");
    expect(deriveLifecycleState({ financial_status: "Partially Refunded" })).toBe("partially_refunded");
    expect(deriveLifecycleState({ financial_status: "pending", fulfillment_status: "unfulfilled" })).toBe("review_required");
    expect(deriveLifecycleState({ financial_status: "pending", fulfillment_status: "fulfilled" })).toBe("active");
  });

  it("bulk-confirms selected unresolved lifecycles in one shop-scoped transaction", async () => {
    const tx = {
      orderLifecycle: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    const db = {
      orderSnapshot: {
        findMany: vi.fn().mockResolvedValue([
          { id: "snapshot-1", orderRecordId: "order-1" },
          { id: "snapshot-2", orderRecordId: "order-2" },
        ]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };

    const result = await bulkReviewOrderLifecycles({
      shopId: "shop-1",
      snapshotIds: ["snapshot-1", "snapshot-2", "snapshot-2", "foreign-snapshot"],
      state: "active",
      db: db as never,
    });

    expect(result).toEqual({ reviewed: 2, skipped: 1 });
    expect(db.orderSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        shopId: "shop-1",
        id: { in: ["snapshot-1", "snapshot-2", "foreign-snapshot"] },
        currentForOrderRecord: { isNot: null },
      }),
    }));
    expect(tx.orderLifecycle.createMany).toHaveBeenCalledOnce();
    expect(tx.orderLifecycle.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { shopId: "shop-1", orderRecordId: { in: ["order-1", "order-2"] } },
      data: expect.objectContaining({ state: "active", financialStatus: "paid", source: "merchant_review" }),
    }));
    expect(tx.auditLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ shopId: "shop-1", entityId: "order-1", action: "LIFECYCLE_MERCHANT_CONFIRMED" }),
        expect.objectContaining({ shopId: "shop-1", entityId: "order-2", action: "LIFECYCLE_MERCHANT_CONFIRMED" }),
      ]),
    });
  });

  it("keeps only unrefunded merchandise quantity", () => {
    const result = resolveEligibleQuantity({
      originalQuantity: new Prisma.Decimal(5),
      refundedQuantity: new Prisma.Decimal(2),
      lifecycleState: "partially_refunded",
    });
    expect(result.eligibleQuantity.toString()).toBe("3");
    expect(result.eligibleFraction.toString()).toBe("0.6");
    expect(result.excluded).toBe(false);
  });

  it("excludes canceled, fully refunded, and unknown orders", () => {
    expect(resolveEligibleQuantity({ originalQuantity: 2, lifecycleState: "canceled" }).eligibleQuantity.toString()).toBe("0");
    expect(resolveEligibleQuantity({ originalQuantity: 2, lifecycleState: "fully_refunded" }).eligibleQuantity.toString()).toBe("0");
    expect(resolveEligibleQuantity({ originalQuantity: 2, lifecycleState: "unknown" }).reviewRequired).toBe(true);
  });

  it("clamps duplicate refund quantities at zero eligible quantity", () => {
    const result = resolveEligibleQuantity({
      originalQuantity: 2,
      refundedQuantity: 9,
      lifecycleState: "partially_refunded",
    });
    expect(result.eligibleQuantity.toString()).toBe("0");
    expect(result.eligibleFraction.toString()).toBe("0");
  });

  it("does not let a stale webhook reset newer lifecycle evidence", async () => {
    const db = {
      orderLifecycle: {
        findUnique: vi.fn().mockResolvedValue({
          state: "canceled",
          source: "webhook",
          sourceUpdatedAt: new Date("2026-07-14T12:00:00.000Z"),
        }),
        upsert: vi.fn(),
      },
    };

    const result = await mergeOrderLifecycle({
      shopId: "shop-1",
      orderRecordId: "order-1",
      payload: {
        financial_status: "paid",
        updated_at: "2026-07-14T11:00:00.000Z",
      },
      source: "webhook",
      db: db as never,
    });

    expect(result).toEqual({ state: "canceled", updated: false });
    expect(db.orderLifecycle.upsert).not.toHaveBeenCalled();
  });

  it("does not double-deduct a partial refund already represented by a refund adjustment", async () => {
    const db = {
      orderLifecycle: {
        findUnique: vi.fn().mockResolvedValue({ state: "partially_refunded" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderRefundLine: {
        groupBy: vi.fn().mockResolvedValue([{ shopifyLineItemId: "line-1", _sum: { quantity: new Prisma.Decimal(1) } }]),
      },
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([{
          id: "snapshot-line-1",
          shopifyLineItemId: "line-1",
          quantity: 2,
          laborCost: new Prisma.Decimal(4),
          materialCost: new Prisma.Decimal(10),
          packagingCost: new Prisma.Decimal(2),
          equipmentCost: new Prisma.Decimal(4),
          netContribution: new Prisma.Decimal(20),
        }]),
      },
      orderAdjustmentEvent: {
        upsert: vi.fn().mockResolvedValue({ id: "lifecycle-event" }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      adjustment: {
        findMany: vi.fn().mockResolvedValue([{
          snapshotLineId: "snapshot-line-1",
          laborAdj: new Prisma.Decimal(-2),
          materialAdj: new Prisma.Decimal(-5),
          packagingAdj: new Prisma.Decimal(-1),
          equipmentAdj: new Prisma.Decimal(-2),
          netContribAdj: new Prisma.Decimal(-10),
          adjustmentEvent: { sourceType: "refund" },
        }]),
        upsert: vi.fn().mockResolvedValue({ id: "application-1" }),
      },
    };

    await reconcileLifecycleAdjustmentsForSnapshot({
      shopId: "shop-1",
      orderRecordId: "order-1",
      snapshotId: "snapshot-1",
      db: db as never,
    });

    const lifecycleApplication = db.adjustment.upsert.mock.calls.at(-1)?.[0];
    expect(lifecycleApplication.update.laborAdj.toString()).toBe("0");
    expect(lifecycleApplication.update.materialAdj.toString()).toBe("0");
    expect(lifecycleApplication.update.netContribAdj.toString()).toBe("0");
  });

  it("creates a full reversing adjustment for a canceled order", async () => {
    const db = {
      orderLifecycle: {
        findUnique: vi.fn().mockResolvedValue({ state: "canceled" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      orderRefundLine: { groupBy: vi.fn().mockResolvedValue([]) },
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([{
          id: "snapshot-line-1",
          shopifyLineItemId: "line-1",
          quantity: 1,
          laborCost: new Prisma.Decimal(2),
          materialCost: new Prisma.Decimal(5),
          packagingCost: new Prisma.Decimal(1),
          equipmentCost: new Prisma.Decimal(2),
          netContribution: new Prisma.Decimal(10),
        }]),
      },
      orderAdjustmentEvent: {
        upsert: vi.fn().mockResolvedValue({ id: "lifecycle-event" }),
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ sourceKey: "order-update:event" }]),
      },
      adjustment: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({ id: "application-1" }),
      },
    };

    const result = await reconcileLifecycleAdjustmentsForSnapshot({
      shopId: "shop-1",
      orderRecordId: "order-1",
      snapshotId: "snapshot-1",
      db: db as never,
    });

    const lifecycleApplication = db.adjustment.upsert.mock.calls.at(-1)?.[0];
    expect(lifecycleApplication.create.materialAdj.toString()).toBe("-5");
    expect(lifecycleApplication.create.netContribAdj.toString()).toBe("-10");
    expect(result.unresolved).toEqual(["order-update:event"]);
  });
});
