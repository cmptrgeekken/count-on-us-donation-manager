import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeAnalyticalRecalculationSummary,
  queueAnalyticalRecalculation,
  runAnalyticalRecalculation,
} from "./analyticalRecalculation.server";

const { buildReportingSummary, resolveCosts, jobSend } = vi.hoisted(() => ({
  buildReportingSummary: vi.fn(),
  resolveCosts: vi.fn(),
  jobSend: vi.fn(),
}));

vi.mock("./reportingSummary.server", () => ({
  buildReportingSummary,
}));

vi.mock("./costEngine.server", () => ({
  resolveCosts,
}));

vi.mock("../jobs/queue.server", () => ({
  jobQueue: {
    send: jobSend,
  },
}));

const decimal = (value: string) => new Prisma.Decimal(value);

describe("analytical recalculation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues a recalculation run and writes an audit event", async () => {
    const db = {
      analyticalRecalculationRun: {
        create: vi.fn().mockResolvedValue({ id: "run-1" }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };

    const run = await queueAnalyticalRecalculation("shop-1", "period-1", db as any, { send: jobSend } as any);

    expect(run).toEqual({ id: "run-1" });
    expect(jobSend).toHaveBeenCalledWith("reporting.recalculate", { shopId: "shop-1", runId: "run-1" });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ANALYTICAL_RECALCULATION_QUEUED",
          entityId: "run-1",
        }),
      }),
    );
  });

  it("computes period and cause deltas without mutating authoritative records", async () => {
    buildReportingSummary.mockResolvedValue({
      selectedPeriodId: "period-1",
      summary: {
        track1: {
          totalNetContribution: "40.00",
          shopifyCharges: "0.00",
          allocations: [
            {
              causeId: "cause-1",
              causeName: "Playwright Cause",
              allocated: "40.00",
            },
          ],
        },
      },
    });
    resolveCosts.mockResolvedValue({
      netContribution: decimal("46.00"),
    });

    const db = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          id: "period-1",
          startDate: new Date("2026-02-01T00:00:00.000Z"),
          endDate: new Date("2026-02-15T00:00:00.000Z"),
        }),
      },
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            shopifyVariantId: "gid://shopify/ProductVariant/1",
            salePrice: decimal("50.00"),
            quantity: 1,
            netContribution: decimal("40.00"),
            adjustments: [],
            causeAllocations: [
              {
                causeId: "cause-1",
                causeName: "Playwright Cause",
                amount: decimal("40.00"),
              },
            ],
          },
        ]),
      },
      variant: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "variant-1",
            shopifyId: "gid://shopify/ProductVariant/1",
            product: {
              id: "product-1",
              shopifyId: "gid://shopify/Product/1",
            },
          },
        ]),
      },
      productCauseAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            productId: "product-1",
            percentage: decimal("100.00"),
            causeId: "cause-1",
            cause: { name: "Playwright Cause" },
          },
        ]),
      },
      orderSnapshot: {
        update: vi.fn(),
      },
      causeAllocation: {
        update: vi.fn(),
      },
      disbursement: {
        create: vi.fn(),
      },
    };

    const summary = await computeAnalyticalRecalculationSummary("shop-1", "period-1", db as any);

    expect(summary.period.netContributionDelta).toBe("6.00");
    expect(summary.causes[0]).toEqual(
      expect.objectContaining({
        causeName: "Playwright Cause",
        delta: "6.00",
      }),
    );
    expect(db.orderSnapshot.update).not.toHaveBeenCalled();
    expect(db.causeAllocation.update).not.toHaveBeenCalled();
    expect(db.disbursement.create).not.toHaveBeenCalled();
  });

  it("persists a completed run summary", async () => {
    const db = {
      analyticalRecalculationRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "run-1",
          periodId: "period-1",
        }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          id: "period-1",
          startDate: new Date("2026-02-01T00:00:00.000Z"),
          endDate: new Date("2026-02-15T00:00:00.000Z"),
        }),
      },
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      variant: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      productCauseAssignment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    buildReportingSummary.mockResolvedValue({
      selectedPeriodId: "period-1",
      summary: {
        track1: {
          totalNetContribution: "40.00",
          shopifyCharges: "5.00",
          allocations: [],
        },
      },
    });

    await runAnalyticalRecalculation("shop-1", "run-1", db as any);

    expect(db.analyticalRecalculationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          status: "completed",
          summary: expect.any(Object),
        }),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ANALYTICAL_RECALCULATION_COMPLETED",
        }),
      }),
    );
  });
});
