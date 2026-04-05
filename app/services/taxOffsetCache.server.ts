import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";

function decimalOrZero(value: Prisma.Decimal | null | undefined) {
  return value ?? new Prisma.Decimal(0);
}

export async function recomputeTaxOffsetCache(shopId: string, db = prisma) {
  const [expenseTotals, allocationTotals, snapshotTotals, adjustmentTotals] = await Promise.all([
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
  ]);

  const expenseTotal = decimalOrZero(expenseTotals._sum.amount);
  const allocationTotal = decimalOrZero(allocationTotals._sum.amount);
  const snapshotTotal = decimalOrZero(snapshotTotals._sum.netContribution);
  const adjustmentTotal = decimalOrZero(adjustmentTotals._sum.netContribAdj);

  const cumulativeNetContrib = snapshotTotal.plus(adjustmentTotal);
  const deductionPool = expenseTotal.plus(allocationTotal);
  const rawTaxableExposure = cumulativeNetContrib.minus(deductionPool);
  const taxableExposure = rawTaxableExposure.lessThan(0) ? new Prisma.Decimal(0) : rawTaxableExposure;
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
