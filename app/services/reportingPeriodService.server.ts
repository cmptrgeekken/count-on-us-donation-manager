import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { countUnresolvedSettlementsForPeriod } from "./orderSettlement.server";
import {
  applyEstimatedTaxReserveToAllocations,
  computeEstimatedTaxReserve,
  normalizeTaxDeductionMode,
} from "./taxReserve.server";

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

type ArtistAllocationDraft = {
  artistId: string;
  artistName: string;
  creditName: string;
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

function addArtistAllocation(
  allocations: Map<string, ArtistAllocationDraft>,
  input: ArtistAllocationDraft,
) {
  const current = allocations.get(input.artistId);
  if (!current) {
    allocations.set(input.artistId, input);
    return;
  }

  allocations.set(input.artistId, {
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
  const [snapshotLines, shop, expenseSummary] = await Promise.all([db.orderSnapshotLine.findMany({
    where: {
      shopId,
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
    select: {
      netContribution: true,
      subtotal: true,
      materialCost: true,
      packagingCost: true,
      shopifyProductId: true,
      adjustments: {
        select: { netContribAdj: true, laborAdj: true, equipmentAdj: true },
      },
      causeAllocations: {
        select: {
          causeId: true,
          causeName: true,
          is501c3: true,
          percentage: true,
          amount: true,
          source: true,
        },
      },
    },
  }), db.shop?.findUnique
    ? db.shop.findUnique({
        where: { shopId },
        select: { effectiveTaxRate: true, taxDeductionMode: true },
      })
    : Promise.resolve(null), db.businessExpense?.aggregate
    ? db.businessExpense.aggregate({
        where: {
          shopId,
          expenseDate: { gte: period.startDate, lt: period.endDate },
        },
        _sum: { amount: true },
      })
    : Promise.resolve({ _sum: { amount: null } })]);

  const shopifyProductIds = Array.from(new Set(
    snapshotLines
      .map((line) => line.shopifyProductId)
      .filter((productId): productId is string => Boolean(productId)),
  ));
  const currentProductAssignments = shopifyProductIds.length > 0 && db.productCauseAssignment?.findMany
    ? await db.productCauseAssignment.findMany({
        where: { shopId, shopifyProductId: { in: shopifyProductIds } },
        select: {
          shopifyProductId: true,
          causeId: true,
          percentage: true,
          cause: { select: { name: true, is501c3: true } },
        },
      })
    : [];
  const currentAssignmentsByProductId = new Map<string, typeof currentProductAssignments>();
  for (const productId of shopifyProductIds) {
    currentAssignmentsByProductId.set(productId, []);
  }
  for (const assignment of currentProductAssignments) {
    const assignments = currentAssignmentsByProductId.get(assignment.shopifyProductId) ?? [];
    assignments.push(assignment);
    currentAssignmentsByProductId.set(assignment.shopifyProductId, assignments);
  }

  const allocations = new Map<string, AllocationDraft>();

  for (const line of snapshotLines) {
    const lineAdjustmentTotal = line.adjustments.reduce(
      (sum, adjustment) => sum.add(adjustment.netContribAdj),
      ZERO,
    );

    const currentAssignments = line.shopifyProductId
      ? currentAssignmentsByProductId.get(line.shopifyProductId)
      : undefined;
    const canRefreshProductRouting = Boolean(
      currentAssignments &&
      line.causeAllocations.length > 0 &&
      line.causeAllocations.every((allocation) =>
        allocation.source === "product" || allocation.source === "product_override",
      ),
    );
    const originalPercentageTotal = line.causeAllocations.reduce(
      (sum, allocation) => sum.add(allocation.percentage ?? ZERO),
      ZERO,
    );
    const originalAllocationTotal = line.causeAllocations.reduce(
      (sum, allocation) => sum.add(allocation.amount),
      ZERO,
    );
    const refreshedAllocationBase = originalPercentageTotal.greaterThan(ZERO)
      ? originalAllocationTotal.mul(100).div(originalPercentageTotal)
      : ZERO;
    const routedAllocations = canRefreshProductRouting
      ? currentAssignments!.map((assignment) => ({
          causeId: assignment.causeId,
          causeName: assignment.cause.name,
          is501c3: assignment.cause.is501c3,
          amount: refreshedAllocationBase.mul(assignment.percentage).div(100),
        }))
      : line.causeAllocations;

    for (const allocation of routedAllocations) {
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

  const grossRows = Array.from(allocations.values());
  const totalNetContribution = snapshotLines.reduce((sum, line) => {
    const adjustmentTotal = line.adjustments.reduce(
      (adjustmentSum, adjustment) => adjustmentSum.add(adjustment.netContribAdj),
      ZERO,
    );
    return sum.add(line.netContribution).add(adjustmentTotal);
  }, ZERO);
  const taxEstimate = computeEstimatedTaxReserve({
    taxableContribution: snapshotLines.reduce((sum, line) => sum
      .add(line.subtotal ?? ZERO)
      .sub(line.materialCost ?? ZERO)
      .sub(line.packagingCost ?? ZERO)
      .add(line.adjustments.reduce(
        (adjustmentSum, adjustment) => adjustmentSum
          .add(adjustment.netContribAdj)
          .add(adjustment.laborAdj ?? ZERO)
          .add(adjustment.equipmentAdj ?? ZERO),
        ZERO,
      )), ZERO),
    businessExpenseTotal: expenseSummary._sum.amount ?? ZERO,
    allocations: grossRows,
    effectiveTaxRate: shop?.effectiveTaxRate,
    taxDeductionMode: shop?.taxDeductionMode,
  });
  const netRows = applyEstimatedTaxReserveToAllocations(
    grossRows,
    taxEstimate.estimatedTaxReserve,
    normalizeTaxDeductionMode(shop?.taxDeductionMode),
  );
  const rows = netRows.map((allocation) => ({
    shopId,
    periodId: period.id,
    causeId: allocation.causeId,
    causeName: allocation.causeName,
    is501c3: allocation.is501c3,
    allocated: allocation.allocated,
    taxReserveDeduction: allocation.taxReserveDeduction,
  }));

  const existingAllocations = await db.causeAllocation.findMany({
    where: {
      shopId,
      periodId: period.id,
    },
    select: {
      id: true,
      causeId: true,
      disbursed: true,
      _count: {
        select: { applications: true },
      },
    },
  });

  const existingByCauseId = new Map(existingAllocations.map((allocation) => [allocation.causeId, allocation]));
  const rowCauseIds = new Set(rows.map((row) => row.causeId));

  for (const row of rows) {
    const existing = existingByCauseId.get(row.causeId);
    if (existing) {
      await db.causeAllocation.updateMany({
        where: { id: existing.id, shopId },
        data: {
          causeName: row.causeName,
          is501c3: row.is501c3,
          allocated: Prisma.Decimal.max(row.allocated, existing.disbursed ?? ZERO),
          taxReserveDeduction: row.taxReserveDeduction,
        },
      });
    } else {
      await db.causeAllocation.create({ data: row });
    }
  }

  const staleUnpaidAllocationIds = existingAllocations
    .filter((allocation) => !rowCauseIds.has(allocation.causeId) && allocation._count.applications === 0)
    .map((allocation) => allocation.id);

  if (staleUnpaidAllocationIds.length > 0) {
    await db.causeAllocation.deleteMany({
      where: {
        shopId,
        id: { in: staleUnpaidAllocationIds },
      },
    });
  }

  const stalePaidAllocations = existingAllocations.filter(
    (allocation) => !rowCauseIds.has(allocation.causeId) && allocation._count.applications > 0,
  );
  for (const allocation of stalePaidAllocations) {
    await db.causeAllocation.updateMany({
      where: { id: allocation.id, shopId },
      data: {
        allocated: allocation.disbursed ?? ZERO,
        taxReserveDeduction: ZERO,
      },
    });
  }

  return rows;
}

export async function materializeArtistAllocationsForPeriod(
  shopId: string,
  period: { id: string; startDate: Date; endDate: Date },
  db: DbClient = prisma,
) {
  if (!("lineArtistAllocation" in db) || !("artistAllocation" in db)) {
    return [];
  }

  const lineArtistAllocations = await db.lineArtistAllocation.findMany({
    where: {
      shopId,
      payoutEnabled: true,
      payoutExclusionReason: null,
      snapshotLine: {
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
    },
    select: {
      artistId: true,
      artistName: true,
      creditName: true,
      payoutAmount: true,
      snapshotLine: {
        select: {
          netContribution: true,
          adjustments: { select: { netContribAdj: true } },
          snapshot: {
            select: {
              artistAttribution: {
                select: { artistId: true },
              },
            },
          },
        },
      },
    },
  });

  const allocations = new Map<string, ArtistAllocationDraft>();

  for (const allocation of lineArtistAllocations) {
    if (allocation.snapshotLine?.snapshot.artistAttribution?.artistId === allocation.artistId) {
      continue;
    }

    addArtistAllocation(allocations, {
      artistId: allocation.artistId,
      artistName: allocation.artistName,
      creditName: allocation.creditName,
      allocated: computeAdjustedAllocationAmount({
        baseAmount: allocation.payoutAmount,
        lineNetContribution: allocation.snapshotLine.netContribution,
        lineAdjustmentTotal: allocation.snapshotLine.adjustments.reduce(
          (sum, adjustment) => sum.add(adjustment.netContribAdj),
          ZERO,
        ),
      }),
    });
  }

  const rows = Array.from(allocations.values()).map((allocation) => ({
    shopId,
    periodId: period.id,
    artistId: allocation.artistId,
    artistName: allocation.artistName,
    creditName: allocation.creditName,
    allocated: allocation.allocated,
  }));

  const existingAllocations = await db.artistAllocation.findMany({
    where: {
      shopId,
      periodId: period.id,
    },
    select: {
      id: true,
      artistId: true,
      _count: {
        select: { applications: true },
      },
    },
  });

  const existingByArtistId = new Map(existingAllocations.map((allocation) => [allocation.artistId, allocation]));
  const rowArtistIds = new Set(rows.map((row) => row.artistId));

  for (const row of rows) {
    const existing = existingByArtistId.get(row.artistId);
    if (existing) {
      await db.artistAllocation.updateMany({
        where: { id: existing.id, shopId },
        data: {
          artistName: row.artistName,
          creditName: row.creditName,
          allocated: row.allocated,
        },
      });
    } else {
      await db.artistAllocation.create({ data: row });
    }
  }

  const staleUnpaidAllocationIds = existingAllocations
    .filter((allocation) => !rowArtistIds.has(allocation.artistId) && allocation._count.applications === 0)
    .map((allocation) => allocation.id);

  if (staleUnpaidAllocationIds.length > 0) {
    await db.artistAllocation.deleteMany({
      where: {
        shopId,
        id: { in: staleUnpaidAllocationIds },
      },
    });
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
      const [allocations, artistAllocations] = await Promise.all([
        tx.causeAllocation.findMany({
          where: {
            shopId,
            periodId,
          },
        }),
        tx.artistAllocation.findMany({
          where: {
            shopId,
            periodId,
          },
        }),
      ]);
      return { closed: false, period, allocations, artistAllocations };
    }

    const unresolvedSettlementCount = await countUnresolvedSettlementsForPeriod({
      shopId,
      periodId,
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
      db: tx as never,
    });
    if (unresolvedSettlementCount > 0) {
      throw new Error(`Resolve ${unresolvedSettlementCount} external settlement review${unresolvedSettlementCount === 1 ? "" : "s"} before closing this reporting period.`);
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
        currentForOrderRecord: { isNot: null },
        orderRecord: {
          lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
        },
        createdAt: {
          gte: closingPeriod.startDate,
          lt: closingPeriod.endDate,
        },
      },
      data: { periodId: closingPeriod.id },
    });

    await tx.orderSettlement.updateMany({
      where: {
        shopId,
        snapshot: {
          currentForOrderRecord: { isNot: null },
          orderRecord: {
            lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
          },
          createdAt: {
            gte: closingPeriod.startDate,
            lt: closingPeriod.endDate,
          },
        },
      },
      data: { periodId: closingPeriod.id },
    });

    const [allocations, artistAllocations] = await Promise.all([
      materializeCauseAllocationsForPeriod(
        shopId,
        closingPeriod,
        tx as DbClient,
      ),
      materializeArtistAllocationsForPeriod(
        shopId,
        closingPeriod,
        tx as DbClient,
      ),
    ]);

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
          artistAllocationCount: artistAllocations.length,
        },
      },
    });

    return { closed: true, period: closedPeriod, allocations, artistAllocations };
  });
}
