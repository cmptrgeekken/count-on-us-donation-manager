import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

export type OrderLifecycleState =
  | "active"
  | "partially_refunded"
  | "fully_refunded"
  | "canceled"
  | "unknown"
  | "review_required";

export type OrderLifecyclePayload = {
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  canceled_at?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
};

export type MerchantReviewLifecycleState = "active" | "fully_refunded" | "canceled";

type DbClient = typeof prisma;

function optionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeLifecycleValue(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  return normalized || null;
}

function sourceAuthority(source: string): number {
  switch (source) {
    case "reconciliation":
      return 4;
    case "webhook":
      return 3;
    case "historical_import":
      return 2;
    case "merchant_review":
      return 5;
    default:
      return 0;
  }
}

export function deriveLifecycleState(payload: OrderLifecyclePayload): OrderLifecycleState {
  if (payload.cancelled_at || payload.canceled_at) return "canceled";

  switch (normalizeLifecycleValue(payload.financial_status)) {
    case "refunded":
    case "voided":
      return "fully_refunded";
    case "partially_refunded":
      return "partially_refunded";
    case "authorized":
    case "paid":
    case "partially_paid":
    case "pending":
      return "active";
    default:
      return "unknown";
  }
}

export async function ensureOrderRecord(
  shopId: string,
  shopifyOrderId: string,
  db: DbClient = prisma,
): Promise<{ id: string; currentSnapshotId: string | null }> {
  return db.orderRecord.upsert({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
    create: { shopId, shopifyOrderId },
    update: {},
    select: { id: true, currentSnapshotId: true },
  });
}

export async function mergeOrderLifecycle(input: {
  shopId: string;
  orderRecordId: string;
  payload: OrderLifecyclePayload;
  source: "webhook" | "reconciliation" | "historical_import" | "merchant_review";
  db?: DbClient;
}): Promise<{ state: OrderLifecycleState; updated: boolean }> {
  const db = input.db ?? prisma;
  const incomingState = deriveLifecycleState(input.payload);
  const sourceUpdatedAt = optionalDate(input.payload.updated_at ?? input.payload.updatedAt);
  const cancelledAt = optionalDate(input.payload.cancelled_at ?? input.payload.canceled_at);
  const existing = await db.orderLifecycle.findUnique({
    where: { orderRecordId: input.orderRecordId, shopId: input.shopId },
    select: { state: true, source: true, sourceUpdatedAt: true },
  });

  const hasLifecycleEvidence =
    input.payload.financial_status !== undefined ||
    input.payload.fulfillment_status !== undefined ||
    input.payload.cancelled_at !== undefined ||
    input.payload.canceled_at !== undefined;

  if (!hasLifecycleEvidence && existing) {
    return { state: existing.state as OrderLifecycleState, updated: false };
  }

  if (existing) {
    const incomingIsOlder = Boolean(
      sourceUpdatedAt && existing.sourceUpdatedAt && sourceUpdatedAt < existing.sourceUpdatedAt,
    );
    const incomingIsNotStronger = sourceAuthority(input.source) <= sourceAuthority(existing.source);
    if (incomingIsOlder && incomingIsNotStronger) {
      return { state: existing.state as OrderLifecycleState, updated: false };
    }
  }

  const reviewReason = incomingState === "unknown" ? "Lifecycle evidence is incomplete" : null;
  const lifecycle = await db.orderLifecycle.upsert({
    where: { orderRecordId: input.orderRecordId, shopId: input.shopId },
    create: {
      shopId: input.shopId,
      orderRecordId: input.orderRecordId,
      state: incomingState,
      financialStatus: normalizeLifecycleValue(input.payload.financial_status),
      fulfillmentStatus: normalizeLifecycleValue(input.payload.fulfillment_status),
      cancelledAt,
      source: input.source,
      sourceUpdatedAt,
      reviewReason,
    },
    update: {
      state: incomingState,
      ...(input.payload.financial_status !== undefined
        ? { financialStatus: normalizeLifecycleValue(input.payload.financial_status) }
        : {}),
      ...(input.payload.fulfillment_status !== undefined
        ? { fulfillmentStatus: normalizeLifecycleValue(input.payload.fulfillment_status) }
        : {}),
      ...(input.payload.cancelled_at !== undefined || input.payload.canceled_at !== undefined
        ? { cancelledAt }
        : {}),
      source: input.source,
      ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
      reviewReason,
    },
    select: { state: true },
  });

  return { state: lifecycle.state as OrderLifecycleState, updated: true };
}

