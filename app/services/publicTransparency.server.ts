import { prisma } from "../db.server";
import { Prisma } from "@prisma/client";
import { computeEstimatedTaxReserve } from "./taxReserve.server";
import { createReceiptStorage, type ReceiptStorage } from "./receiptStorage.server";

const disclosureTierRank = {
  minimal: 0,
  standard: 1,
  detailed: 2,
} as const;

export type PublicDisclosureTier = keyof typeof disclosureTierRank;

export type PublicTransparencyPolicy = {
  enabled?: boolean;
  maximumDisclosureTier?: PublicDisclosureTier;
  publicReceiptsEnabled?: boolean;
  pendingDisbursementTotalsEnabled?: boolean;
};

export type PublicTransparencyPresentation = {
  requestedDisclosureTier?: PublicDisclosureTier;
  showOverviewTotals?: boolean;
  showReceiptHistory?: boolean;
  showCauseSummaries?: boolean;
  showReconciliation?: boolean;
  rollup?: PublicTransparencyRollup;
  month?: string;
  year?: string;
  periodId?: string;
};

export type PublicTransparencyData = Awaited<ReturnType<typeof buildPublicTransparencyPage>>;

export type PublicTransparencyRollup = "all" | "month" | "year" | "period";

type PublicPeriod = {
  id: string;
  startDate: Date;
  endDate: Date;
};

type PublicReceiptRow = {
  id: string;
  causeId: string;
  causeName: string;
  amount: string;
  feesCovered: string;
  paidAt: string;
  receiptUrl: string | null;
};

function decimalToNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoneyValue(value: number) {
  return Math.max(0, value).toFixed(2);
}

function constrainDisclosureTier(
  requested: PublicDisclosureTier,
  maximum: PublicDisclosureTier,
): PublicDisclosureTier {
  return disclosureTierRank[requested] <= disclosureTierRank[maximum] ? requested : maximum;
}

function canShowCauseSummaries(tier: PublicDisclosureTier) {
  return disclosureTierRank[tier] >= disclosureTierRank.standard;
}

function canShowReconciliation(tier: PublicDisclosureTier) {
  return disclosureTierRank[tier] >= disclosureTierRank.standard;
}

