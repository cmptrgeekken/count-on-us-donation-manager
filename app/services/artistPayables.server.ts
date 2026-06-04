import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);

type ArtistPayablesDbClient = {
  artistAllocation: {
    findMany: typeof import("../db.server").prisma.artistAllocation.findMany;
  };
};

function floorCurrency(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR);
}

export type OutstandingArtistAllocation = {
  id: string;
  periodId: string;
  periodStartDate: Date;
  periodEndDate: Date;
  artistId: string;
  artistName: string;
  creditName: string;
  allocated: Prisma.Decimal;
  paid: Prisma.Decimal;
  remaining: Prisma.Decimal;
};

export async function listOutstandingArtistAllocations(
  shopId: string,
  input: {
    throughPeriodEndDate: Date;
    artistId?: string;
  },
  db: ArtistPayablesDbClient,
): Promise<OutstandingArtistAllocation[]> {
  const allocations = await db.artistAllocation.findMany({
    where: {
      shopId,
      ...(input.artistId ? { artistId: input.artistId } : {}),
      period: {
        status: "CLOSED",
        endDate: {
          lte: input.throughPeriodEndDate,
        },
      },
    },
    orderBy: [{ period: { endDate: "asc" } }, { createdAt: "asc" }],
    select: {
      id: true,
      periodId: true,
      artistId: true,
      artistName: true,
      creditName: true,
      allocated: true,
      paid: true,
      period: {
        select: {
          startDate: true,
          endDate: true,
        },
      },
    },
  });

  return allocations
    .map<OutstandingArtistAllocation>((allocation) => ({
      id: allocation.id,
      periodId: allocation.periodId,
      periodStartDate: allocation.period.startDate,
      periodEndDate: allocation.period.endDate,
      artistId: allocation.artistId,
      artistName: allocation.artistName,
      creditName: allocation.creditName,
      allocated: allocation.allocated,
      paid: allocation.paid,
      remaining: floorCurrency(allocation.allocated.sub(allocation.paid)),
    }))
    .filter((allocation) => allocation.remaining.greaterThan(ZERO));
}
