import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  reconcileCauseDisbursements,
  reconcileExistingDisbursementsForShop,
} from "./disbursementReconciliation.server";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("reconcileCauseDisbursements", () => {
  it("excludes the paid day and classifies the unavailable amount as extra", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ id: "allocation-before" }, { id: "allocation-on-day" }])
      .mockResolvedValueOnce([
        {
          id: "allocation-before",
          periodId: "period-before",
          causeId: "cause-1",
          causeName: "Cause One",
          is501c3: true,
          allocated: decimal("40.00"),
          disbursed: decimal("0"),
          adjustments: [],
          period: {
            startDate: new Date("2026-06-01T00:00:00.000Z"),
            endDate: new Date("2026-06-10T00:00:00.000Z"),
          },
        },
      ]);
    const db = {
      disbursement: {
        findMany: vi.fn().mockResolvedValue([{
          id: "payment-1",
          amount: decimal("60.00"),
          feesCoveredAmount: decimal("0"),
          paidAt: new Date("2026-06-15T00:00:00.000Z"),
          period: { endDate: new Date("2026-06-30T00:00:00.000Z") },
        }]),
        update: vi.fn().mockResolvedValue(undefined),
      },
      causeAllocation: {
        findMany,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      disbursementApplication: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue(undefined),
      },
      auditLog: { create: vi.fn().mockResolvedValue(undefined) },
    };

    await reconcileCauseDisbursements("shop-1", "cause-1", db as never);

    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        shopId: "shop-1",
        period: { status: "CLOSED", endDate: { lte: new Date("2026-06-15T00:00:00.000Z") } },
      }),
    }));
    expect(db.disbursement.update).toHaveBeenCalledWith({
      where: { id: "payment-1", shopId: "shop-1" },
      data: {
        allocatedAmount: decimal("40"),
        extraContributionAmount: decimal("20"),
      },
    });
  });

  it("records a tax-buffer adjustment without rewriting a closed allocation", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const auditCreate = vi.fn().mockResolvedValue(undefined);
    const tx = {
      causeAllocation: {
        findMany: vi.fn().mockResolvedValue([{
          id: "allocation-1",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          allocated: decimal("100"),
          taxReserveDeduction: decimal("25"),
          applications: [{ disbursement: { paidAt: new Date("2026-06-15T00:00:00.000Z") } }],
        }]),
      },
      causeAllocationAdjustment: { upsert },
      auditLog: { create: auditCreate },
    };
    const db = {
      $transaction: vi.fn().mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      disbursement: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await reconcileExistingDisbursementsForShop("shop-1", db as never);

    expect(result.adjustmentCount).toBe(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        shopId: "shop-1",
        causeAllocationId: "allocation-1",
        type: "RETROACTIVE_TAX_BUFFER",
        sourceKey: "date-bounded-v1",
        amount: decimal("25"),
        effectiveAt: new Date("2026-06-15T00:00:00.000Z"),
      }),
      update: {},
    }));
    expect(tx.causeAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shopId: "shop-1" }),
    }));
  });
});
