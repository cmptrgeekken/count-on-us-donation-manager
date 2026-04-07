import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";

const ZERO = new Prisma.Decimal(0);
const ADJUSTMENT_RATIO_GUARD = new Prisma.Decimal(10);

type DbClient = typeof prisma;

type ReportingPeriodInput = {
  shopId: string;
  startDate: Date;
  endDate: Date;
  shopifyPayoutId?: string | null;
  source?: string;
};

type PayoutPayload = {
  id?: string | number;
  admin_graphql_api_id?: string;
  period_start?: string;
  period_end?: string;
  date?: string;
  issued_at?: string;
  created_at?: string;
};

type AllocationDraft = {
  causeId: string;
  causeName: string;
  is501c3: boolean;
  allocated: Prisma.Decimal;
};

function addAllocation(
  allocations: Map<string, AllocationDraft>,
  input: AllocationDraft,
) {
  const current = allocations.get(input.causeId);
  if (!current) {
    allocations.set(input.causeId, input);
    return;
  }

  allocations.set(input.causeId, {
    ...current,
    allocated: current.allocated.add(input.allocated),
  });
}

function computeAdjustedAllocationAmount({
  baseAmount,
  lineNetContribution,
  lineAdjustmentTotal,
}: {
  baseAmount: Prisma.Decimal;
  lineNetContribution: Prisma.Decimal;
  lineAdjustmentTotal: Prisma.Decimal;
}) {
  if (lineNetContribution.equals(0) || lineAdjustmentTotal.equals(0)) {
    return baseAmount;
  }

  const adjustmentRatio = lineAdjustmentTotal.div(lineNetContribution);
  if (adjustmentRatio.abs().greaterThan(ADJUSTMENT_RATIO_GUARD)) {
    return baseAmount;
  }

  return baseAmount.add(baseAmount.mul(adjustmentRatio));
}

export async function createOrOpenReportingPeriod(
  input: ReportingPeriodInput,
  db: DbClient = prisma,
) {
  if (input.endDate <= input.startDate) {
    throw new Error("Reporting period endDate must be after startDate.");
  }

  if (input.shopifyPayoutId) {
    return db.reportingPeriod.upsert({
      where: {
        shopId_shopifyPayoutId: {
          shopId: input.shopId,
          shopifyPayoutId: input.shopifyPayoutId,
        },
      },
      create: {
        shopId: input.shopId,
        startDate: input.startDate,
        endDate: input.endDate,
        shopifyPayoutId: input.shopifyPayoutId,
        source: input.source ?? "payout",
      },
      update: {},
    });
  }

  return db.reportingPeriod.create({
    data: {
      shopId: input.shopId,
      startDate: input.startDate,
      endDate: input.endDate,
      source: input.source ?? "manual",
    },
  });
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function createReportingPeriodFromPayout(
  shopId: string,
  payload: PayoutPayload,
  db: DbClient = prisma,
) {
  const shopifyPayoutId = payload.admin_graphql_api_id ?? payload.id?.toString();
  if (!shopifyPayoutId) {
    throw new Error("Payout payload is missing an id.");
  }

  const explicitEndDate = parseDate(payload.period_end);
  const rawEndDate =
    explicitEndDate ??
    parseDate(payload.date) ??
    parseDate(payload.issued_at) ??
    parseDate(payload.created_at) ??
    new Date();
  const previousPeriod = await db.reportingPeriod.findFirst({
    where: { shopId },
    orderBy: { endDate: "desc" },
    select: { endDate: true },
  });
  const explicitStartDate = parseDate(payload.period_start);
  const endDate = explicitEndDate ?? addUtcDays(startOfUtcDay(rawEndDate), 1);
  const startDate = explicitStartDate ?? previousPeriod?.endDate ?? startOfUtcDay(rawEndDate);

  return createOrOpenReportingPeriod(
    {
      shopId,
      startDate,
      endDate,
      shopifyPayoutId,
      source: "payout",
    },
    db,
  );
}

export async function materializeCauseAllocationsForPeriod(
  shopId: string,
  period: { id: string; startDate: Date; endDate: Date },
  db: DbClient = prisma,
) {
  const snapshotLines = await db.orderSnapshotLine.findMany({
    where: {
      shopId,
      snapshot: {
        createdAt: {
          gte: period.startDate,
          lt: period.endDate,
        },
      },
    },
    select: {
      netContribution: true,
      adjustments: {
        select: { netContribAdj: true },
      },
      causeAllocations: {
        select: {
          causeId: true,
          causeName: true,
          is501c3: true,
          amount: true,
        },
      },
    },
  });

  const allocations = new Map<string, AllocationDraft>();

  for (const line of snapshotLines) {
    const lineAdjustmentTotal = line.adjustments.reduce(
      (sum, adjustment) => sum.add(adjustment.netContribAdj),
      ZERO,
    );

    for (const allocation of line.causeAllocations) {
      addAllocation(allocations, {
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: computeAdjustedAllocationAmount({
          baseAmount: allocation.amount,
          lineNetContribution: line.netContribution,
          lineAdjustmentTotal,
        }),
      });
    }
  }

  const rows = Array.from(allocations.values()).map((allocation) => ({
    shopId,
    periodId: period.id,
    causeId: allocation.causeId,
    causeName: allocation.causeName,
    is501c3: allocation.is501c3,
    allocated: allocation.allocated,
  }));

  await db.causeAllocation.deleteMany({
    where: {
      shopId,
      periodId: period.id,
    },
  });

  if (rows.length > 0) {
    await db.causeAllocation.createMany({ data: rows });
  }

  return rows;
}

export async function closeReportingPeriod(
  shopId: string,
  periodId: string,
  db: DbClient = prisma,
) {
  return db.$transaction(async (tx) => {
    const period = await tx.reportingPeriod.findFirst({
      where: {
        shopId,
        id: periodId,
      },
    });

    if (!period) {
      throw new Error("Reporting period not found.");
    }

    if (period.status === "CLOSED") {
      const allocations = await tx.causeAllocation.findMany({
        where: {
          shopId,
          periodId,
        },
      });
      return { closed: false, period, allocations };
    }

    const closingPeriod = await tx.reportingPeriod.update({
      where: {
        id: period.id,
        shopId,
      },
      data: { status: "CLOSING" },
    });

    await tx.orderSnapshot.updateMany({
      where: {
        shopId,
        createdAt: {
          gte: closingPeriod.startDate,
          lt: closingPeriod.endDate,
        },
      },
      data: { periodId: closingPeriod.id },
    });

    const allocations = await materializeCauseAllocationsForPeriod(
      shopId,
      closingPeriod,
      tx as DbClient,
    );

    const closedPeriod = await tx.reportingPeriod.update({
      where: {
        id: period.id,
        shopId,
      },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "ReportingPeriod",
        entityId: closedPeriod.id,
        action: "REPORTING_PERIOD_CLOSED",
        actor: "system",
        payload: {
          startDate: closedPeriod.startDate.toISOString(),
          endDate: closedPeriod.endDate.toISOString(),
          allocationCount: allocations.length,
        },
      },
    });

    return { closed: true, period: closedPeriod, allocations };
  });
}