export async function bulkReviewOrderLifecycles(input: {
  shopId: string;
  snapshotIds: string[];
  state: MerchantReviewLifecycleState;
  db?: DbClient;
}): Promise<{ reviewed: number; skipped: number }> {
  const db = input.db ?? prisma;
  const snapshotIds = [...new Set(input.snapshotIds)];
  const snapshots = await db.orderSnapshot.findMany({
    where: {
      shopId: input.shopId,
      id: { in: snapshotIds },
      currentForOrderRecord: { isNot: null },
      orderRecord: {
        OR: [
          { lifecycle: { is: null } },
          { lifecycle: { is: { state: { in: ["unknown", "review_required"] } } } },
        ],
      },
    },
    select: { id: true, orderRecordId: true },
  });

  if (snapshots.length === 0) {
    return { reviewed: 0, skipped: snapshotIds.length };
  }

  const orderRecordIds = snapshots.map((snapshot) => snapshot.orderRecordId);
  const financialStatus = input.state === "active"
    ? "paid"
    : input.state === "fully_refunded"
      ? "refunded"
      : "voided";
  const cancelledAt = input.state === "canceled" ? new Date() : null;

  await db.$transaction(async (tx) => {
    await tx.orderLifecycle.createMany({
      data: orderRecordIds.map((orderRecordId) => ({
        shopId: input.shopId,
        orderRecordId,
        state: input.state,
        financialStatus,
        cancelledAt,
        source: "merchant_review",
        reviewReason: null,
      })),
      skipDuplicates: true,
    });
    await tx.orderLifecycle.updateMany({
      where: { shopId: input.shopId, orderRecordId: { in: orderRecordIds } },
      data: {
        state: input.state,
        financialStatus,
        cancelledAt,
        source: "merchant_review",
        sourceUpdatedAt: null,
        reviewReason: null,
      },
    });
    await tx.auditLog.createMany({
      data: snapshots.map((snapshot) => ({
        shopId: input.shopId,
        entity: "OrderLifecycle",
        entityId: snapshot.orderRecordId,
        action: "LIFECYCLE_MERCHANT_CONFIRMED",
        actor: "merchant",
        payload: { state: input.state, snapshotId: snapshot.id },
      })),
    });
  });

  return { reviewed: snapshots.length, skipped: snapshotIds.length - snapshots.length };
}

export function resolveEligibleQuantity(input: {
  originalQuantity: Prisma.Decimal | number | string;
  refundedQuantity?: Prisma.Decimal | number | string | null;
  lifecycleState: OrderLifecycleState;
}): {
  eligibleQuantity: Prisma.Decimal;
  eligibleFraction: Prisma.Decimal;
  excluded: boolean;
  reviewRequired: boolean;
} {
  const original = new Prisma.Decimal(input.originalQuantity);
  if (original.lte(ZERO)) {
    return { eligibleQuantity: ZERO, eligibleFraction: ZERO, excluded: true, reviewRequired: false };
  }

  if (input.lifecycleState === "unknown" || input.lifecycleState === "review_required") {
    return { eligibleQuantity: ZERO, eligibleFraction: ZERO, excluded: true, reviewRequired: true };
  }

  if (input.lifecycleState === "canceled" || input.lifecycleState === "fully_refunded") {
    return { eligibleQuantity: ZERO, eligibleFraction: ZERO, excluded: true, reviewRequired: false };
  }

  const refunded = input.refundedQuantity ? new Prisma.Decimal(input.refundedQuantity) : ZERO;
  const eligibleQuantity = Prisma.Decimal.max(ZERO, Prisma.Decimal.min(original, original.sub(refunded)));
  const eligibleFraction = Prisma.Decimal.max(ZERO, Prisma.Decimal.min(ONE, eligibleQuantity.div(original)));
  return {
    eligibleQuantity,
    eligibleFraction,
    excluded: eligibleQuantity.equals(ZERO),
    reviewRequired: false,
  };
}

