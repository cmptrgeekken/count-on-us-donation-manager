import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import {
  computeEstimatedTaxReserve,
  normalizeTaxDeductionMode,
  type TaxDeductionMode,
} from "./taxReserve.server";

type DbClient = typeof prisma;

const ZERO = new Prisma.Decimal(0);

export const taxTrueUpErrorCodes = {
  PERIOD_NOT_FOUND: "PERIOD_NOT_FOUND",
  PERIOD_NOT_CLOSED: "PERIOD_NOT_CLOSED",
  TRUE_UP_ALREADY_EXISTS: "TRUE_UP_ALREADY_EXISTS",
  ACTUAL_TAX_NEGATIVE: "ACTUAL_TAX_NEGATIVE",
  OPEN_PERIOD_REQUIRED: "OPEN_PERIOD_REQUIRED",
  REDISTRIBUTION_REQUIRED: "REDISTRIBUTION_REQUIRED",
  REDISTRIBUTION_INVALID_CAUSE: "REDISTRIBUTION_INVALID_CAUSE",
  REDISTRIBUTION_MISMATCH: "REDISTRIBUTION_MISMATCH",
  SHORTFALL_CONFIRMATION_REQUIRED: "SHORTFALL_CONFIRMATION_REQUIRED",
} as const;

type TaxTrueUpErrorCode = (typeof taxTrueUpErrorCodes)[keyof typeof taxTrueUpErrorCodes];

export class TaxTrueUpError extends Error {
  constructor(
    public code: TaxTrueUpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaxTrueUpError";
  }
}

export type TaxTrueUpRedistributionInput = {
  causeId: string;
  amount: Prisma.Decimal | string | number;
};

export type RecordTaxTrueUpInput = {
  periodId: string;
  actualTax: Prisma.Decimal | string | number;
  filedAt: Date;
  redistributionNotes?: string | null;
  redistributions?: TaxTrueUpRedistributionInput[];
  confirmShortfall?: boolean;
};

function toDecimal(value: Prisma.Decimal | string | number) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export async function calculateEstimatedTaxForPeriod(
  shopId: string,
  periodId: string,
  db: DbClient = prisma,
) {
  const period = await db.reportingPeriod.findFirst({
    where: { id: periodId, shopId },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
    },
  });

  if (!period) {
    throw new TaxTrueUpError(taxTrueUpErrorCodes.PERIOD_NOT_FOUND, "Reporting period not found.");
  }

  const [shop, snapshotTotals, adjustmentTotals, closedAllocationTotals, liveAllocationTotals, expenseTotals] = await Promise.all([
    db.shop.findUnique({
      where: { shopId },
      select: {
        effectiveTaxRate: true,
        taxDeductionMode: true,
      },
    }),
    db.orderSnapshotLine.aggregate({
      where: {
        shopId,
        snapshot: {
          createdAt: {
            gte: period.startDate,
            lt: period.endDate,
          },
        },
      },
      _sum: { netContribution: true },
    }),
    db.adjustment.aggregate({
      where: {
        shopId,
        snapshotLine: {
          snapshot: {
            createdAt: {
              gte: period.startDate,
              lt: period.endDate,
            },
          },
        },
      },
      _sum: { netContribAdj: true },
    }),
    db.causeAllocation.findMany({
      where: {
        shopId,
        periodId,
      },
      select: {
        is501c3: true,
        allocated: true,
      },
    }),
    db.lineCauseAllocation.findMany({
      where: {
        shopId,
        snapshotLine: {
          snapshot: {
            createdAt: {
              gte: period.startDate,
              lt: period.endDate,
            },
          },
        },
      },
      select: {
        is501c3: true,
        amount: true,
      },
    }),
    db.businessExpense.aggregate({
      where: {
        shopId,
        expenseDate: {
          gte: period.startDate,
          lt: period.endDate,
        },
      },
      _sum: { amount: true },
    }),
  ]);

  const totalNetContribution = (snapshotTotals._sum.netContribution ?? ZERO).add(adjustmentTotals._sum.netContribAdj ?? ZERO);
  const allocations = closedAllocationTotals.length > 0
    ? closedAllocationTotals
    : liveAllocationTotals.map((allocation) => ({
        is501c3: allocation.is501c3,
        allocated: allocation.amount,
      }));
  const businessExpenseTotal = expenseTotals._sum.amount ?? ZERO;
  const effectiveTaxRate = shop?.effectiveTaxRate ?? ZERO;
  const taxDeductionMode: TaxDeductionMode = normalizeTaxDeductionMode(shop?.taxDeductionMode);

  const result = computeEstimatedTaxReserve({
    totalNetContribution,
    businessExpenseTotal,
    allocations,
    effectiveTaxRate,
    taxDeductionMode,
  });

  return {
    period,
    totalNetContribution,
    businessExpenseTotal,
    effectiveTaxRate,
    taxDeductionMode,
    ...result,
  };
}