function parseMonthRange(month: string | undefined) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [yearValue, monthValue] = month.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(yearValue) || !Number.isFinite(monthValue) || monthValue < 1 || monthValue > 12) return null;

  const startDate = new Date(Date.UTC(yearValue, monthValue - 1, 1));
  const endDate = new Date(Date.UTC(yearValue, monthValue, 1));
  return { startDate, endDate, label: startDate.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

function parseYearRange(year: string | undefined) {
  if (!year || !/^\d{4}$/.test(year)) return null;
  const yearValue = Number.parseInt(year, 10);
  if (!Number.isFinite(yearValue)) return null;

  return {
    startDate: new Date(Date.UTC(yearValue, 0, 1)),
    endDate: new Date(Date.UTC(yearValue + 1, 0, 1)),
    label: String(yearValue),
  };
}

function resolveRollupRange(
  presentation: Required<Pick<PublicTransparencyPresentation, "rollup">> & PublicTransparencyPresentation,
  periods: PublicPeriod[],
) {
  if (presentation.rollup === "month") {
    return parseMonthRange(presentation.month) ?? null;
  }

  if (presentation.rollup === "year") {
    return parseYearRange(presentation.year) ?? null;
  }

  if (presentation.rollup === "period") {
    const selectedPeriod = periods.find((period) => period.id === presentation.periodId) ?? periods[0];
    if (!selectedPeriod) return null;
    return {
      startDate: selectedPeriod.startDate,
      endDate: selectedPeriod.endDate,
      label: `${selectedPeriod.startDate.toISOString().slice(0, 10)} to ${selectedPeriod.endDate.toISOString().slice(0, 10)}`,
    };
  }

  return null;
}

function sumValues<T>(rows: T[], pick: (row: T) => unknown) {
  return rows.reduce((sum, row) => sum + decimalToNumber(pick(row)), 0);
}

function buildMoneyRow(label: string, value: number, tone: "positive" | "negative" | "neutral" = "neutral") {
  return {
    label,
    amount: formatMoneyValue(value),
    tone,
  };
}

export async function buildPublicTransparencyPage(
  shopId: string,
  options: {
    policy?: PublicTransparencyPolicy;
    presentation?: PublicTransparencyPresentation;
    now?: Date;
  } = {},
  db = prisma,
  storage: ReceiptStorage = createReceiptStorage(),
) {
  const policy = {
    enabled: true,
    maximumDisclosureTier: "standard" as PublicDisclosureTier,
    publicReceiptsEnabled: true,
    pendingDisbursementTotalsEnabled: true,
    ...options.policy,
  };
  const presentation = {
    requestedDisclosureTier: "minimal" as PublicDisclosureTier,
    showOverviewTotals: true,
    showReceiptHistory: true,
    showCauseSummaries: true,
    showReconciliation: true,
    rollup: "all" as PublicTransparencyRollup,
    ...options.presentation,
  };

  const disclosureTier = constrainDisclosureTier(
    presentation.requestedDisclosureTier,
    policy.maximumDisclosureTier,
  );
  const showReceipts = policy.enabled && policy.publicReceiptsEnabled && presentation.showReceiptHistory;
  const showPending =
    policy.enabled && policy.pendingDisbursementTotalsEnabled && presentation.showOverviewTotals;
  const showCauseSummary = policy.enabled && presentation.showCauseSummaries && canShowCauseSummaries(disclosureTier);
  const showReconciliation = policy.enabled && presentation.showReconciliation && canShowReconciliation(disclosureTier);

  if (!policy.enabled) {
    return {
      metadata: {
        version: "2026-04",
        generatedAt: (options.now ?? new Date()).toISOString(),
        coverageLabel: "Public transparency is disabled",
        disclosureTier,
        hiddenSections: ["overview", "causeSummaries", "receipts"],
        rollup: presentation.rollup,
      },
      totals: {
        donationsMade: "0.00",
        donationsPendingDisbursement: "0.00",
      },
      causeSummaries: [],
      receipts: [],
      periods: [],
      reconciliation: null,
      receiptCauseSummaries: [],
      hasPublicActivity: false,
    };
  }

  const periods = await db.reportingPeriod.findMany({
    where: {
      shopId,
      status: "CLOSED",
      OR: [{ disbursements: { some: {} } }, { causeAllocations: { some: {} } }],
    },
    orderBy: [{ endDate: "desc" }, { startDate: "desc" }],
    select: {
      id: true,
      startDate: true,
      endDate: true,
      causeAllocations: {
        orderBy: { causeName: "asc" },
        select: {
          causeId: true,
          causeName: true,
          is501c3: true,
          allocated: true,
          disbursed: true,
        },
      },
      disbursements: {
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          amount: true,
          feesCoveredAmount: true,
          paidAt: true,
          receiptFileKey: true,
          cause: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
  const rollupRange = resolveRollupRange(presentation, periods);
  const periodIdsInScope = new Set(
    periods
      .filter((period) => {
        if (!rollupRange) return true;
        return period.startDate < rollupRange.endDate && period.endDate > rollupRange.startDate;
      })
      .map((period) => period.id),
  );
  const scopedPeriods = periods.filter((period) => periodIdsInScope.has(period.id));
  const scopedStartDate =
    rollupRange?.startDate ?? scopedPeriods.reduce<Date | null>((earliest, period) => (!earliest || period.startDate < earliest ? period.startDate : earliest), null);
  const scopedEndDate =
    rollupRange?.endDate ?? scopedPeriods.reduce<Date | null>((latest, period) => (!latest || period.endDate > latest ? period.endDate : latest), null);

  const [snapshotLines, orderSnapshots, shopifyChargeTransactions, externalSettlementTotals, shop, businessExpenseTotals] =
    scopedStartDate && scopedEndDate
      ? await Promise.all([
          db.orderSnapshotLine.findMany({
            where: {
              shopId,
              snapshot: {
                currentForOrderRecord: { isNot: null },
                orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
                createdAt: {
                  gte: scopedStartDate,
                  lt: scopedEndDate,
                },
              },
            },
            select: {
              quantity: true,
              subtotal: true,
              netContribution: true,
              laborCost: true,
              materialCost: true,
              packagingCost: true,
              equipmentCost: true,
              podCost: true,
              mistakeBufferAmount: true,
              totalCost: true,
              adjustments: {
                select: {
                  netContribAdj: true,
                  laborAdj: true,
                  materialAdj: true,
                  packagingAdj: true,
                  equipmentAdj: true,
                },
              },
            },
          }),
          db.orderSnapshot.findMany({
            where: {
              shopId,
              currentForOrderRecord: { isNot: null },
              orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
              createdAt: {
                gte: scopedStartDate,
                lt: scopedEndDate,
              },
            },
            select: {
              salesTaxCollected: true,
            },
          }),
          db.shopifyChargeTransaction.findMany({
            where: {
              shopId,
              OR: [
                { periodId: { in: Array.from(periodIdsInScope) } },
                {
                  periodId: null,
                  processedAt: {
                    gte: scopedStartDate,
                    lt: scopedEndDate,
                  },
                },
              ],
            },
            select: {
              amount: true,
              transactionType: true,
            },
          }),
          db.orderSettlement?.aggregate
            ? db.orderSettlement.aggregate({
                where: {
                  shopId,
                  status: "confirmed",
                  OR: [
                    { periodId: { in: Array.from(periodIdsInScope) } },
                    {
                      periodId: null,
                      snapshot: {
                        currentForOrderRecord: { isNot: null },
                        orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
                        createdAt: {
                          gte: scopedStartDate,
                          lt: scopedEndDate,
                        },
                      },
                    },
                  ],
                },
                _sum: { feeAmount: true },
              })
            : Promise.resolve({ _sum: { feeAmount: new Prisma.Decimal(0) } }),
          db.shop.findUnique({
            where: { shopId },
            select: {
              effectiveTaxRate: true,
              taxDeductionMode: true,
            },
          }),
          db.businessExpense.aggregate({
            where: {
              shopId,
              expenseDate: {
                gte: scopedStartDate,
                lt: scopedEndDate,
              },
            },
            _sum: { amount: true },
          }),
        ])
      : [[], [], [], { _sum: { feeAmount: new Prisma.Decimal(0) } }, null, { _sum: { amount: new Prisma.Decimal(0) } }];

  const causeTotals = new Map<string, { causeId: string; causeName: string; donated: number; pending: number }>();
  const receiptCauseTotals = new Map<
    string,
    { causeId: string; causeName: string; donated: number; feesCovered: number; receiptCount: number }
  >();
  const receipts: PublicReceiptRow[] = [];
  const periodRows: Array<{
    id: string;
    startDate: string;
    endDate: string;
    donationsMade: string;
    pendingRaw: number;
  }> = [];
  let totalDonated = 0;
  let totalPending = 0;

  for (const period of scopedPeriods) {
    let periodDonated = 0;
    let periodPending = 0;

    for (const allocation of period.causeAllocations) {
      const pending = Math.max(0, decimalToNumber(allocation.allocated) - decimalToNumber(allocation.disbursed));
      periodPending += pending;

      const existing =
        causeTotals.get(allocation.causeId) ??
        {
          causeId: allocation.causeId,
          causeName: allocation.causeName,
          donated: 0,
          pending: 0,
        };
      existing.pending += pending;
      causeTotals.set(allocation.causeId, existing);
    }

    for (const disbursement of period.disbursements) {
      const amount = decimalToNumber(disbursement.amount);
      const feesCovered = decimalToNumber(disbursement.feesCoveredAmount);
      periodDonated += amount;

      const existing =
        causeTotals.get(disbursement.cause.id) ??
        {
          causeId: disbursement.cause.id,
          causeName: disbursement.cause.name,
          donated: 0,
          pending: 0,
        };
      existing.donated += amount;
      causeTotals.set(disbursement.cause.id, existing);

      const receiptCause = receiptCauseTotals.get(disbursement.cause.id) ?? {
        causeId: disbursement.cause.id,
        causeName: disbursement.cause.name,
        donated: 0,
        feesCovered: 0,
        receiptCount: 0,
      };
      receiptCause.donated += amount;
      receiptCause.feesCovered += feesCovered;
      receiptCause.receiptCount += 1;
      receiptCauseTotals.set(disbursement.cause.id, receiptCause);

      if (showReceipts) {
        receipts.push({
          id: disbursement.id,
          causeId: disbursement.cause.id,
          causeName: disbursement.cause.name,
          amount: formatMoneyValue(amount),
          feesCovered: formatMoneyValue(feesCovered),
          paidAt: disbursement.paidAt.toISOString(),
          receiptUrl: disbursement.receiptFileKey
            ? await storage.getSignedReadUrl({
                key: disbursement.receiptFileKey,
                expiresInSeconds: 60 * 60,
              })
            : null,
        });
      }
    }

    totalDonated += periodDonated;
    totalPending += periodPending;

    periodRows.push({
      id: period.id,
      startDate: period.startDate.toISOString(),
      endDate: period.endDate.toISOString(),
      donationsMade: formatMoneyValue(periodDonated),
      pendingRaw: periodPending,
    });
  }

  const hiddenSections = [];
  if (!presentation.showOverviewTotals) hiddenSections.push("overview");
  if (!showCauseSummary) hiddenSections.push("causeSummaries");
  if (!showReceipts) hiddenSections.push("receipts");
  if (!showPending) hiddenSections.push("pendingDisbursements");
  if (!showReconciliation) hiddenSections.push("reconciliation");

  const grossSales = sumValues(snapshotLines, (line) => line.subtotal);
  const totalNetContribution = snapshotLines.reduce(
    (sum, line) =>
      sum
        .add(new Prisma.Decimal(line.netContribution?.toString() ?? 0))
        .add(
          line.adjustments.reduce(
            (adjustmentSum, adjustment) => adjustmentSum.add(new Prisma.Decimal(adjustment.netContribAdj?.toString() ?? 0)),
            new Prisma.Decimal(0),
          ),
        ),
    new Prisma.Decimal(0),
  );
  const itemCount = snapshotLines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0);
  const laborCost = sumValues(snapshotLines, (line) => line.laborCost) + sumValues(snapshotLines, (line) => sumValues(line.adjustments, (adjustment) => adjustment.laborAdj));
  const materialCost =
    sumValues(snapshotLines, (line) => line.materialCost) +
    sumValues(snapshotLines, (line) => sumValues(line.adjustments, (adjustment) => adjustment.materialAdj));
  const packagingCost =
    sumValues(snapshotLines, (line) => line.packagingCost) +
    sumValues(snapshotLines, (line) => sumValues(line.adjustments, (adjustment) => adjustment.packagingAdj));
  const equipmentCost =
    sumValues(snapshotLines, (line) => line.equipmentCost) +
    sumValues(snapshotLines, (line) => sumValues(line.adjustments, (adjustment) => adjustment.equipmentAdj));
  const podCost = sumValues(snapshotLines, (line) => line.podCost);
  const mistakeBuffer = sumValues(snapshotLines, (line) => line.mistakeBufferAmount);
  const shippingPostage = Math.abs(
    sumValues(shopifyChargeTransactions, (transaction) =>
      transaction.transactionType === "shipping_fee" ? transaction.amount : 0,
    ),
  );
  const platformFees = Math.abs(
    sumValues(shopifyChargeTransactions, (transaction) =>
      transaction.transactionType === "subscription_fee" || transaction.transactionType === "app_fee"
        ? transaction.amount
        : 0,
    ),
  );
  const shopifyFees = Math.abs(
    sumValues(shopifyChargeTransactions, (transaction) =>
      !transaction.transactionType ||
      transaction.transactionType === "payment_fee" ||
      transaction.transactionType === "transaction_fee" ||
      transaction.transactionType === "processing_fee"
        ? transaction.amount
        : 0,
    ),
  );
  const externalMarketplaceFees = Math.abs(
    decimalToNumber(externalSettlementTotals._sum.feeAmount ?? new Prisma.Decimal(0)),
  );
  const salesTaxCollected = sumValues(orderSnapshots, (snapshot) => snapshot.salesTaxCollected);
  const allocationInputs = scopedPeriods.flatMap((period) =>
    period.causeAllocations.map((allocation) => ({
      is501c3: allocation.is501c3,
      allocated: new Prisma.Decimal(allocation.allocated?.toString() ?? 0),
    })),
  );
  const taxEstimate = computeEstimatedTaxReserve({
    totalNetContribution,
    businessExpenseTotal: new Prisma.Decimal(businessExpenseTotals._sum.amount?.toString() ?? 0),
    allocations: allocationInputs,
    effectiveTaxRate: shop?.effectiveTaxRate,
    taxDeductionMode: shop?.taxDeductionMode,
  });
  const taxBuffer = decimalToNumber(taxEstimate.estimatedTaxReserve);
  const marketingReserve = 0;
  const productCosts =
    materialCost +
    laborCost +
    equipmentCost +
    packagingCost +
    podCost +
    mistakeBuffer;
  const salesAfterCollectedTax = grossSales - salesTaxCollected;
  const donationPoolAfterProductCosts = salesAfterCollectedTax - productCosts;
  const additionalPublicDeductions =
    shippingPostage +
    shopifyFees +
    externalMarketplaceFees +
    platformFees +
    taxBuffer +
    marketingReserve;
  const publicCostsAndReserves =
    salesTaxCollected +
    productCosts +
    shippingPostage +
    shopifyFees +
    externalMarketplaceFees +
    platformFees +
    taxBuffer +
    marketingReserve;
  const publicDonationPool = grossSales - publicCostsAndReserves;
  const remainingFundsToDonate = Math.max(publicDonationPool - totalDonated, 0);
  const displayPendingTotal = showPending ? Math.min(totalPending, remainingFundsToDonate) : 0;
  const pendingScale = totalPending > 0 ? displayPendingTotal / totalPending : 0;

  return {
    metadata: {
      version: "2026-04",
      generatedAt: (options.now ?? new Date()).toISOString(),
      coverageLabel: rollupRange?.label ?? "Closed reporting periods",
      disclosureTier,
      hiddenSections,
      rollup: presentation.rollup,
      periodStartDate: scopedStartDate?.toISOString() ?? null,
      periodEndDate: scopedEndDate?.toISOString() ?? null,
    },
    totals: {
      donationsMade: presentation.showOverviewTotals ? formatMoneyValue(totalDonated) : "0.00",
      donationsPendingDisbursement: formatMoneyValue(displayPendingTotal),
    },
    causeSummaries: showCauseSummary
      ? Array.from(causeTotals.values())
          .sort((left, right) => left.causeName.localeCompare(right.causeName))
          .map((cause) => ({
            causeId: cause.causeId,
            causeName: cause.causeName,
            donationsMade: formatMoneyValue(cause.donated),
            donationsPendingDisbursement: showPending ? formatMoneyValue(cause.pending * pendingScale) : "0.00",
          }))
      : [],
    receipts,
    receiptCauseSummaries: showReceipts
      ? Array.from(receiptCauseTotals.values())
          .sort((left, right) => left.causeName.localeCompare(right.causeName))
          .map((cause) => ({
            causeId: cause.causeId,
            causeName: cause.causeName,
            donationsMade: formatMoneyValue(cause.donated),
            feesCovered: formatMoneyValue(cause.feesCovered),
            receiptCount: cause.receiptCount,
            receipts: receipts.filter((receipt) => receipt.causeId === cause.causeId),
          }))
      : [],
    reconciliation: showReconciliation
      ? {
          summary: {
            orderCount: orderSnapshots.length,
            itemCount,
            grossSales: formatMoneyValue(grossSales),
            salesTaxCollected: formatMoneyValue(salesTaxCollected),
            donationPoolAfterProductCosts: formatMoneyValue(donationPoolAfterProductCosts),
            additionalPublicDeductions: formatMoneyValue(additionalPublicDeductions),
            netDonationPool: formatMoneyValue(publicDonationPool),
            donationsMade: formatMoneyValue(totalDonated),
            remainingFundsToDonate: formatMoneyValue(remainingFundsToDonate),
            donationsPendingDisbursement: formatMoneyValue(displayPendingTotal),
          },
          sections: [
            {
              title: "Sales",
              rows: [
                buildMoneyRow("Gross sales", grossSales, "positive"),
                buildMoneyRow("Sales tax collected", salesTaxCollected, "negative"),
              ],
            },
            {
              title: "Costs and reserves",
              rows: [
                buildMoneyRow("Materials", materialCost, "negative"),
                buildMoneyRow("Labor / assembly", laborCost, "negative"),
                buildMoneyRow("Equipment / maintenance", equipmentCost, "negative"),
                buildMoneyRow("Packaging / shipping materials", packagingCost, "negative"),
                buildMoneyRow("Shipping / postage", shippingPostage, "negative"),
                buildMoneyRow("POD/provider fulfillment", podCost, "negative"),
                buildMoneyRow("Mistake buffer", mistakeBuffer, "negative"),
                buildMoneyRow("Shopify/payment fees", shopifyFees, "negative"),
                buildMoneyRow("External marketplace settlement fees", externalMarketplaceFees, "negative"),
                buildMoneyRow("Shopify subscription/app fees", platformFees, "negative"),
                buildMoneyRow("Tax buffer", taxBuffer, "negative"),
                buildMoneyRow("Marketing/acquisition reserve", marketingReserve, "negative"),
              ],
            },
            {
              title: "Donation outcome",
              rows: [
                buildMoneyRow("Sales after collected tax", salesAfterCollectedTax, "positive"),
                buildMoneyRow("Donation pool after sales tax and product costs", donationPoolAfterProductCosts, "positive"),
                buildMoneyRow("Less fees, shipping, and reserves", additionalPublicDeductions, "negative"),
                buildMoneyRow("Public donation pool", publicDonationPool, "positive"),
                buildMoneyRow("Donations made", totalDonated, "positive"),
                buildMoneyRow("Remaining funds to donate", remainingFundsToDonate, "neutral"),
              ],
            },
          ],
          notes: [
            "Summaries are aggregated for public transparency and do not expose raw orders, payout IDs, transaction rows, or internal notes.",
            "Sales tax collected is an order-level pass-through amount and is deducted separately from the donation pool.",
            "Tax buffer is an estimated income/self-employment tax reserve, not collected sales tax.",
            "The product-cost donation pool is shown separately from the final public donation pool so payment fees, shipping/postage, and public reserves can be reconciled without double-subtracting product costs.",
            "General business expenses are internal tax-supporting records and are not deducted from the public donation pool by default.",
          ],
        }
      : null,
    periods: periodRows.map((period) => ({
      id: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      donationsMade: period.donationsMade,
      donationsPendingDisbursement: showPending ? formatMoneyValue(period.pendingRaw * pendingScale) : "0.00",
    })),
    hasPublicActivity: scopedPeriods.length > 0,
  };
}
