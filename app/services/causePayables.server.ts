import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);

type CausePayablesDbClient = {
  causeAllocation: {
    findMany: typeof import("../db.server").prisma.causeAllocation.findMany;
  };
};

function floorCurrency(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR);
}

export type OutstandingCauseAllocation = {
  id: string;
  periodId: string;
  periodStartDate: Date;
  periodEndDate: Date;
  causeId: string;
  causeName: string;
  is501c3: boolean;
  allocated: Prisma.Decimal;
  disbursed: Prisma.Decimal;
  remaining: Prisma.Decimal;
};

export async function listOutstandingCauseAllocations(
  shopId: string,
  input: {
    throughPeriodEndDate: Date;
    causeId?: string;
  },
  db: CausePayablesDbClient,
): Promise<OutstandingCauseAllocation[]> {
  const allocations = await db.causeAllocation.findMany({
    where: {
      shopId,
      ...(input.causeId ? { causeId: input.causeId } : {}),
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
      causeId: true,
      causeName: true,
      is501c3: true,
      allocated: true,
      disbursed: true,
      period: {
        select: {
          startDate: true,
          endDate: true,
        },
      },
    },
  });

  return allocations
    .map<OutstandingCauseAllocation>((allocation) => ({
      id: allocation.id,
      periodId: allocation.periodId,
      periodStartDate: allocation.period.startDate,
      periodEndDate: allocation.period.endDate,
      causeId: allocation.causeId,
      causeName: allocation.causeName,
      is501c3: allocation.is501c3,
      allocated: allocation.allocated,
      disbursed: allocation.disbursed,
      remaining: floorCurrency(allocation.allocated.sub(allocation.disbursed)),
    }))
    .filter((allocation) => allocation.remaining.greaterThan(ZERO));
}