export async function recordTaxTrueUp(
  shopId: string,
  input: RecordTaxTrueUpInput,
  options?: {
    db?: DbClient;
    actor?: string;
  },
) {
  const db = options?.db ?? prisma;
  const actor = options?.actor ?? "merchant";
  const actualTax = toDecimal(input.actualTax).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  if (actualTax.lessThan(ZERO)) {
    throw new TaxTrueUpError(taxTrueUpErrorCodes.ACTUAL_TAX_NEGATIVE, "Actual tax must be 0 or greater.");
  }

  return db.$transaction(async (tx) => {
    const [estimated, existingTrueUp, openPeriod] = await Promise.all([
      calculateEstimatedTaxForPeriod(shopId, input.periodId, tx as DbClient),
      tx.taxTrueUp.findFirst({
        where: {
          shopId,
          periodId: input.periodId,
        },
        select: { id: true },
      }),
      tx.reportingPeriod.findFirst({
        where: {
          shopId,
          status: "OPEN",
          NOT: { id: input.periodId },
        },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      }),
    ]);

    if (estimated.period.status !== "CLOSED") {
      throw new TaxTrueUpError(taxTrueUpErrorCodes.PERIOD_NOT_CLOSED, "Tax true-up can only be recorded for a closed reporting period.");
    }

    if (existingTrueUp) {
      throw new TaxTrueUpError(taxTrueUpErrorCodes.TRUE_UP_ALREADY_EXISTS, "A tax true-up has already been recorded for this reporting period.");
    }

    const delta = estimated.estimatedTaxReserve.sub(actualTax).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const requiresAppliedPeriod = !delta.equals(ZERO);
    if (requiresAppliedPeriod && !openPeriod) {
      throw new TaxTrueUpError(taxTrueUpErrorCodes.OPEN_PERIOD_REQUIRED, "An open reporting period is required to receive this tax true-up adjustment.");
    }

    const rawRedistributions = (input.redistributions ?? []).map((entry) => ({
      causeId: entry.causeId,
      amount: toDecimal(entry.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    })).filter((entry) => entry.amount.greaterThan(ZERO));

    if (delta.greaterThan(ZERO)) {
      if (rawRedistributions.length === 0) {
        throw new TaxTrueUpError(taxTrueUpErrorCodes.REDISTRIBUTION_REQUIRED, "Surplus tax must be redistributed across one or more causes.");
      }

      const causes = await tx.cause.findMany({
        where: {
          shopId,
          status: "active",
          id: { in: rawRedistributions.map((entry) => entry.causeId) },
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (causes.length !== rawRedistributions.length) {
        throw new TaxTrueUpError(taxTrueUpErrorCodes.REDISTRIBUTION_INVALID_CAUSE, "Each redistribution must target an active cause.");
      }

      const redistributionTotal = rawRedistributions.reduce((sum, entry) => sum.add(entry.amount), ZERO);
      if (!redistributionTotal.equals(delta)) {
        throw new TaxTrueUpError(
          taxTrueUpErrorCodes.REDISTRIBUTION_MISMATCH,
          "Redistribution amounts must sum exactly to the tax surplus.",
        );
      }

      const causeMap = new Map(causes.map((cause) => [cause.id, cause.name]));
      const trueUp = await tx.taxTrueUp.create({
        data: {
          shopId,
          periodId: input.periodId,
          appliedPeriodId: openPeriod?.id ?? null,
          estimatedTax: estimated.estimatedTaxReserve,
          actualTax,
          delta,
          redistributionNotes: input.redistributionNotes?.trim() || null,
          filedAt: input.filedAt,
          redistributions: {
            create: rawRedistributions.map((entry) => ({
              shopId,
              causeId: entry.causeId,
              causeName: causeMap.get(entry.causeId) ?? "Cause",
              amount: entry.amount,
            })),
          },
        },
        include: {
          redistributions: true,
        },
      });

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "TaxTrueUp",
          entityId: trueUp.id,
          action: "TAX_TRUE_UP_RECORDED",
          actor,
          payload: {
            periodId: input.periodId,
            appliedPeriodId: openPeriod?.id ?? null,
            estimatedTax: estimated.estimatedTaxReserve.toString(),
            actualTax: actualTax.toString(),
            delta: delta.toString(),
            scenario: "surplus",
            redistributionCount: rawRedistributions.length,
          },
        },
      });

      return trueUp;
    }

    if (delta.lessThan(ZERO) && !input.confirmShortfall) {
      throw new TaxTrueUpError(
        taxTrueUpErrorCodes.SHORTFALL_CONFIRMATION_REQUIRED,
        "Please confirm that the shortfall should be deducted from the active donation pool.",
      );
    }

    const trueUp = await tx.taxTrueUp.create({
      data: {
        shopId,
        periodId: input.periodId,
        appliedPeriodId: requiresAppliedPeriod ? openPeriod?.id ?? null : null,
        estimatedTax: estimated.estimatedTaxReserve,
        actualTax,
        delta,
        redistributionNotes: input.redistributionNotes?.trim() || null,
        filedAt: input.filedAt,
      },
      include: {
        redistributions: true,
      },
    });

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "TaxTrueUp",
        entityId: trueUp.id,
        action: "TAX_TRUE_UP_RECORDED",
        actor,
        payload: {
          periodId: input.periodId,
          appliedPeriodId: requiresAppliedPeriod ? openPeriod?.id ?? null : null,
          estimatedTax: estimated.estimatedTaxReserve.toString(),
          actualTax: actualTax.toString(),
          delta: delta.toString(),
          scenario: delta.lessThan(ZERO) ? "shortfall" : "exact",
        },
      },
    });

    return trueUp;
  });
}
