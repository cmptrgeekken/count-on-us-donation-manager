import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { listOutstandingArtistAllocations } from "./artistPayables.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

describe("listOutstandingArtistAllocations", () => {
  it("returns closed outstanding allocations through the selected period, floored to cents", async () => {
    const db = {
      artistAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "allocation-1",
            periodId: "period-1",
            artistId: "artist-1",
            artistName: "Artist One",
            creditName: "Artist Credit",
            allocated: decimal("100.00"),
            paid: decimal("76.043"),
            period: {
              startDate: new Date("2026-01-01T00:00:00.000Z"),
              endDate: new Date("2026-01-31T00:00:00.000Z"),
            },
          },
          {
            id: "allocation-2",
            periodId: "period-1",
            artistId: "artist-2",
            artistName: "Artist Two",
            creditName: "Paid Artist",
            allocated: decimal("10.00"),
            paid: decimal("10.00"),
            period: {
              startDate: new Date("2026-01-01T00:00:00.000Z"),
              endDate: new Date("2026-01-31T00:00:00.000Z"),
            },
          },
        ]),
      },
    };

    const result = await listOutstandingArtistAllocations(
      "shop-1",
      { throughPeriodEndDate: new Date("2026-02-01T00:00:00.000Z"), artistId: "artist-1" },
      db,
    );

    expect(db.artistAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopId: "shop-1",
          artistId: "artist-1",
          period: { status: "CLOSED", endDate: { lte: new Date("2026-02-01T00:00:00.000Z") } },
        }),
        orderBy: [{ period: { endDate: "asc" } }, { createdAt: "asc" }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].remaining.toString()).toBe("23.95");
  });
});
