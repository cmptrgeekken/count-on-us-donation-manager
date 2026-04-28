import { prisma } from "../db.server";
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
};

export type PublicTransparencyData = Awaited<ReturnType<typeof buildPublicTransparencyPage>>;

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

  if (!policy.enabled) {
    return {
      metadata: {
        version: "2026-04",
        generatedAt: (options.now ?? new Date()).toISOString(),
        coverageLabel: "Public transparency is disabled",
        disclosureTier,
        hiddenSections: ["overview", "causeSummaries", "receipts"],
      },
      totals: {
        donationsMade: "0.00",
        donationsPendingDisbursement: "0.00",
      },
      causeSummaries: [],
      receipts: [],
      periods: [],
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
          allocated: true,
          disbursed: true,
        },
      },
      disbursements: {
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          amount: true,
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

  const causeTotals = new Map<string, { causeId: string; causeName: string; donated: number; pending: number }>();
  const receipts = [];
  const periodRows = [];
  let totalDonated = 0;
  let totalPending = 0;

  for (const period of periods) {
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

      if (showReceipts) {
        receipts.push({
          id: disbursement.id,
          causeName: disbursement.cause.name,
          amount: formatMoneyValue(amount),
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
      donationsPendingDisbursement: showPending ? formatMoneyValue(periodPending) : "0.00",
    });
  }

  const hiddenSections = [];
  if (!presentation.showOverviewTotals) hiddenSections.push("overview");
  if (!showCauseSummary) hiddenSections.push("causeSummaries");
  if (!showReceipts) hiddenSections.push("receipts");
  if (!showPending) hiddenSections.push("pendingDisbursements");

  return {
    metadata: {
      version: "2026-04",
      generatedAt: (options.now ?? new Date()).toISOString(),
      coverageLabel: "Closed reporting periods",
      disclosureTier,
      hiddenSections,
    },
    totals: {
      donationsMade: presentation.showOverviewTotals ? formatMoneyValue(totalDonated) : "0.00",
      donationsPendingDisbursement: showPending ? formatMoneyValue(totalPending) : "0.00",
    },
    causeSummaries: showCauseSummary
      ? Array.from(causeTotals.values())
          .sort((left, right) => left.causeName.localeCompare(right.causeName))
          .map((cause) => ({
            causeId: cause.causeId,
            causeName: cause.causeName,
            donationsMade: formatMoneyValue(cause.donated),
            donationsPendingDisbursement: showPending ? formatMoneyValue(cause.pending) : "0.00",
          }))
      : [],
    receipts,
    periods: periodRows,
    hasPublicActivity: periods.length > 0,
  };
}
