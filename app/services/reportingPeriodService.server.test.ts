import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeReportingPeriod,
  createOrOpenReportingPeriod,
  createReportingPeriodFromPayout,
  materializeArtistAllocationsForPeriod,
  materializeCauseAllocationsForPeriod,
} from "./reportingPeriodService.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

describe("createOrOpenReportingPeriod", () => {
  it("upserts payout-backed reporting periods by Shopify payout id", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "period-1" });
    const db = {
      reportingPeriod: { upsert },
    };

    await createOrOpenReportingPeriod(
      {
        shopId: "shop-1",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-08T00:00:00.000Z"),
        shopifyPayoutId: "payout-1",
      },
      db as any,
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shopId_shopifyPayoutId: {
            shopId: "shop-1",
            shopifyPayoutId: "payout-1",
          },
        },
        create: expect.objectContaining({
          source: "payout",
        }),
      }),
    );
  });

  it("rejects invalid date ranges", async () => {
    await expect(
      createOrOpenReportingPeriod(
        {
          shopId: "shop-1",
          startDate: new Date("2026-04-08T00:00:00.000Z"),
          endDate: new Date("2026-04-01T00:00:00.000Z"),
        },
        {} as any,
      ),
    ).rejects.toThrow("endDate must be after startDate");
  });
});

describe("createReportingPeriodFromPayout", () => {
  it("creates payout-backed periods from Shopify payout payloads", async () => {
    const findFirst = vi.fn().mockResolvedValue({ endDate: new Date("2026-04-01T00:00:00.000Z") });
    const upsert = vi.fn().mockResolvedValue({ id: "period-1" });
    const db = {
      reportingPeriod: {
        findFirst,
        upsert,
      },
    };

    await createReportingPeriodFromPayout(
      "shop-1",
      {
        id: 123,
        date: "2026-04-07",
      },
      db as any,
    );

    expect(findFirst).toHaveBeenCalledWith({
      where: { shopId: "shop-1" },
      orderBy: { endDate: "desc" },
      select: { endDate: true },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shopId_shopifyPayoutId: {
            shopId: "shop-1",
            shopifyPayoutId: "123",
          },
        },
        create: expect.objectContaining({
          startDate: new Date("2026-04-01T00:00:00.000Z"),
          endDate: new Date("2026-04-08T00:00:00.000Z"),
          source: "payout",
        }),
      }),
    );
  });
});

describe("materializeCauseAllocationsForPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("materializes cause allocation totals with proportional adjustments", async () => {
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            netContribution: decimal("100"),
            adjustments: [{ netContribAdj: decimal("-25") }],
            causeAllocations: [
              {
                causeId: "cause-1",
                causeName: "Cause One",
                is501c3: true,
                amount: decimal("60"),
              },
              {
                causeId: "cause-2",
                causeName: "Cause Two",
                is501c3: false,
                amount: decimal("40"),
              },
            ],
          },
          {
            netContribution: decimal("50"),
            adjustments: [],
            causeAllocations: [
              {
                causeId: "cause-1",
                causeName: "Cause One",
                is501c3: true,
                amount: decimal("10"),
              },
            ],
          },
        ]),
      },
      causeAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "existing-cause-1",
            causeId: "cause-1",
            _count: { applications: 1 },
          },
          {
            id: "stale-unpaid-cause",
            causeId: "cause-stale",
            _count: { applications: 0 },
          },
          {
            id: "stale-paid-cause",
            causeId: "cause-paid-stale",
            _count: { applications: 1 },
          },
        ]),
        updateMany,
        deleteMany,
        create,
      },
    };

    const result = await materializeCauseAllocationsForPeriod(
      "shop-1",
      {
        id: "period-1",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-08T00:00:00.000Z"),
      },
      db as any,
    );

    expect(result).toHaveLength(2);
    expect(result.find((row) => row.causeId === "cause-1")?.allocated.toString()).toBe("55");
    expect(result.find((row) => row.causeId === "cause-2")?.allocated.toString()).toBe("30");
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "existing-cause-1",
        shopId: "shop-1",
      },
      data: expect.objectContaining({
        causeName: "Cause One",
        allocated: expect.any(Prisma.Decimal),
      }),
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        causeId: "cause-2",
        allocated: expect.any(Prisma.Decimal),
      }),
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        id: { in: ["stale-unpaid-cause"] },
      },
    });
  });

  it("withholds the estimated tax reserve from materialized cause allocations", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const db = {
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            netContribution: decimal("100"),
            adjustments: [],
            causeAllocations: [
              {
                causeId: "cause-1",
                causeName: "Cause One",
                is501c3: true,
                amount: decimal("60"),
              },
              {
                causeId: "cause-2",
                causeName: "Cause Two",
                is501c3: false,
                amount: decimal("40"),
              },
            ],
          },
        ]),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          effectiveTaxRate: decimal("0.25"),
          taxDeductionMode: "all_causes",
        }),
      },
      businessExpense: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("0") } }),
      },
      causeAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
        create,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        deleteMany: vi.fn().mockResolvedValue(undefined),
      },
    };

    const result = await materializeCauseAllocationsForPeriod(
      "shop-1",
      {
        id: "period-1",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-08T00:00:00.000Z"),
      },
      db as any,
    );

    expect(result.map((row) => ({
      causeId: row.causeId,
      allocated: row.allocated.toString(),
      taxReserveDeduction: row.taxReserveDeduction.toString(),
    }))).toEqual([
      { causeId: "cause-1", allocated: "45", taxReserveDeduction: "15" },
      { causeId: "cause-2", allocated: "30", taxReserveDeduction: "10" },
    ]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("uses current product cause routing when rebuilding materialized allocations", async () => {
    const db = {
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([{
          shopifyProductId: "gid://shopify/Product/1",
          netContribution: decimal("50"),
          adjustments: [],
          causeAllocations: [{
            causeId: "old-cause",
            causeName: "Old Cause",
            is501c3: true,
            percentage: decimal("100"),
            amount: decimal("50"),
            source: "product",
          }],
        }]),
      },
      productCauseAssignment: {
        findMany: vi.fn().mockResolvedValue([{
          shopifyProductId: "gid://shopify/Product/1",
          causeId: "new-cause",
          percentage: decimal("100"),
          cause: { name: "New Cause", is501c3: true },
        }]),
      },
      shop: { findUnique: vi.fn().mockResolvedValue(null) },
      businessExpense: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
      causeAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        deleteMany: vi.fn().mockResolvedValue(undefined),
      },
    };

    const result = await materializeCauseAllocationsForPeriod(
      "shop-1",
      {
        id: "period-1",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-08T00:00:00.000Z"),
      },
      db as any,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      causeId: "new-cause",
      causeName: "New Cause",
      allocated: decimal("50"),
    }));
  });
});

describe("materializeArtistAllocationsForPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes payouts when the order is attributed to the same artist", async () => {
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(undefined);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      lineArtistAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            artistId: "artist-1",
            artistName: "Ada Artist",
            creditName: "Ada",
            payoutAmount: decimal("12.00"),
            snapshotLine: {
              netContribution: decimal("20.00"),
              adjustments: [],
              snapshot: {
                artistAttribution: { artistId: "artist-1" },
              },
            },
          },
          {
            artistId: "artist-2",
            artistName: "Bea Artist",
            creditName: "Bea",
            payoutAmount: decimal("8.00"),
            snapshotLine: {
              netContribution: decimal("20.00"),
              adjustments: [{ netContribAdj: decimal("-10.00") }],
              snapshot: {
                artistAttribution: { artistId: "artist-1" },
              },
            },
          },
        ]),
      },
      artistAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "stale-unpaid-artist",
            artistId: "artist-1",
            _count: { applications: 0 },
          },
        ]),
        updateMany,
        deleteMany,
        create,
      },
    };

    const result = await materializeArtistAllocationsForPeriod(
      "shop-1",
      {
        id: "period-1",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-08T00:00:00.000Z"),
      },
      db as any,
    );

    expect(db.lineArtistAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payoutEnabled: true,
          payoutExclusionReason: null,
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.artistId).toBe("artist-2");
    expect(result[0]?.allocated.toString()).toBe("4");
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        artistId: "artist-2",
        allocated: expect.any(Prisma.Decimal),
      }),
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        id: { in: ["stale-unpaid-artist"] },
      },
    });
  });
});

describe("closeReportingPeriod", () => {
  it("moves an open period through closing to closed and audit logs it", async () => {
    const period = {
      id: "period-1",
      shopId: "shop-1",
      status: "OPEN",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2026-04-08T00:00:00.000Z"),
    };
    const closedAt = new Date("2026-04-08T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(closedAt);

    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue(period),
        update: vi
          .fn()
          .mockResolvedValueOnce({ ...period, status: "CLOSING" })
          .mockResolvedValueOnce({ ...period, status: "CLOSED", closedAt }),
      },
      orderSnapshot: {
        updateMany: vi.fn().mockResolvedValue(undefined),
      },
      orderSettlement: {
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue(undefined),
      },
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      causeAllocation: {
        deleteMany: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };

    const result = await closeReportingPeriod("shop-1", "period-1", db as any);

    expect(result.closed).toBe(true);
    expect(tx.reportingPeriod.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: { status: "CLOSING" } }),
    );
    expect(tx.orderSnapshot.updateMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        currentForOrderRecord: { isNot: null },
        orderRecord: {
          lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
        },
        createdAt: {
          gte: period.startDate,
          lt: period.endDate,
        },
      },
      data: { periodId: "period-1" },
    });
    expect(tx.orderSettlement.updateMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        snapshot: {
          currentForOrderRecord: { isNot: null },
          orderRecord: {
            lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
          },
          createdAt: {
            gte: period.startDate,
            lt: period.endDate,
          },
        },
      },
      data: { periodId: "period-1" },
    });
    expect(tx.reportingPeriod.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          status: "CLOSED",
          closedAt,
        },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "ReportingPeriod",
          action: "REPORTING_PERIOD_CLOSED",
        }),
      }),
    );

    vi.useRealTimers();
  });

  it("blocks closing when external settlement reviews are unresolved", async () => {
    const period = {
      id: "period-1",
      shopId: "shop-1",
      status: "OPEN",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2026-04-08T00:00:00.000Z"),
    };
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue(period),
      },
      orderSettlement: {
        count: vi.fn().mockResolvedValue(1),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };

    await expect(closeReportingPeriod("shop-1", "period-1", db as any)).rejects.toThrow(
      "Resolve 1 external settlement review before closing this reporting period.",
    );
  });
});
