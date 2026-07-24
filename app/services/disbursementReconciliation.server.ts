import { Prisma } from "@prisma/client";
import { prisma, type TransactionCapableDbClient } from "../db.server";
import { listOutstandingCauseAllocations } from "./causePayables.server";

const ZERO = new Prisma.Decimal(0);

type ReconciliationDb = Pick<
  Prisma.TransactionClient,
  "auditLog" | "causeAllocation" | "disbursement" | "disbursementApplication"
>;

function floorCurrency(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR);
}

function earlierDate(left: Date, right: Date) {
  return left < right ? left : right;
}

/**
 * Rebuild a cause's settlement ledger in payment-date order. This is safe to
 * rerun: payment totals remain immutable and application rows are derived.
 */
export async function reconcileCauseDisbursements(
  shopId: string,
  causeId: string,
  db: ReconciliationDb,
  actor = "system",
) {
  const disbursements = await db.disbursement.findMany({
    where: { shopId, causeId },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      amount: true,
      feesCoveredAmount: true,
      paidAt: true,
      period: { select: { endDate: true } },
    },
  });

  const allocations = await db.causeAllocation.findMany({
    where: { shopId, causeId },
    select: { id: true },
  });
  const allocationIds = allocations.map((allocation) => allocation.id);

  if (allocationIds.length > 0) {
    await db.disbursementApplication.deleteMany({
      where: { shopId, causeAllocationId: { in: allocationIds } },
    });
    await db.causeAllocation.updateMany({
      where: { shopId, id: { in: allocationIds } },
      data: { disbursed: ZERO },
    });
  }

  let applicationCount = 0;
  for (const disbursement of disbursements) {
    const payoutAmount = floorCurrency(disbursement.amount.sub(disbursement.feesCoveredAmount));
    const eligible = await listOutstandingCauseAllocations(
      shopId,
      {
        causeId,
        throughPeriodEndDate: earlierDate(disbursement.period.endDate, disbursement.paidAt),
      },
      db,
    );
    const available = eligible.reduce((sum, allocation) => sum.add(allocation.remaining), ZERO);
    const allocatedAmount = Prisma.Decimal.min(payoutAmount, available);
    const extraContributionAmount = payoutAmount.sub(allocatedAmount);
    let unapplied = allocatedAmount;

    for (const allocation of eligible) {
      if (unapplied.lessThanOrEqualTo(ZERO)) break;
      const amount = Prisma.Decimal.min(unapplied, allocation.remaining);
      if (amount.lessThanOrEqualTo(ZERO)) continue;
      await db.disbursementApplication.create({
        data: {
          shopId,
          disbursementId: disbursement.id,
          causeAllocationId: allocation.id,
          amount,
        },
      });
      await db.causeAllocation.updateMany({
        where: { shopId, id: allocation.id },
        data: { disbursed: { increment: amount } },
      });
      applicationCount += 1;
      unapplied = unapplied.sub(amount);
    }

    await db.disbursement.update({
      where: { id: disbursement.id, shopId },
      data: { allocatedAmount, extraContributionAmount },
    });
  }

  await db.auditLog.create({
    data: {
      shopId,
      entity: "Disbursement",
      action: "DISBURSEMENT_APPLICATIONS_RECONCILED",
      actor,
      payload: {
        causeId,
        disbursementCount: disbursements.length,
        applicationCount,
      },
    },
  });

  return { disbursementCount: disbursements.length, applicationCount };
}

/** One-time/idempotent rollout entry point for payments created before this ledger rule. */
export async function reconcileExistingDisbursementsForShop(
  shopId: string,
  db: TransactionCapableDbClient = prisma,
) {
  const adjustmentResult = await db.$transaction(async (tx) => {
    const candidates = await tx.causeAllocation.findMany({
      where: {
        shopId,
        taxReserveDeduction: { gt: ZERO },
        applications: { some: { shopId } },
      },
      select: {
        id: true,
        createdAt: true,
        allocated: true,
        taxReserveDeduction: true,
        applications: {
          where: { shopId },
          select: { disbursement: { select: { paidAt: true } } },
        },
      },
    });
    const legacy = candidates.filter((allocation) =>
      allocation.applications.some((application) => application.disbursement.paidAt < allocation.createdAt),
    );
    for (const allocation of legacy) {
      const effectiveAt = allocation.applications.reduce(
        (earliest, application) => application.disbursement.paidAt < earliest
          ? application.disbursement.paidAt
          : earliest,
        allocation.createdAt,
      );
      await tx.causeAllocationAdjustment.upsert({
        where: {
          shopId_causeAllocationId_type_sourceKey: {
            shopId,
            causeAllocationId: allocation.id,
            type: "RETROACTIVE_TAX_BUFFER",
            sourceKey: "date-bounded-v1",
          },
        },
        create: {
          shopId,
          causeAllocationId: allocation.id,
          type: "RETROACTIVE_TAX_BUFFER",
          sourceKey: "date-bounded-v1",
          amount: Prisma.Decimal.min(allocation.taxReserveDeduction, allocation.allocated),
          effectiveAt,
        },
        update: {},
      });
    }
    if (legacy.length > 0) {
      await tx.auditLog.create({
        data: {
          shopId,
          entity: "CauseAllocationAdjustment",
          action: "RETROACTIVE_TAX_BUFFER_APPLIED",
          actor: "system",
          payload: { allocationIds: legacy.map((allocation) => allocation.id), count: legacy.length },
        },
      });
    }
    return legacy.length;
  });

  const causes = await db.disbursement.findMany({
    where: { shopId },
    distinct: ["causeId"],
    select: { causeId: true },
  });

  let disbursementCount = 0;
  let applicationCount = 0;
  for (const { causeId } of causes) {
    const result = await db.$transaction((tx) =>
      reconcileCauseDisbursements(shopId, causeId, tx),
    );
    disbursementCount += result.disbursementCount;
    applicationCount += result.applicationCount;
  }

  return { adjustmentCount: adjustmentResult, causeCount: causes.length, disbursementCount, applicationCount };
}
