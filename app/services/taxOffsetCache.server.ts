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
        is501c3: true,
        snapshotLine: {
          snapshot: {
            currentForOrderRecord: { isNot: null },
            orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
          },
        },
      },
      _sum: { amount: true },
    }),
    db.orderSnapshotLine.aggregate({
      where: {
        shopId,
        snapshot: {
          currentForOrderRecord: { isNot: null },
          orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
        },
      },
      _sum: {
        subtotal: true,
        materialCost: true,
        packagingCost: true,
        netContribution: true,
      },
    }),
    db.adjustment.aggregate({
      where: {
        shopId,
        snapshotLine: {
          snapshot: {
            currentForOrderRecord: { isNot: null },
            orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
          },
        },
      },
      _sum: { netContribAdj: true, laborAdj: true, equipmentAdj: true },
    }),
    db.orderSnapshotLine.findMany({
      where: {
        shopId,
        snapshot: {
          currentForOrderRecord: { isNot: null },
          orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
        },
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
  const taxableContribution = decimalOrZero(snapshotTotals._sum.subtotal)
    .sub(decimalOrZero(snapshotTotals._sum.materialCost))
    .sub(decimalOrZero(snapshotTotals._sum.packagingCost))
    .add(adjustmentTotal)
    .add(decimalOrZero(adjustmentTotals._sum.laborAdj))
    .add(decimalOrZero(adjustmentTotals._sum.equipmentAdj));
  const adjustedAllocationTotal = adjustedAllocationLines.reduce((sum, line) => {
    if (line.netContribution.equals(0)) return sum;

    const baseAllocations = line.causeAllocations.reduce((allocationSum, allocation) => allocationSum.add(allocation.amount), new Prisma.Decimal(0));
    const lineAdjustmentTotal = line.adjustments.reduce((adjustmentSum, adjustment) => adjustmentSum.add(adjustment.netContribAdj), new Prisma.Decimal(0));
    const ratio = lineAdjustmentTotal.div(line.netContribution);
    if (ratio.abs().greaterThan(new Prisma.Decimal(10))) return sum;

    return sum.add(baseAllocations.mul(ratio));
  }, new Prisma.Decimal(0));

  const cumulativeNetContrib = snapshotTotal.plus(adjustmentTotal);
  const deductionPool = expenseTotal.plus(allocationTotal).plus(adjustedAllocationTotal);
  const taxableExposure = taxableContribution.minus(deductionPool);
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
