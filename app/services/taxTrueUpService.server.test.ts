import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  recordTaxTrueUp,
  taxTrueUpErrorCodes,
} from "./taxTrueUpService.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

describe("recordTaxTrueUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records an exact-match true-up without an applied period", async () => {
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.status === "OPEN") return null;
          return {
            id: "period-1",
            status: "CLOSED",
            startDate: new Date("2026-03-01T00:00:00.000Z"),
            endDate: new Date("2026-03-15T00:00:00.000Z"),
          };
        }),
      },
      taxTrueUp: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "true-up-1", redistributions: [] }),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          effectiveTaxRate: decimal("0.25"),
          taxDeductionMode: "all_causes",
        }),
      },
      orderSnapshotLine: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netContribution: decimal("100.00") } }),
      },
      adjustment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netContribAdj: decimal("0.00") } }),
      },
      causeAllocation: {
        findMany: vi.fn().mockResolvedValue([
          { is501c3: true, allocated: decimal("60.00") },
          { is501c3: false, allocated: decimal("40.00") },
        ]),
      },
      lineCauseAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      businessExpense: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("20.00") } }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };

    await recordTaxTrueUp(
      "shop-1",
      {
        periodId: "period-1",
        actualTax: "20.00",
        filedAt: new Date("2026-04-08T00:00:00.000Z"),
      },
      { db: db as any },
    );

    expect(tx.taxTrueUp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appliedPeriodId: null,
          estimatedTax: decimal("20.00"),
          actualTax: decimal("20.00"),
          delta: decimal("0.00"),
        }),
      }),
    );
  });

  it("requires surplus redistributions to match the surplus exactly", async () => {
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.status === "OPEN") return { id: "period-open" };
          return {
            id: "period-1",
            status: "CLOSED",
            startDate: new Date("2026-03-01T00:00:00.000Z"),
            endDate: new Date("2026-03-15T00:00:00.000Z"),
          };
        }),
      },
      taxTrueUp: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          effectiveTaxRate: decimal("0.25"),
          taxDeductionMode: "all_causes",
        }),
      },
      orderSnapshotLine: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netContribution: decimal("100.00") } }),
      },
      adjustment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netContribAdj: decimal("0.00") } }),
      },
      causeAllocation: {
        findMany: vi.fn().mockResolvedValue([
          { is501c3: true, allocated: decimal("60.00") },
          { is501c3: false, allocated: decimal("40.00") },
        ]),
      },
      lineCauseAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      businessExpense: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("20.00") } }),
      },
      cause: {
        findMany: vi.fn().mockResolvedValue([{ id: "cause-1", name: "Cause One" }]),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };

    await expect(
      recordTaxTrueUp(
        "shop-1",
        {
          periodId: "period-1",
          actualTax: "15.00",
          filedAt: new Date("2026-04-08T00:00:00.000Z"),
          redistributions: [{ causeId: "cause-1", amount: "2.00" }],
        },
        { db: db as any },
      ),
    ).rejects.toMatchObject({
      code: taxTrueUpErrorCodes.REDISTRIBUTION_MISMATCH,
    });
  });

  it("requires shortfall confirmation before recording", async () => {
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.status === "OPEN") return { id: "period-open" };
          return {
            id: "period-1",
            status: "CLOSED",
            startDate: new Date("2026-03-01T00:00:00.000Z"),
            endDate: new Date("2026-03-15T00:00:00.000Z"),
          };
        }),
      },
      taxTrueUp: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          effectiveTaxRate: decimal("0.25"),
          taxDeductionMode: "all_causes",
        }),
      },
      orderSnapshotLine: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netContribution: decimal("100.00") } }),
      },
      adjustment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netContribAdj: decimal("0.00") } }),
      },
      causeAllocation: {
        findMany: vi.fn().mockResolvedValue([
          { is501c3: true, allocated: decimal("60.00") },
          { is501c3: false, allocated: decimal("40.00") },
        ]),
      },
      lineCauseAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      businessExpense: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("20.00") } }),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };

    await expect(
      recordTaxTrueUp(
        "shop-1",
        {
          periodId: "period-1",
          actualTax: "22.00",
          filedAt: new Date("2026-04-08T00:00:00.000Z"),
        },
        { db: db as any },
      ),
    ).rejects.toMatchObject({
      code: taxTrueUpErrorCodes.SHORTFALL_CONFIRMATION_REQUIRED,
    });
  });
});
