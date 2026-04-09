import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { listOutstandingCauseAllocations } from "./causePayables.server";
import { createReceiptStorage } from "./receiptStorage.server";
import { calculateEstimatedTaxForPeriod } from "./taxTrueUpService.server";
import { normalizeTaxDeductionMode } from "./taxReserve.server";

const ZERO = new Prisma.Decimal(0);
const ADJUSTMENT_RATIO_GUARD = new Prisma.Decimal(10);

function addAllocation(
  allocations: Map<string, { causeId: string; causeName: string; is501c3: boolean; allocated: Prisma.Decimal }>,
  allocation: { causeId: string; causeName: string; is501c3: boolean; allocated: Prisma.Decimal },
) {
  const current = allocations.get(allocation.causeId);
  if (!current) {
    allocations.set(allocation.causeId, allocation);
    return;
  }

  allocations.set(allocation.causeId, {
    ...current,
    allocated: current.allocated.add(allocation.allocated),
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

  const ratio = lineAdjustmentTotal.div(lineNetContribution);
  if (ratio.abs().greaterThan(ADJUSTMENT_RATIO_GUARD)) {
    return baseAmount;
  }

  return baseAmount.add(baseAmount.mul(ratio));
}

export type ReportingSummaryResult = Awaited<ReturnType<typeof buildReportingSummary>>;

function floorCurrency(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR);
}

export async function buildReportingSummary(shopId: string, requestedPeriodId?: string | null, db = prisma) {
  const periods = await db.reportingPeriod.findMany({
    where: { shopId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      source: true,
      startDate: true,
      endDate: true,
      shopifyPayoutId: true,
      closedAt: true,
    },
  });

  if (periods.length === 0) {
    return {
      periods: [],
      selectedPeriodId: null,
      summary: null,
    };
  }

  const selectedPeriod = periods.find((period) => period.id === requestedPeriodId) ?? periods[0];

  const [shop, snapshotLines, closedAllocations, expensesSummary, chargesSummary, charges, disbursements, taxTrueUps, carryForwardTrueUps, activeCauses, outstandingAllocations] =
    await Promise.all([
      db.shop.findUnique({
        where: { shopId },
        select: {
          effectiveTaxRate: true,
          taxDeductionMode: true,
        },
      }),
      db.orderSnapshotLine.findMany({
        where: {
          shopId,
          snapshot: {
            createdAt: {
              gte: selectedPeriod.startDate,
              lt: selectedPeriod.endDate,
            },
          },
        },
        select: {
          netContribution: true,
          adjustments: { select: { netContribAdj: true } },
          causeAllocations: {
            select: { causeId: true, causeName: true, is501c3: true, amount: true },
          },
        },
      }),
      db.causeAllocation.findMany({
        where: {
          shopId,
          periodId: selectedPeriod.id,
        },
        select: {
          causeId: true,
          causeName: true,
          is501c3: true,
          allocated: true,
          disbursed: true,
        },
      }),
      db.businessExpense.aggregate({
        where: {
          shopId,
          expenseDate: {
            gte: selectedPeriod.startDate,
            lt: selectedPeriod.endDate,
          },
        },
        _sum: { amount: true },
      }),
      db.shopifyChargeTransaction.aggregate({
        where: {
          shopId,
          OR: [
            { periodId: selectedPeriod.id },
            {
              periodId: null,
              processedAt: {
                gte: selectedPeriod.startDate,
                lt: selectedPeriod.endDate,
              },
            },
          ],
        },
        _sum: { amount: true },
      }),
      db.shopifyChargeTransaction.findMany({
        where: {
          shopId,
          OR: [
            { periodId: selectedPeriod.id },
            {
              periodId: null,
              processedAt: {
                gte: selectedPeriod.startDate,
                lt: selectedPeriod.endDate,
              },
            },
          ],
        },
        orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
        take: 15,
        select: {
          id: true,
          description: true,
          amount: true,
          processedAt: true,
        },
      }),
      db.disbursement.findMany({
        where: {
          shopId,
          periodId: selectedPeriod.id,
        },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          causeId: true,
          amount: true,
          allocatedAmount: true,
          extraContributionAmount: true,
          feesCoveredAmount: true,
          paidAt: true,
          paymentMethod: true,
          referenceId: true,
          receiptFileKey: true,
          cause: {
            select: {
              name: true,
            },
          },
          applications: {
            select: {
              amount: true,
              causeAllocation: {
                select: {
                  periodId: true,
                  period: {
                    select: {
                      startDate: true,
                      endDate: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              causeAllocation: {
                period: {
                  endDate: "asc",
                },
              },
            },
          },
        },
      }),
      db.taxTrueUp.findMany({
        where: {
          shopId,
          periodId: selectedPeriod.id,
        },
        orderBy: [{ filedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          estimatedTax: true,
          actualTax: true,
          delta: true,
          filedAt: true,
          redistributionNotes: true,
          appliedPeriodId: true,
          redistributions: {
            select: {
              causeId: true,
              causeName: true,
              amount: true,
            },
          },
        },
      }),
      db.taxTrueUp.findMany({
        where: {
          shopId,
          appliedPeriodId: selectedPeriod.id,
        },
        select: {
          id: true,
          periodId: true,
          delta: true,
          redistributions: {
            select: {
              causeId: true,
              causeName: true,
              amount: true,
            },
          },
        },
      }),
      db.cause.findMany({
        where: {
          shopId,
          status: "active",
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
        },
      }),
      listOutstandingCauseAllocations(
        shopId,
        {
          throughPeriodEndDate: selectedPeriod.endDate,
        },
        db,
      ),
    ]);

  const allocationMap = new Map<string, { causeId: string; causeName: string; is501c3: boolean; allocated: Prisma.Decimal }>();
  let totalNetContribution = ZERO;

  for (const line of snapshotLines) {
    const adjustmentTotal = line.adjustments.reduce((sum, adj) => sum.add(adj.netContribAdj), ZERO);
    totalNetContribution = totalNetContribution.add(line.netContribution).add(adjustmentTotal);

    for (const allocation of line.causeAllocations) {
      const adjusted = computeAdjustedAllocationAmount({
        baseAmount: allocation.amount,
        lineNetContribution: line.netContribution,
        lineAdjustmentTotal: adjustmentTotal,
      });

      addAllocation(allocationMap, {
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: adjusted,
      });
    }
  }

  const expenseTotal = expensesSummary._sum.amount ?? ZERO;
  const shopifyCharges = chargesSummary._sum.amount ?? ZERO;
  const useClosedAllocations = selectedPeriod.status === "CLOSED" && closedAllocations.length > 0;
  let allocationRows = useClosedAllocations
    ? closedAllocations.map((allocation) => ({
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: allocation.allocated,
        disbursed: allocation.disbursed,
      }))
    : Array.from(allocationMap.values()).map((allocation) => ({
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: allocation.allocated,
        disbursed: ZERO,
      }));

  if (carryForwardTrueUps.length > 0) {
    const allocationMapWithCarryForward = new Map(
      allocationRows.map((allocation) => [
        allocation.causeId,
        {
          ...allocation,
        },
      ]),
    );

    for (const trueUp of carryForwardTrueUps) {
      for (const redistribution of trueUp.redistributions) {
        const existing = allocationMapWithCarryForward.get(redistribution.causeId);
        if (existing) {
          existing.allocated = existing.allocated.add(redistribution.amount);
          continue;
        }

        allocationMapWithCarryForward.set(redistribution.causeId, {
          causeId: redistribution.causeId,
          causeName: redistribution.causeName,
          is501c3: false,
          allocated: redistribution.amount,
          disbursed: ZERO,
        });
      }
    }

    allocationRows = Array.from(allocationMapWithCarryForward.values());
  }

  const allocation501c3Total = allocationRows.reduce(
    (sum, allocation) => (allocation.is501c3 ? sum.add(allocation.allocated) : sum),
    ZERO,
  );

  const deductionPool = expenseTotal.add(allocation501c3Total);
  const taxableExposure = totalNetContribution.sub(deductionPool);
  const widgetTaxSuppressed = taxableExposure.lessThanOrEqualTo(0);
  const taxEstimate = await calculateEstimatedTaxForPeriod(shopId, selectedPeriod.id, db);
  const carryForwardSurplus = carryForwardTrueUps.reduce(
    (sum, trueUp) => (trueUp.delta.greaterThan(ZERO) ? sum.add(trueUp.delta) : sum),
    ZERO,
  );
  const carryForwardShortfall = carryForwardTrueUps.reduce(
    (sum, trueUp) => (trueUp.delta.lessThan(ZERO) ? sum.add(trueUp.delta.abs()) : sum),
    ZERO,
  );
  const receiptStorage = createReceiptStorage();
  const disbursementRows = await Promise.all(
    disbursements.map(async (disbursement) => ({
      id: disbursement.id,
      causeId: disbursement.causeId,
      causeName: disbursement.cause.name,
      amount: disbursement.amount.toString(),
      allocatedAmount: disbursement.allocatedAmount.toString(),
      extraContributionAmount: disbursement.extraContributionAmount.toString(),
      feesCoveredAmount: disbursement.feesCoveredAmount.toString(),
      paidAt: disbursement.paidAt.toISOString(),
      paymentMethod: disbursement.paymentMethod,
      referenceId: disbursement.referenceId ?? null,
      receiptUrl: disbursement.receiptFileKey
        ? await receiptStorage.getSignedReadUrl({
            key: disbursement.receiptFileKey,
            expiresInSeconds: 60 * 60,
          })
        : null,
      applications: disbursement.applications.map((application) => ({
        periodId: application.causeAllocation.periodId,
        periodStartDate: application.causeAllocation.period.startDate.toISOString(),
        periodEndDate: application.causeAllocation.period.endDate.toISOString(),
        amount: application.amount.toString(),
      })),
    })),
  );

  const causePayablesMap = new Map<
    string,
    {
      causeId: string;
      causeName: string;
      is501c3: boolean;
      currentOutstanding: Prisma.Decimal;
      priorOutstanding: Prisma.Decimal;
      periods: Array<{
        periodId: string;
        periodStartDate: string;
        periodEndDate: string;
        amount: string;
      }>;
    }
  >();

  for (const allocation of outstandingAllocations) {
    const existing = causePayablesMap.get(allocation.causeId) ?? {
      causeId: allocation.causeId,
      causeName: allocation.causeName,
      is501c3: allocation.is501c3,
      currentOutstanding: ZERO,
      priorOutstanding: ZERO,
      periods: [],
    };

    if (allocation.periodId === selectedPeriod.id && selectedPeriod.status === "CLOSED") {
      existing.currentOutstanding = existing.currentOutstanding.add(allocation.remaining);
    } else {
      existing.priorOutstanding = existing.priorOutstanding.add(allocation.remaining);
    }

    existing.periods.push({
      periodId: allocation.periodId,
      periodStartDate: allocation.periodStartDate.toISOString(),
      periodEndDate: allocation.periodEndDate.toISOString(),
      amount: allocation.remaining.toString(),
    });
    causePayablesMap.set(allocation.causeId, existing);
  }

  if (selectedPeriod.status === "OPEN") {
    for (const allocation of allocationRows) {
      const existing = causePayablesMap.get(allocation.causeId) ?? {
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        currentOutstanding: ZERO,
        priorOutstanding: ZERO,
        periods: [],
      };

      const netOutstanding = floorCurrency(
        new Prisma.Decimal(allocation.allocated).sub(new Prisma.Decimal(allocation.disbursed ?? ZERO)),
      );
      existing.currentOutstanding = existing.currentOutstanding.add(
        netOutstanding.greaterThan(ZERO) ? netOutstanding : ZERO,
      );
      causePayablesMap.set(allocation.causeId, existing);
    }
  }

  const causePayables = Array.from(causePayablesMap.values()).map((payable) => {
    const totalOutstanding = payable.currentOutstanding.add(payable.priorOutstanding);
    return {
      causeId: payable.causeId,
      causeName: payable.causeName,
      is501c3: payable.is501c3,
      currentOutstanding: payable.currentOutstanding.toString(),
      priorOutstanding: payable.priorOutstanding.toString(),
      totalOutstanding: totalOutstanding.toString(),
      overdue: payable.priorOutstanding.greaterThan(ZERO),
      periods: payable.periods,
    };
  });

  return {
    periods: periods.map((period) => ({
      id: period.id,
      status: period.status,
      source: period.source,
      startDate: period.startDate.toISOString(),
      endDate: period.endDate.toISOString(),
      shopifyPayoutId: period.shopifyPayoutId ?? null,
      closedAt: period.closedAt?.toISOString() ?? null,
    })),
    selectedPeriodId: selectedPeriod.id,
    summary: {
      period: {
        id: selectedPeriod.id,
        status: selectedPeriod.status,
        startDate: selectedPeriod.startDate.toISOString(),
        endDate: selectedPeriod.endDate.toISOString(),
        shopifyPayoutId: selectedPeriod.shopifyPayoutId ?? null,
        closedAt: selectedPeriod.closedAt?.toISOString() ?? null,
      },
      track1: {
        totalNetContribution: totalNetContribution.toString(),
        shopifyCharges: shopifyCharges.toString(),
        donationPool: totalNetContribution.sub(shopifyCharges).add(carryForwardSurplus).sub(carryForwardShortfall).toString(),
        taxTrueUpSurplusApplied: carryForwardSurplus.toString(),
        taxTrueUpShortfallApplied: carryForwardShortfall.toString(),
        allocations: allocationRows.map((allocation) => ({
          causeId: allocation.causeId,
          causeName: allocation.causeName,
          is501c3: allocation.is501c3,
          allocated: allocation.allocated.toString(),
          disbursed: allocation.disbursed.toString(),
        })),
      },
      track2: {
        deductionPool: deductionPool.toString(),
        taxableExposure: taxableExposure.toString(),
        widgetTaxSuppressed,
        taxableBase: taxEstimate.taxableBase.toString(),
        taxableWeight: taxEstimate.taxableWeight.toString(),
        estimatedTaxReserve: taxEstimate.estimatedTaxReserve.toString(),
        effectiveTaxRate: shop?.effectiveTaxRate?.toString() ?? null,
        taxDeductionMode: normalizeTaxDeductionMode(shop?.taxDeductionMode),
        businessExpenseTotal: expenseTotal.toString(),
        allocation501c3Total: allocation501c3Total.toString(),
      },
      charges: charges.map((charge) => ({
        id: charge.id,
        description: charge.description ?? "Shopify charge",
        amount: charge.amount.toString(),
        processedAt: charge.processedAt?.toISOString() ?? null,
      })),
      disbursements: disbursementRows,
      causePayables,
      taxTrueUps: taxTrueUps.map((trueUp) => ({
        id: trueUp.id,
        estimatedTax: trueUp.estimatedTax.toString(),
        actualTax: trueUp.actualTax.toString(),
        delta: trueUp.delta.toString(),
        filedAt: trueUp.filedAt.toISOString(),
        redistributionNotes: trueUp.redistributionNotes ?? null,
        appliedPeriodId: trueUp.appliedPeriodId ?? null,
        redistributions: trueUp.redistributions.map((redistribution) => ({
          causeId: redistribution.causeId,
          causeName: redistribution.causeName,
          amount: redistribution.amount.toString(),
        })),
      })),
      carryForwardTrueUps: carryForwardTrueUps.map((trueUp) => ({
        id: trueUp.id,
        periodId: trueUp.periodId,
        delta: trueUp.delta.toString(),
        redistributions: trueUp.redistributions.map((redistribution) => ({
          causeId: redistribution.causeId,
          causeName: redistribution.causeName,
          amount: redistribution.amount.toString(),
        })),
      })),
      activeCauses: activeCauses.map((cause) => ({
        id: cause.id,
        name: cause.name,
      })),
    },
  };
}