export async function listRefundedQuantities(
  shopId: string,
  orderRecordId: string,
  db: DbClient = prisma,
): Promise<Map<string, Prisma.Decimal>> {
  const rows = await db.orderRefundLine.groupBy({
    by: ["shopifyLineItemId"],
    where: {
      shopId,
      refundEvent: { orderRecordId },
    },
    _sum: { quantity: true },
  });

  return new Map(
    rows.map((row) => [row.shopifyLineItemId, row._sum.quantity ?? ZERO]),
  );
}

export async function reconcileLifecycleAdjustmentsForSnapshot(input: {
  shopId: string;
  orderRecordId: string;
  snapshotId: string;
  db: DbClient;
}): Promise<{ created: number; unresolved: string[] }> {
  const lifecycle = await input.db.orderLifecycle.findUnique({
    where: { orderRecordId: input.orderRecordId, shopId: input.shopId },
    select: { state: true },
  });
  let state = (lifecycle?.state ?? "unknown") as OrderLifecycleState;
  const refunded = await listRefundedQuantities(input.shopId, input.orderRecordId, input.db);
  const lines = await input.db.orderSnapshotLine.findMany({
    where: { shopId: input.shopId, snapshotId: input.snapshotId },
    select: {
      id: true,
      shopifyLineItemId: true,
      quantity: true,
      laborCost: true,
      materialCost: true,
      packagingCost: true,
      equipmentCost: true,
      netContribution: true,
    },
  });

  if (state !== "canceled" && refunded.size > 0 && lines.length > 0) {
    const fullyRefunded = lines.every((line) =>
      (refunded.get(line.shopifyLineItemId) ?? ZERO).gte(line.quantity),
    );
    state = fullyRefunded ? "fully_refunded" : "partially_refunded";
    await input.db.orderLifecycle.updateMany({
      where: { orderRecordId: input.orderRecordId, shopId: input.shopId },
      data: { state, reviewReason: null },
    });
  }

  const lifecycleEvent = await input.db.orderAdjustmentEvent.upsert({
    where: {
      shopId_sourceKey: {
        shopId: input.shopId,
        sourceKey: `lifecycle-target:${input.orderRecordId}`,
      },
    },
    create: {
      shopId: input.shopId,
      orderRecordId: input.orderRecordId,
      sourceType: "lifecycle_target",
      sourceKey: `lifecycle-target:${input.orderRecordId}`,
      replacementPolicy: "regenerate",
      actor: "system",
      reason: "Order lifecycle eligibility reconciliation",
    },
    update: {},
    select: { id: true },
  });

  let created = 0;

  const reapplyEvents = await input.db.orderAdjustmentEvent.findMany({
    where: {
      shopId: input.shopId,
      orderRecordId: input.orderRecordId,
      replacementPolicy: "reapply",
    },
  });
  const lineByShopifyId = new Map(lines.map((line) => [line.shopifyLineItemId, line]));
  const unresolved: string[] = [];
  const blockedEvents = await input.db.orderAdjustmentEvent.findMany({
    where: {
      shopId: input.shopId,
      orderRecordId: input.orderRecordId,
      replacementPolicy: { in: ["review_required", "order_update_delta"] },
    },
    select: { sourceKey: true },
  });
  unresolved.push(...blockedEvents.map((event) => event.sourceKey));
  for (const event of reapplyEvents) {
    if (!event.shopifyLineItemId) {
      unresolved.push(event.sourceKey);
      continue;
    }
    const line = lineByShopifyId.get(event.shopifyLineItemId);
    if (!line) {
      unresolved.push(event.sourceKey);
      continue;
    }
    await input.db.adjustment.upsert({
      where: {
        shopId_snapshotLineId_adjustmentEventId: {
          shopId: input.shopId,
          snapshotLineId: line.id,
          adjustmentEventId: event.id,
        },
      },
      create: {
        shopId: input.shopId,
        snapshotLineId: line.id,
        adjustmentEventId: event.id,
        type: event.sourceType,
        reason: event.reason,
        actor: event.actor,
        laborAdj: event.laborAdj,
        materialAdj: event.materialAdj,
        packagingAdj: event.packagingAdj,
        equipmentAdj: event.equipmentAdj,
        netContribAdj: event.netContribAdj,
      },
      update: {},
    });
    created += 1;
  }

  const appliedAdjustments = await input.db.adjustment.findMany({
    where: {
      shopId: input.shopId,
      snapshotLine: { snapshotId: input.snapshotId },
      OR: [
        { adjustmentEventId: null },
        { adjustmentEventId: { not: lifecycleEvent.id } },
      ],
    },
    select: {
      snapshotLineId: true,
      laborAdj: true,
      materialAdj: true,
      packagingAdj: true,
      equipmentAdj: true,
      netContribAdj: true,
      adjustmentEvent: { select: { sourceType: true } },
    },
  });
  const adjustmentsByLine = new Map<string, typeof appliedAdjustments>();
  for (const adjustment of appliedAdjustments) {
    const existing = adjustmentsByLine.get(adjustment.snapshotLineId) ?? [];
    existing.push(adjustment);
    adjustmentsByLine.set(adjustment.snapshotLineId, existing);
  }

  for (const line of lines) {
    const eligibility = resolveEligibleQuantity({
      originalQuantity: line.quantity,
      refundedQuantity: refunded.get(line.shopifyLineItemId) ?? ZERO,
      lifecycleState: state,
    });
    if (eligibility.reviewRequired) {
      unresolved.push(`lifecycle:${line.shopifyLineItemId}`);
      continue;
    }

    const lineAdjustments = adjustmentsByLine.get(line.id) ?? [];
    const currentLabor = lineAdjustments.reduce((sum, value) => sum.add(value.laborAdj), line.laborCost);
    const currentMaterial = lineAdjustments.reduce((sum, value) => sum.add(value.materialAdj), line.materialCost);
    const currentPackaging = lineAdjustments.reduce((sum, value) => sum.add(value.packagingAdj), line.packagingCost);
    const currentEquipment = lineAdjustments.reduce((sum, value) => sum.add(value.equipmentAdj), line.equipmentCost);
    const currentNetContribution = lineAdjustments.reduce((sum, value) => sum.add(value.netContribAdj), line.netContribution);
    const targetAdjustments = lineAdjustments.filter(
      (value) => value.adjustmentEvent?.sourceType !== "refund",
    );
    const targetLabor = targetAdjustments.reduce((sum, value) => sum.add(value.laborAdj), line.laborCost);
    const targetMaterial = targetAdjustments.reduce((sum, value) => sum.add(value.materialAdj), line.materialCost);
    const targetPackaging = targetAdjustments.reduce((sum, value) => sum.add(value.packagingAdj), line.packagingCost);
    const targetEquipment = targetAdjustments.reduce((sum, value) => sum.add(value.equipmentAdj), line.equipmentCost);
    const targetNetContribution = targetAdjustments.reduce(
      (sum, value) => sum.add(value.netContribAdj),
      line.netContribution,
    );
    const fraction = eligibility.eligibleFraction;
    const data = {
      laborAdj: targetLabor.mul(fraction).sub(currentLabor),
      materialAdj: targetMaterial.mul(fraction).sub(currentMaterial),
      packagingAdj: targetPackaging.mul(fraction).sub(currentPackaging),
      equipmentAdj: targetEquipment.mul(fraction).sub(currentEquipment),
      netContribAdj: targetNetContribution.mul(fraction).sub(currentNetContribution),
    };
    await input.db.adjustment.upsert({
      where: {
        shopId_snapshotLineId_adjustmentEventId: {
          shopId: input.shopId,
          snapshotLineId: line.id,
          adjustmentEventId: lifecycleEvent.id,
        },
      },
      create: {
        shopId: input.shopId,
        snapshotLineId: line.id,
        adjustmentEventId: lifecycleEvent.id,
        type: "lifecycle",
        reason: "Order cancellation/refund eligibility",
        actor: "system",
        ...data,
      },
      update: data,
    });
    created += 1;
  }

  return { created, unresolved };
}
