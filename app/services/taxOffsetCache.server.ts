import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";

function decimalOrZero(value: Prisma.Decimal | null | undefined) {
  return value ?? new Prisma.Decimal(0);
}

export async function recomputeTaxOffsetCache(shopId: string, db = prisma) {
  const [expenseTotals, allocationTotals, snapshotTotals, adjustmentTotals, adjustedAllocationLines] = await Promise.all([
    db.businessExpense.aggregate({
      where: { shopId },
      _sum: { amount: true },
    }),
    db.lineCauseAllocation.aggregate({
      where: {
        shopId,
        cause: { is501c3: true },
      },
      _sum: { amount: true },
    }),
    db.orderSnapshotLine.aggregate({
      where: { shopId },
      _sum: { netContribution: true },
    }),
    db.adjustment.aggregate({
      where: { shopId },
      _sum: { netContribAdj: true },
    }),
    db.orderSnapshotLine.findMany({
      where: {
        shopId,
        causeAllocations: {
          some: {
            is501c3: true,
          },
        },
        adjustments: {
          some: {},
        },
      },
      select: {
        netContribution: true,
        adjustments: {
          select: { netContribAdj: true },
        },
        causeAllocations: {
          where: { is501c3: true },
          select: { amount: true },
        },
      },
    }),
  ]);

  const expenseTotal = decimalOrZero(expenseTotals._sum.amount);
  const allocationTotal = decimalOrZero(allocationTotals._sum.amount);
  const snapshotTotal = decimalOrZero(snapshotTotals._sum.netContribution);
  const adjustmentTotal = decimalOrZero(adjustmentTotals._sum.netContribAdj);
  const adjustedAllocationTotal = adjustedAllocationLines.reduce((sum, line) => {
    if (line.netContribution.equals(0)) return sum;

    const baseAllocations = line.causeAllocations.reduce((allocationSum, allocation) => allocationSum.add(allocation.amount), new Prisma.Decimal(0));
    const lineAdjustmentTotal = line.adjustments.reduce((adjustmentSum, adjustment) => adjustmentSum.add(adjustment.netContribAdj), new Prisma.Decimal(0));
    const ratio = lineAdjustmentTotal.div(line.netContribution);

    return sum.add(baseAllocations.mul(ratio));
  }, new Prisma.Decimal(0));

  const cumulativeNetContrib = snapshotTotal.plus(adjustmentTotal);
  const deductionPool = expenseTotal.plus(allocationTotal).plus(adjustedAllocationTotal);
  const taxableExposure = cumulativeNetContrib.minus(deductionPool);
  const widgetTaxSuppressed = taxableExposure.lessThanOrEqualTo(0);

  await db.taxOffsetCache.upsert({
    where: { shopId },
    create: {
      shopId,
      taxableExposure,
      deductionPool,
      cumulativeNetContrib,
      widgetTaxSuppressed,
    },
    update: {
      taxableExposure,
      deductionPool,
      cumulativeNetContrib,
      widgetTaxSuppressed,
    },
  });

  return {
    taxableExposure,
    deductionPool,
    cumulativeNetContrib,
    widgetTaxSuppressed,
  };
}
