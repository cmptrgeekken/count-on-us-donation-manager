import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { listOutstandingArtistAllocations } from "./artistPayables.server";
import { listOutstandingCauseAllocations } from "./causePayables.server";
import { createReceiptStorage } from "./receiptStorage.server";
import { calculateEstimatedTaxForPeriod } from "./taxTrueUpService.server";
import {
  applyEstimatedTaxReserveToAllocations,
  computeEstimatedTaxReserve,
  normalizeTaxDeductionMode,
} from "./taxReserve.server";
import { capCauseAllocations, computeDonationPool } from "./donationPool.server";
import { adjustAllocationForLineChange } from "./allocationAdjustment.server";

const ZERO = new Prisma.Decimal(0);
export const ALL_TIME_PERIOD_ID = "all-time";

type CauseAllocationDetail = {
  kind: "order_line" | "true_up" | "tax_reserve";
  label?: string;
  orderSnapshotId?: string;
  shopifyOrderId?: string;
  orderNumber?: string | null;
  shopifyLineItemId?: string;
  productTitle?: string;
  variantTitle?: string;
  quantity?: number;
  grossLineAmount?: Prisma.Decimal;
  netContributionAmount?: Prisma.Decimal;
  allocatedAmount: Prisma.Decimal;
};

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

export type ReportingSummaryResult = Awaited<ReturnType<typeof buildReportingSummary>>;

