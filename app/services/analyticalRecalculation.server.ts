import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import { resolveCosts } from "./costEngine.server";
import { buildReportingSummary } from "./reportingSummary.server";

const ZERO = new Prisma.Decimal(0);

function decimalOrZero(value: Prisma.Decimal | null | undefined) {
  return value ?? ZERO;
}

function toMoneyString(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

type RecalculationSummary = {
  period: {
    authoritativeNetContribution: string;
    recalculatedNetContribution: string;
    netContributionDelta: string;
    authoritativeDonationPool: string;
    recalculatedDonationPool: string;
    donationPoolDelta: string;
    shopifyCharges: string;
  };
  causes: Array<{
    causeId: string;
    causeName: string;
    authoritativeAllocated: string;
    recalculatedAllocated: string;
    delta: string;
  }>;
};

function addCauseAmount(
  target: Map<string, { causeId: string; causeName: string; amount: Prisma.Decimal }>,
  cause: { causeId: string; causeName: string; amount: Prisma.Decimal },
) {
  const current = target.get(cause.causeId);
  if (!current) {
    target.set(cause.causeId, cause);
    return;
  }

  target.set(cause.causeId, {
    ...current,
    amount: current.amount.add(cause.amount),
  });
}

export async function queueAnalyticalRecalculation(
  shopId: string,
  periodId: string,
  db = prisma,
  boss = jobQueue,
) {
  const run = await db.analyticalRecalculationRun.create({
    data: {
      shopId,
      periodId,
      status: "queued",
    },
  });

  await boss.send("reporting.recalculate", {
    shopId,
    runId: run.id,
  });

  await db.auditLog.create({
    data: {
      shopId,
      entity: "AnalyticalRecalculationRun",
      entityId: run.id,
      action: "ANALYTICAL_RECALCULATION_QUEUED",
      actor: "merchant",
      payload: { periodId },
    },
  });

  return run;
}

export async function computeAnalyticalRecalculationSummary(shopId: string, periodId: string, db = prisma): Promise<RecalculationSummary> {
  const [period, authoritative] = await Promise.all([
    db.reportingPeriod.findFirst({
      where: { id: periodId, shopId },
      select: { id: true, startDate: true, endDate: true },
    }),
    buildReportingSummary(shopId, periodId, db),
  ]);

  if (!period || !authoritative.summary) {
    throw new Error("Reporting period not found for analytical recalculation.");
  }

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
      shopifyVariantId: true,
      salePrice: true,
      quantity: true,
      netContribution: true,
      causeAllocations: {
        select: {
          causeId: true,
          causeName: true,
          amount: true,
        },
      },
      adjustments: {
        select: {
          netContribAdj: true,
        },
      },
    },
  });

  const variantIds = [...new Set(snapshotLines.map((line) => line.shopifyVariantId))];
  const variants = await db.variant.findMany({
    where: {
      shopId,
      shopifyId: { in: variantIds },
    },
    select: {
      id: true,
      shopifyId: true,
      product: {
        select: {
          id: true,
          shopifyId: true,
        },
      },
    },
  });
  const variantMap = new Map(variants.map((variant) => [variant.shopifyId, variant]));

  const productIds = [...new Set(variants.map((variant) => variant.product.id))];
  const assignments = await db.productCauseAssignment.findMany({
    where: {
      shopId,
      productId: { in: productIds },
    },
    select: {
      productId: true,
      percentage: true,
      causeId: true,
      cause: {
        select: {
          name: true,
        },
      },
    },
  });
  const assignmentMap = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const current = assignmentMap.get(assignment.productId ?? "") ?? [];
    current.push(assignment);
    assignmentMap.set(assignment.productId ?? "", current);
  }

  let recalculatedNetContribution = ZERO;
  const recalculatedCauseTotals = new Map<string, { causeId: string; causeName: string; amount: Prisma.Decimal }>();

  for (const line of snapshotLines) {
    const adjustmentTotal = line.adjustments.reduce(
      (sum, adjustment) => sum.add(adjustment.netContribAdj),
      ZERO,
    );
    const variant = variantMap.get(line.shopifyVariantId);

    if (!variant) {
      const fallbackNet = line.netContribution.add(adjustmentTotal);
      recalculatedNetContribution = recalculatedNetContribution.add(fallbackNet);
      for (const allocation of line.causeAllocations) {
        addCauseAmount(recalculatedCauseTotals, {
          causeId: allocation.causeId,
          causeName: allocation.causeName,
          amount: allocation.amount,
        });
      }
      continue;
    }

    const resolved = await resolveCosts(shopId, variant.id, line.salePrice, "snapshot", db as Parameters<typeof resolveCosts>[4]);
    const lineNet = decimalOrZero(resolved.netContribution)
      .mul(line.quantity)
      .add(adjustmentTotal);
    recalculatedNetContribution = recalculatedNetContribution.add(lineNet);

    const productAssignments = assignmentMap.get(variant.product.id) ?? [];
    if (productAssignments.length === 0) {
      for (const allocation of line.causeAllocations) {
        addCauseAmount(recalculatedCauseTotals, {
          causeId: allocation.causeId,
          causeName: allocation.causeName,
          amount: allocation.amount,
        });
      }
      continue;
    }

    for (const assignment of productAssignments) {
      addCauseAmount(recalculatedCauseTotals, {
        causeId: assignment.causeId,
        causeName: assignment.cause.name,
        amount: Prisma.Decimal.max(lineNet, ZERO).mul(assignment.percentage).div(100),
      });
    }
  }

  const authoritativeNetContribution = new Prisma.Decimal(authoritative.summary.track1.totalNetContribution);
  const shopifyCharges = new Prisma.Decimal(authoritative.summary.track1.shopifyCharges);
  const authoritativeDonationPool = authoritativeNetContribution.sub(shopifyCharges);
  const recalculatedDonationPool = recalculatedNetContribution.sub(shopifyCharges);

  const authoritativeCauseTotals = new Map(
    authoritative.summary.track1.allocations.map((allocation) => [
      allocation.causeId,
      {
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        amount: new Prisma.Decimal(allocation.allocated),
      },
    ]),
  );

  const allCauseIds = [...new Set([...authoritativeCauseTotals.keys(), ...recalculatedCauseTotals.keys()])];
  const causes = allCauseIds
    .map((causeId) => {
      const authoritativeCause = authoritativeCauseTotals.get(causeId);
      const recalculatedCause = recalculatedCauseTotals.get(causeId);
      const authoritativeAllocated = authoritativeCause?.amount ?? ZERO;
      const recalculatedAllocated = recalculatedCause?.amount ?? ZERO;

      return {
        causeId,
        causeName: recalculatedCause?.causeName ?? authoritativeCause?.causeName ?? "Unknown cause",
        authoritativeAllocated: toMoneyString(authoritativeAllocated),
        recalculatedAllocated: toMoneyString(recalculatedAllocated),
        delta: toMoneyString(recalculatedAllocated.sub(authoritativeAllocated)),
      };
    })
    .sort((left, right) => Math.abs(Number(right.delta)) - Math.abs(Number(left.delta)));

  return {
    period: {
      authoritativeNetContribution: toMoneyString(authoritativeNetContribution),
      recalculatedNetContribution: toMoneyString(recalculatedNetContribution),
      netContributionDelta: toMoneyString(recalculatedNetContribution.sub(authoritativeNetContribution)),
      authoritativeDonationPool: toMoneyString(authoritativeDonationPool),
      recalculatedDonationPool: toMoneyString(recalculatedDonationPool),
      donationPoolDelta: toMoneyString(recalculatedDonationPool.sub(authoritativeDonationPool)),
      shopifyCharges: toMoneyString(shopifyCharges),
    },
    causes,
  };
}

