import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { listOutstandingCauseAllocations } from "./causePayables.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

describe("listOutstandingCauseAllocations", () => {
  it("returns closed outstanding allocations through the selected period, floored to cents", async () => {
    const db = {
      causeAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "allocation-1",
            periodId: "period-1",
            causeId: "cause-1",
            causeName: "Cause One",
            is501c3: true,
            allocated: decimal("100.00"),
            disbursed: decimal("76.043"),
            adjustments: [{ amount: decimal("3.00") }],
            period: {
              startDate: new Date("2026-01-01T00:00:00.000Z"),
              endDate: new Date("2026-01-31T00:00:00.000Z"),
            },
          },
          {
            id: "allocation-2",
            periodId: "period-1",
            causeId: "cause-2",
            causeName: "Cause Two",
            is501c3: false,
            allocated: decimal("10.00"),
            disbursed: decimal("10.00"),
            period: {
              startDate: new Date("2026-01-01T00:00:00.000Z"),
              endDate: new Date("2026-01-31T00:00:00.000Z"),
            },
          },
        ]),
      },
    };

    const result = await listOutstandingCauseAllocations(
      "shop-1",
      { throughPeriodEndDate: new Date("2026-02-01T00:00:00.000Z"), causeId: "cause-1" },
      db,
    );

    expect(db.causeAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopId: "shop-1",
          causeId: "cause-1",
          period: { status: "CLOSED", endDate: { lte: new Date("2026-02-01T00:00:00.000Z") } },
        }),
        orderBy: [{ period: { endDate: "asc" } }, { createdAt: "asc" }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].adjustments.toString()).toBe("3");
    expect(result[0].adjustedOutstanding.toString()).toBe("20.95");
    expect(result[0].remaining.toString()).toBe("20.95");
  });
});