function floorCurrency(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function hasFindMany(model: unknown): model is { findMany: unknown } {
  return typeof model === "object" && model !== null && "findMany" in model;
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

  const isAllTime = requestedPeriodId === ALL_TIME_PERIOD_ID;
  const selectedPeriod = isAllTime
    ? {
        id: ALL_TIME_PERIOD_ID,
        status: "ROLLUP",
        source: "synthetic",
        startDate: periods.reduce((earliest, period) => period.startDate < earliest ? period.startDate : earliest, periods[0].startDate),
        endDate: periods.reduce((latest, period) => period.endDate > latest ? period.endDate : latest, periods[0].endDate),
        shopifyPayoutId: null,
        closedAt: null,
      }
    : periods.find((period) => period.id === requestedPeriodId) ?? periods[0];
  const chargeWhere = isAllTime
    ? {
        shopId,
        processedAt: { gte: selectedPeriod.startDate, lt: selectedPeriod.endDate },
      }
    : {
        shopId,
        OR: [
          { periodId: selectedPeriod.id },
          {
            periodId: null,
            processedAt: { gte: selectedPeriod.startDate, lt: selectedPeriod.endDate },
          },
        ],
      };
  const mockableDb = db as typeof db & {
    artistAllocation?: { findMany?: typeof db.artistAllocation.findMany };
    artistPayment?: { findMany?: typeof db.artistPayment.findMany };
    artist?: { findMany?: typeof db.artist.findMany };
    orderPackageAllocation?: { findMany?: typeof db.orderPackageAllocation.findMany };
    packagingReviewItem?: { findMany?: typeof db.packagingReviewItem.findMany };
  };

  const [shop, snapshotLines, orderTaxSummary, closedAllocations, expensesSummary, chargesSummary, charges, disbursements, taxTrueUps, carryForwardTrueUps, activeCauses, outstandingAllocations] =
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
            currentForOrderRecord: { isNot: null },
            orderRecord: {
              lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
            },
            createdAt: {
              gte: selectedPeriod.startDate,
              lt: selectedPeriod.endDate,
            },
          },
        },
        select: {
          shopifyLineItemId: true,
          lineKind: true,
          productTitle: true,
          variantTitle: true,
          quantity: true,
          subtotal: true,
          laborCost: true,
          materialCost: true,
          packagingCost: true,
          equipmentCost: true,
          podCost: true,
          mistakeBufferAmount: true,
          netContribution: true,
          snapshot: {
            select: {
              id: true,
              shopifyOrderId: true,
              orderNumber: true,
              artistAttribution: {
                select: { artistId: true },
              },
            },
          },
          adjustments: { select: { netContribAdj: true, laborAdj: true, equipmentAdj: true } },
          causeAllocations: {
            select: { causeId: true, causeName: true, is501c3: true, amount: true },
          },
          artistAllocations: {
            select: {
              artistId: true,
              artistName: true,
              creditName: true,
              payoutAmount: true,
              payoutEnabled: true,
              payoutExclusionReason: true,
            },
          },
        },
      }),
      db.orderSnapshot.aggregate({
        where: {
          shopId,
          currentForOrderRecord: { isNot: null },
          orderRecord: {
            lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
          },
          createdAt: {
            gte: selectedPeriod.startDate,
            lt: selectedPeriod.endDate,
          },
        },
        _sum: { salesTaxCollected: true },
      }),
      db.causeAllocation.findMany({
        where: isAllTime ? { shopId, id: { in: [] } } : { shopId, periodId: selectedPeriod.id },
        select: {
          causeId: true,
          causeName: true,
          is501c3: true,
          allocated: true,
          taxReserveDeduction: true,
          disbursed: true,
          adjustments: {
            where: { shopId },
            select: { amount: true },
          },
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
        where: chargeWhere,
        _sum: { amount: true },
      }),
      db.shopifyChargeTransaction.findMany({
        where: chargeWhere,
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
        where: isAllTime ? { shopId } : { shopId, periodId: selectedPeriod.id },
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
        where: isAllTime ? { shopId } : { shopId, periodId: selectedPeriod.id },
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
        where: isAllTime ? { shopId, appliedPeriodId: { not: null } } : { shopId, appliedPeriodId: selectedPeriod.id },
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

  const [closedArtistAllocations, artistPayments, activeArtists, outstandingArtistAllocations] = await Promise.all([
    mockableDb.artistAllocation?.findMany
      ? mockableDb.artistAllocation.findMany({
          where: isAllTime ? { shopId, id: { in: [] } } : { shopId, periodId: selectedPeriod.id },
          select: {
            artistId: true,
            artistName: true,
            creditName: true,
            allocated: true,
            paid: true,
          },
        })
      : Promise.resolve([]),
    mockableDb.artistPayment?.findMany
      ? mockableDb.artistPayment.findMany({
          where: isAllTime ? { shopId } : { shopId, periodId: selectedPeriod.id },
          orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            artistId: true,
            amount: true,
            paidAt: true,
            paymentMethod: true,
            referenceId: true,
            notes: true,
            artist: {
              select: {
                displayName: true,
                creditName: true,
              },
            },
            applications: {
              select: {
                amount: true,
                artistAllocation: {
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
                artistAllocation: {
                  period: {
                    endDate: "asc",
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    mockableDb.artist?.findMany
      ? mockableDb.artist.findMany({
          where: {
            shopId,
            status: { in: ["active", "draft"] },
          },
          orderBy: { displayName: "asc" },
          select: {
            id: true,
            displayName: true,
            creditName: true,
            paymentEnabled: true,
          },
        })
      : Promise.resolve([]),
    hasFindMany((mockableDb as { artistAllocation?: unknown }).artistAllocation)
      ? listOutstandingArtistAllocations(
          shopId,
          {
            throughPeriodEndDate: selectedPeriod.endDate,
          },
          db,
        )
      : Promise.resolve([]),
  ]);

  const packageAllocations = mockableDb.orderPackageAllocation?.findMany
    ? await mockableDb.orderPackageAllocation.findMany({
        where: {
          shopId,
          snapshot: {
            currentForOrderRecord: { isNot: null },
            orderRecord: {
              lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
            },
            createdAt: {
              gte: selectedPeriod.startDate,
              lt: selectedPeriod.endDate,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 25,
        select: {
          id: true,
          packageName: true,
          quantity: true,
          materialCost: true,
          source: true,
          confidence: true,
          reason: true,
          snapshot: {
            select: {
              id: true,
              orderNumber: true,
            },
          },
        },
      })
    : [];

  const packagingReviewItems = mockableDb.packagingReviewItem?.findMany
    ? await mockableDb.packagingReviewItem.findMany({
        where: {
          shopId,
          status: "open",
          snapshot: {
            currentForOrderRecord: { isNot: null },
            orderRecord: {
              lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
            },
            createdAt: {
              gte: selectedPeriod.startDate,
              lt: selectedPeriod.endDate,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 25,
        select: {
          id: true,
          reason: true,
          severity: true,
          createdAt: true,
          snapshotId: true,
          snapshot: {
            select: {
              orderNumber: true,
            },
          },
        },
      })
    : [];

  const settlementScopeWhere = {
    shopId,
    OR: [
      { periodId: selectedPeriod.id },
      {
        periodId: null,
        snapshot: {
          currentForOrderRecord: { isNot: null },
          orderRecord: {
            lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
          },
          createdAt: {
            gte: selectedPeriod.startDate,
            lt: selectedPeriod.endDate,
          },
        },
      },
    ],
  };
  const [externalSettlementFeeSummary, externalSettlements] = await Promise.all([
    db.orderSettlement.aggregate({
      where: {
        ...settlementScopeWhere,
        status: "confirmed",
      },
      _sum: { feeAmount: true },
    }),
    db.orderSettlement.findMany({
      where: settlementScopeWhere,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        shopifyOrderId: true,
        orderNumber: true,
        source: true,
        status: true,
        grossOrderAmount: true,
        shopifyPaidAmount: true,
        amountReceived: true,
        feeAmount: true,
        currency: true,
        paidAt: true,
        referenceId: true,
        notes: true,
        detectedReason: true,
      },
    }),
  ]);

  const allocationMap = new Map<string, { causeId: string; causeName: string; is501c3: boolean; allocated: Prisma.Decimal }>();
  const artistAllocationMap = new Map<string, { artistId: string; artistName: string; creditName: string; allocated: Prisma.Decimal }>();
  const allocationDetailMap = new Map<string, CauseAllocationDetail[]>();
  let grossContribution = ZERO;
  let laborDeduction = ZERO;
  let materialDeduction = ZERO;
  let packagingDeduction = ZERO;
  let equipmentDeduction = ZERO;
  let podDeduction = ZERO;
  let mistakeBufferDeduction = ZERO;
  let netContributionAdjustments = ZERO;
  let taxableContributionAdjustments = ZERO;
  let totalNetContribution = ZERO;
  const allocationAdjustmentReviewMap = new Map<string, {
    snapshotId: string;
    shopifyLineItemId: string;
    orderNumber: string | null;
    productTitle: string;
    variantTitle: string;
    reason: "ZERO_NET_CONTRIBUTION" | "EXTREME_ADJUSTMENT_RATIO";
    ratio: string | null;
  }>();

  for (const line of snapshotLines) {
    const adjustmentTotal = line.adjustments.reduce((sum, adj) => sum.add(adj.netContribAdj), ZERO);
    if (line.lineKind !== "tip") {
      grossContribution = grossContribution.add(line.subtotal);
    }
    laborDeduction = laborDeduction.add(line.laborCost ?? ZERO);
    materialDeduction = materialDeduction.add(line.materialCost ?? ZERO);
    packagingDeduction = packagingDeduction.add(line.packagingCost ?? ZERO);
    equipmentDeduction = equipmentDeduction.add(line.equipmentCost ?? ZERO);
    podDeduction = podDeduction.add(line.podCost ?? ZERO);
    mistakeBufferDeduction = mistakeBufferDeduction.add(line.mistakeBufferAmount ?? ZERO);
    netContributionAdjustments = netContributionAdjustments.add(adjustmentTotal);
    taxableContributionAdjustments = taxableContributionAdjustments.add(
      line.adjustments.reduce(
        (sum, adjustment) => sum
          .add(adjustment.netContribAdj)
          .add(adjustment.laborAdj ?? ZERO)
          .add(adjustment.equipmentAdj ?? ZERO),
        ZERO,
      ),
    );
    const adjustedLineNetContribution = line.netContribution.add(adjustmentTotal);
    totalNetContribution = totalNetContribution.add(adjustedLineNetContribution);

    for (const allocation of line.causeAllocations) {
      const adjustmentResult = adjustAllocationForLineChange({
        baseAmount: allocation.amount,
        lineNetContribution: line.netContribution,
        lineAdjustmentTotal: adjustmentTotal,
      });
      const adjusted = adjustmentResult.amount;
      if (adjustmentResult.reviewRequired && adjustmentResult.reviewReason) {
        allocationAdjustmentReviewMap.set(line.shopifyLineItemId, {
          snapshotId: line.snapshot.id,
          shopifyLineItemId: line.shopifyLineItemId,
          orderNumber: line.snapshot.orderNumber ?? null,
          productTitle: line.productTitle,
          variantTitle: line.variantTitle,
          reason: adjustmentResult.reviewReason,
          ratio: adjustmentResult.ratio?.toString() ?? null,
        });
      }

      addAllocation(allocationMap, {
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: adjusted,
      });

      const details = allocationDetailMap.get(allocation.causeId) ?? [];
      details.push({
        kind: "order_line",
        orderSnapshotId: line.snapshot.id,
        shopifyOrderId: line.snapshot.shopifyOrderId,
        orderNumber: line.snapshot.orderNumber ?? null,
        shopifyLineItemId: line.shopifyLineItemId,
        productTitle: line.productTitle,
        variantTitle: line.variantTitle,
        quantity: line.quantity,
        grossLineAmount: line.subtotal,
        netContributionAmount: adjustedLineNetContribution,
        allocatedAmount: adjusted,
      });
      allocationDetailMap.set(allocation.causeId, details);
    }

    for (const allocation of line.artistAllocations ?? []) {
      if (!allocation.payoutEnabled) continue;
      if (allocation.payoutExclusionReason) continue;
      if (line.snapshot.artistAttribution?.artistId === allocation.artistId) continue;
      const current = artistAllocationMap.get(allocation.artistId) ?? {
        artistId: allocation.artistId,
        artistName: allocation.artistName,
        creditName: allocation.creditName,
        allocated: ZERO,
      };
      current.allocated = current.allocated.add(
        adjustAllocationForLineChange({
          baseAmount: allocation.payoutAmount,
          lineNetContribution: line.netContribution,
          lineAdjustmentTotal: adjustmentTotal,
        }).amount,
      );
      artistAllocationMap.set(allocation.artistId, current);
    }
  }

  const expenseTotal = expensesSummary._sum.amount ?? ZERO;
  const salesTaxCollected = orderTaxSummary._sum.salesTaxCollected ?? ZERO;
  const shopifyCharges = chargesSummary._sum.amount ?? ZERO;
  const externalSettlementFees = externalSettlementFeeSummary._sum.feeAmount ?? ZERO;
  const useClosedAllocations = selectedPeriod.status === "CLOSED" && closedAllocations.length > 0;
  let allocationRows = useClosedAllocations
    ? closedAllocations.map((allocation) => ({
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: allocation.allocated,
        taxReserveDeduction: allocation.taxReserveDeduction,
        disbursed: allocation.disbursed,
        adjustments: allocation.adjustments.reduce((sum, adjustment) => sum.add(adjustment.amount), ZERO),
      }))
    : Array.from(allocationMap.values()).map((allocation) => ({
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: allocation.allocated,
        taxReserveDeduction: ZERO,
        disbursed: ZERO,
        adjustments: ZERO,
      }));

  const useClosedArtistAllocations = selectedPeriod.status === "CLOSED" && closedArtistAllocations.length > 0;
  const artistAllocationRows = useClosedArtistAllocations
    ? closedArtistAllocations.map((allocation) => ({
        artistId: allocation.artistId,
        artistName: allocation.artistName,
        creditName: allocation.creditName,
        allocated: allocation.allocated,
        paid: allocation.paid,
      }))
    : Array.from(artistAllocationMap.values()).map((allocation) => ({
        artistId: allocation.artistId,
        artistName: allocation.artistName,
        creditName: allocation.creditName,
        allocated: allocation.allocated,
      paid: ZERO,
    }));
  const totalArtistPayout = artistAllocationRows.reduce(
    (sum, allocation) => sum.add(allocation.allocated),
    ZERO,
  );

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
          const details = allocationDetailMap.get(redistribution.causeId) ?? [];
          details.push({
            kind: "true_up",
            label: "Tax true-up redistribution",
            allocatedAmount: redistribution.amount,
          });
          allocationDetailMap.set(redistribution.causeId, details);
          continue;
        }

        allocationMapWithCarryForward.set(redistribution.causeId, {
          causeId: redistribution.causeId,
          causeName: redistribution.causeName,
          is501c3: false,
          allocated: redistribution.amount,
          taxReserveDeduction: ZERO,
          disbursed: ZERO,
        });
        allocationDetailMap.set(redistribution.causeId, [
          {
            kind: "true_up",
            label: "Tax true-up redistribution",
            allocatedAmount: redistribution.amount,
          },
        ]);
      }
    }

    allocationRows = Array.from(allocationMapWithCarryForward.values());
  }

  const allocation501c3Total = allocationRows.reduce(
    (sum, allocation) => (allocation.is501c3 ? sum.add(allocation.allocated) : sum),
    ZERO,
  );

  const deductionPool = expenseTotal.add(allocation501c3Total);
  const taxableContribution = grossContribution
    .sub(materialDeduction)
    .sub(packagingDeduction)
    .add(taxableContributionAdjustments);
  const taxEstimate = isAllTime
    ? computeEstimatedTaxReserve({
        taxableContribution,
        businessExpenseTotal: expenseTotal,
        allocations: allocationRows,
        effectiveTaxRate: shop?.effectiveTaxRate,
        taxDeductionMode: shop?.taxDeductionMode,
      })
    : await calculateEstimatedTaxForPeriod(shopId, selectedPeriod.id, db);
  if (!useClosedAllocations) {
    allocationRows = applyEstimatedTaxReserveToAllocations(
      allocationRows,
      taxEstimate.estimatedTaxReserve,
      shop?.taxDeductionMode,
    );
  }
  const carryForwardSurplus = carryForwardTrueUps.reduce(
    (sum, trueUp) => (trueUp.delta.greaterThan(ZERO) ? sum.add(trueUp.delta) : sum),
    ZERO,
  );
  const carryForwardShortfall = carryForwardTrueUps.reduce(
    (sum, trueUp) => (trueUp.delta.lessThan(ZERO) ? sum.add(trueUp.delta.abs()) : sum),
    ZERO,
  );
  const requestedDonation = allocationRows.reduce(
    (sum, allocation) => sum.add(allocation.allocated),
    ZERO,
  );
  const poolResult = computeDonationPool({
    totalNetContribution,
    shopifyCharges,
    externalSettlementFees,
    artistPayouts: totalArtistPayout,
    estimatedTaxReserve: taxEstimate.estimatedTaxReserve,
    taxTrueUpSurplus: carryForwardSurplus,
    taxTrueUpShortfall: carryForwardShortfall,
    requestedDonation,
  });
  allocationRows = capCauseAllocations(allocationRows, poolResult.donationPool);
  for (const allocation of allocationRows) {
    if (allocation.taxReserveDeduction.lessThanOrEqualTo(ZERO)) continue;
    const details = allocationDetailMap.get(allocation.causeId) ?? [];
    details.push({
      kind: "tax_reserve",
      label: "Estimated tax reserve",
      allocatedAmount: allocation.taxReserveDeduction.negated(),
    });
    allocationDetailMap.set(allocation.causeId, details);
  }
  const taxableExposure = taxEstimate.taxableBase.mul(taxEstimate.taxableWeight).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_FLOOR,
  );
  const widgetTaxSuppressed = taxableExposure.lessThanOrEqualTo(0);
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

  const artistPaymentRows = artistPayments.map((payment) => ({
    id: payment.id,
    artistId: payment.artistId,
    artistName: payment.artist.displayName,
    creditName: payment.artist.creditName,
    amount: payment.amount.toString(),
    paidAt: payment.paidAt.toISOString(),
    paymentMethod: payment.paymentMethod,
    referenceId: payment.referenceId ?? null,
    notes: payment.notes ?? null,
    applications: payment.applications.map((application) => ({
      periodId: application.artistAllocation.periodId,
      periodStartDate: application.artistAllocation.period.startDate.toISOString(),
      periodEndDate: application.artistAllocation.period.endDate.toISOString(),
      amount: application.amount.toString(),
    })),
  }));

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

  const artistPayablesMap = new Map<
    string,
    {
      artistId: string;
      artistName: string;
      creditName: string;
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

  for (const allocation of outstandingArtistAllocations) {
    const existing = artistPayablesMap.get(allocation.artistId) ?? {
      artistId: allocation.artistId,
      artistName: allocation.artistName,
      creditName: allocation.creditName,
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
    artistPayablesMap.set(allocation.artistId, existing);
  }

  if (selectedPeriod.status === "OPEN") {
    for (const allocation of artistAllocationRows) {
      const existing = artistPayablesMap.get(allocation.artistId) ?? {
        artistId: allocation.artistId,
        artistName: allocation.artistName,
        creditName: allocation.creditName,
        currentOutstanding: ZERO,
        priorOutstanding: ZERO,
        periods: [],
      };

      const netOutstanding = floorCurrency(
        new Prisma.Decimal(allocation.allocated).sub(new Prisma.Decimal(allocation.paid ?? ZERO)),
      );
      existing.currentOutstanding = existing.currentOutstanding.add(
        netOutstanding.greaterThan(ZERO) ? netOutstanding : ZERO,
      );
      artistPayablesMap.set(allocation.artistId, existing);
    }
  }

  const artistPayables = Array.from(artistPayablesMap.values()).map((payable) => {
    const totalOutstanding = payable.currentOutstanding.add(payable.priorOutstanding);
    return {
      artistId: payable.artistId,
      artistName: payable.artistName,
      creditName: payable.creditName,
      currentOutstanding: payable.currentOutstanding.toString(),
      priorOutstanding: payable.priorOutstanding.toString(),
      totalOutstanding: totalOutstanding.toString(),
      overdue: payable.priorOutstanding.greaterThan(ZERO),
      periods: payable.periods,
    };
  });

  return {
    periods: [{
      id: ALL_TIME_PERIOD_ID,
      status: "ROLLUP",
      source: "synthetic",
      startDate: periods.reduce((earliest, period) => period.startDate < earliest ? period.startDate : earliest, periods[0].startDate).toISOString(),
      endDate: periods.reduce((latest, period) => period.endDate > latest ? period.endDate : latest, periods[0].endDate).toISOString(),
      shopifyPayoutId: null,
      closedAt: null,
    }, ...periods.map((period) => ({
      id: period.id,
      status: period.status,
      source: period.source,
      startDate: period.startDate.toISOString(),
      endDate: period.endDate.toISOString(),
      shopifyPayoutId: period.shopifyPayoutId ?? null,
      closedAt: period.closedAt?.toISOString() ?? null,
    }))],
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
        grossContribution: grossContribution.toString(),
        laborDeduction: laborDeduction.toString(),
        materialDeduction: materialDeduction.toString(),
        packagingDeduction: packagingDeduction.toString(),
        equipmentDeduction: equipmentDeduction.toString(),
        podDeduction: podDeduction.toString(),
        mistakeBufferDeduction: mistakeBufferDeduction.toString(),
        netContributionAdjustments: netContributionAdjustments.toString(),
        totalNetContribution: totalNetContribution.toString(),
        salesTaxCollected: salesTaxCollected.toString(),
        shopifyCharges: shopifyCharges.toString(),
        externalSettlementFees: externalSettlementFees.toString(),
        estimatedTaxReserve: taxEstimate.estimatedTaxReserve.toString(),
        taxableContribution: taxableContribution.toString(),
        taxableBase: taxEstimate.taxableBase.toString(),
        availableDonationCapacity: poolResult.availableDonationCapacity.toString(),
        requestedDonation: poolResult.requestedDonation.toString(),
        donationPool: poolResult.donationPool.toString(),
        retainedByShop: poolResult.retainedByShop.toString(),
        taxTrueUpSurplusApplied: carryForwardSurplus.toString(),
        taxTrueUpShortfallApplied: carryForwardShortfall.toString(),
        artistPayoutTotal: totalArtistPayout.toString(),
        allocations: allocationRows.map((allocation) => ({
          causeId: allocation.causeId,
          causeName: allocation.causeName,
          is501c3: allocation.is501c3,
          allocated: allocation.allocated.toString(),
          disbursed: allocation.disbursed.toString(),
          adjustments: allocation.adjustments.toString(),
          adjustedOutstanding: Prisma.Decimal.max(
            ZERO,
            allocation.allocated.sub(allocation.adjustments).sub(allocation.disbursed),
          ).toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR).toString(),
          details: (allocationDetailMap.get(allocation.causeId) ?? []).map((detail) => ({
            kind: detail.kind,
            label: detail.label ?? null,
            orderSnapshotId: detail.orderSnapshotId,
            shopifyOrderId: detail.shopifyOrderId,
            orderNumber: detail.orderNumber ?? null,
            shopifyLineItemId: detail.shopifyLineItemId,
            productTitle: detail.productTitle,
            variantTitle: detail.variantTitle,
            quantity: detail.quantity,
            grossLineAmount: detail.grossLineAmount?.toString() ?? null,
            netContributionAmount: detail.netContributionAmount?.toString() ?? null,
            allocatedAmount: detail.allocatedAmount.toString(),
          })),
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
      externalSettlements: externalSettlements.map((settlement) => ({
        id: settlement.id,
        shopifyOrderId: settlement.shopifyOrderId,
        orderNumber: settlement.orderNumber ?? null,
        source: settlement.source,
        status: settlement.status,
        grossOrderAmount: settlement.grossOrderAmount.toString(),
        shopifyPaidAmount: settlement.shopifyPaidAmount?.toString() ?? null,
        amountReceived: settlement.amountReceived?.toString() ?? null,
        feeAmount: settlement.feeAmount.toString(),
        currency: settlement.currency,
        paidAt: settlement.paidAt?.toISOString() ?? null,
        referenceId: settlement.referenceId ?? null,
        notes: settlement.notes ?? null,
        detectedReason: settlement.detectedReason ?? null,
      })),
      packaging: {
        allocations: packageAllocations.map((allocation: any) => ({
          id: allocation.id,
          packageName: allocation.packageName,
          quantity: allocation.quantity,
          materialCost: allocation.materialCost.toString(),
          source: allocation.source,
          confidence: allocation.confidence,
          reason: allocation.reason ?? null,
          snapshotId: allocation.snapshot.id,
          orderNumber: allocation.snapshot.orderNumber ?? "Unnumbered order",
        })),
        reviewItems: packagingReviewItems.map((item: any) => ({
          id: item.id,
          reason: item.reason,
          severity: item.severity,
          createdAt: item.createdAt.toISOString(),
          snapshotId: item.snapshotId,
          orderNumber: item.snapshot.orderNumber ?? "Unnumbered order",
        })),
      },
      allocationAdjustmentReviews: Array.from(allocationAdjustmentReviewMap.values()),
      disbursements: disbursementRows,
      causePayables,
      artistAllocations: artistAllocationRows.map((allocation) => ({
        artistId: allocation.artistId,
        artistName: allocation.artistName,
        creditName: allocation.creditName,
        allocated: allocation.allocated.toString(),
        paid: allocation.paid.toString(),
      })),
      artistPayments: artistPaymentRows,
      artistPayables,
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
      activeArtists: activeArtists.map((artist) => ({
        id: artist.id,
        displayName: artist.displayName,
        creditName: artist.creditName,
        paymentEnabled: artist.paymentEnabled,
      })),
    },
  };
}