export async function runAnalyticalRecalculation(shopId: string, runId: string, db = prisma) {
  const run = await db.analyticalRecalculationRun.findFirst({
    where: { id: runId, shopId },
    select: { id: true, periodId: true },
  });

  if (!run) {
    throw new Error("Analytical recalculation run not found.");
  }

  await db.analyticalRecalculationRun.update({
    where: { id: run.id },
    data: {
      status: "running",
      startedAt: new Date(),
      errorMessage: null,
    },
  });

  try {
    const summary = await computeAnalyticalRecalculationSummary(shopId, run.periodId, db);
    const completedAt = new Date();

    await db.analyticalRecalculationRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        summary,
        completedAt,
      },
    });

    await db.auditLog.create({
      data: {
        shopId,
        entity: "AnalyticalRecalculationRun",
        entityId: run.id,
        action: "ANALYTICAL_RECALCULATION_COMPLETED",
        actor: "system",
        payload: {
          periodId: run.periodId,
          completedAt: completedAt.toISOString(),
        },
      },
    });
  } catch (error) {
    const completedAt = new Date();
    const message = error instanceof Error ? error.message : "Unknown analytical recalculation failure";

    await db.analyticalRecalculationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: message,
        completedAt,
      },
    });

    await db.auditLog.create({
      data: {
        shopId,
        entity: "AnalyticalRecalculationRun",
        entityId: run.id,
        action: "ANALYTICAL_RECALCULATION_FAILED",
        actor: "system",
        payload: {
          periodId: run.periodId,
          message,
        },
      },
    });

    throw error;
  }
}
