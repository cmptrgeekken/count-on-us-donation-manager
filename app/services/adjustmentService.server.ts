import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { recomputeTaxOffsetCache } from "./taxOffsetCache.server";
import {
  ensureOrderRecord,
  mergeOrderLifecycle,
  reconcileLifecycleAdjustmentsForSnapshot,
} from "./orderLifecycle.server";

type SnapshotLineWithAdjustments = {
  id: string;
  shopifyLineItemId: string;
  quantity: number;
  subtotal: Prisma.Decimal;
  laborCost: Prisma.Decimal;
  materialCost: Prisma.Decimal;
  packagingCost: Prisma.Decimal;
  equipmentCost: Prisma.Decimal;
  netContribution: Prisma.Decimal;
  adjustments: Array<{
    laborAdj: Prisma.Decimal;
    materialAdj: Prisma.Decimal;
    packagingAdj: Prisma.Decimal;
    equipmentAdj: Prisma.Decimal;
    netContribAdj: Prisma.Decimal;
  }>;
};

type RefundLineItemPayload = {
  line_item_id?: string | number | null;
  quantity?: string | number | null;
  subtotal?: string | number | null;
  line_item?: {
    admin_graphql_api_id?: string | null;
    id?: string | number | null;
  } | null;
};

type ShopifyRefundPayload = {
  admin_graphql_api_id?: string | null;
  id?: string | number | null;
  order_id?: string | number | null;
  note?: string | null;
  created_at?: string | null;
  refund_line_items?: RefundLineItemPayload[];
};

type OrderLineItemPayload = {
  admin_graphql_api_id?: string | null;
  id?: string | number | null;
  quantity?: string | number | null;
  price?: string | number | null;
  total_discount?: string | number | null;
  discount_allocations?: Array<{
    amount?: string | number | null;
    amount_set?: {
      shop_money?: {
        amount?: string | number | null;
      } | null;
    } | null;
  }>;
  discounted_total?: string | number | null;
  discounted_total_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
};

type ShopifyOrderPayload = {
  admin_graphql_api_id?: string | null;
  subtotal_price?: string | number | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  canceled_at?: string | null;
  updated_at?: string | null;
  line_items?: OrderLineItemPayload[];
};

type AdjustmentBreakdown = {
  laborAdj: Prisma.Decimal;
  materialAdj: Prisma.Decimal;
  packagingAdj: Prisma.Decimal;
  equipmentAdj: Prisma.Decimal;
  netContribAdj: Prisma.Decimal;
};

const ZERO = new Prisma.Decimal(0);

function toDecimal(value: string | number | Prisma.Decimal | null | undefined) {
  if (value === null || value === undefined || value === "") return ZERO;
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function getLineDiscount(lineItem: OrderLineItemPayload) {
  if (lineItem.total_discount !== null && lineItem.total_discount !== undefined && lineItem.total_discount !== "") {
    return toDecimal(lineItem.total_discount);
  }

  return (lineItem.discount_allocations ?? []).reduce((sum, allocation) => {
    const amount = allocation.amount ?? allocation.amount_set?.shop_money?.amount;
    return sum.add(toDecimal(amount));
  }, ZERO);
}

function getDiscountedLineSubtotal(lineItem: OrderLineItemPayload) {
  const explicitDiscountedTotal = lineItem.discounted_total ?? lineItem.discounted_total_set?.shop_money?.amount;
  if (explicitDiscountedTotal !== null && explicitDiscountedTotal !== undefined && explicitDiscountedTotal !== "") {
    return toDecimal(explicitDiscountedTotal);
  }

  const quantity = Math.max(0, Number(lineItem.quantity ?? 0));
  const undiscountedSubtotal = toDecimal(lineItem.price).mul(quantity);
  const discountedSubtotal = undiscountedSubtotal.sub(getLineDiscount(lineItem));
  return discountedSubtotal.isNegative() ? ZERO : discountedSubtotal;
}

function normaliseStringId(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  return value.toString();
}

function buildLineItemIdentifiers(lineItem: {
  admin_graphql_api_id?: string | null;
  id?: string | number | null;
  line_item_id?: string | number | null;
}) {
  const identifiers = new Set<string>();
  const adminId = normaliseStringId(lineItem.admin_graphql_api_id);
  const id = normaliseStringId(lineItem.id);
  const lineItemId = normaliseStringId(lineItem.line_item_id);

  for (const value of [adminId, id, lineItemId]) {
    if (!value) continue;
    identifiers.add(value);
    if (/^\d+$/.test(value)) {
      identifiers.add(`gid://shopify/LineItem/${value}`);
    }
  }

  return identifiers;
}

function decimalSum(values: Prisma.Decimal[]) {
  return values.reduce((sum, value) => sum.add(value), ZERO);
}

function getEffectiveSnapshotLineState(line: SnapshotLineWithAdjustments) {
  const labor = line.laborCost.add(decimalSum(line.adjustments.map((adjustment) => adjustment.laborAdj)));
  const material = line.materialCost.add(decimalSum(line.adjustments.map((adjustment) => adjustment.materialAdj)));
  const packaging = line.packagingCost.add(decimalSum(line.adjustments.map((adjustment) => adjustment.packagingAdj)));
  const equipment = line.equipmentCost.add(decimalSum(line.adjustments.map((adjustment) => adjustment.equipmentAdj)));
  const netContribution = line.netContribution.add(
    decimalSum(line.adjustments.map((adjustment) => adjustment.netContribAdj)),
  );
  const subtotal = line.subtotal.add(
    decimalSum(
      line.adjustments.map((adjustment) =>
        adjustment.laborAdj
          .add(adjustment.materialAdj)
          .add(adjustment.packagingAdj)
          .add(adjustment.equipmentAdj)
          .add(adjustment.netContribAdj),
      ),
    ),
  );

  return { labor, material, packaging, equipment, netContribution, subtotal };
}

export function buildProportionalAdjustment(
  base: {
    laborCost: Prisma.Decimal;
    materialCost: Prisma.Decimal;
    packagingCost: Prisma.Decimal;
    equipmentCost: Prisma.Decimal;
    netContribution: Prisma.Decimal;
  },
  ratio: Prisma.Decimal,
): AdjustmentBreakdown {
  return {
    laborAdj: base.laborCost.mul(ratio),
    materialAdj: base.materialCost.mul(ratio),
    packagingAdj: base.packagingCost.mul(ratio),
    equipmentAdj: base.equipmentCost.mul(ratio),
    netContribAdj: base.netContribution.mul(ratio),
  };
}

export async function createManualAdjustment(
  shopId: string,
  input: {
    snapshotLineId: string;
    reason?: string | null;
    laborAdj?: string | number | Prisma.Decimal | null;
    materialAdj?: string | number | Prisma.Decimal | null;
    packagingAdj?: string | number | Prisma.Decimal | null;
    equipmentAdj?: string | number | Prisma.Decimal | null;
  },
  db: any = prisma,
): Promise<{ adjustmentId: string }> {
  const laborAdj = toDecimal(input.laborAdj);
  const materialAdj = toDecimal(input.materialAdj);
  const packagingAdj = toDecimal(input.packagingAdj);
  const equipmentAdj = toDecimal(input.equipmentAdj);
  const netContribAdj = laborAdj.add(materialAdj).add(packagingAdj).add(equipmentAdj).neg();

  const adjustment = await db.$transaction(async (tx: any) => {
    const snapshotLine = await tx.orderSnapshotLine.findFirst({
      where: {
        id: input.snapshotLineId,
        shopId,
        snapshot: { currentForOrderRecord: { isNot: null } },
      },
      select: {
        id: true,
        shopifyLineItemId: true,
        snapshot: { select: { orderRecordId: true } },
      },
    });

    if (!snapshotLine) {
      throw new Error("Snapshot line not found.");
    }

    const event = tx.orderAdjustmentEvent?.create
      ? await tx.orderAdjustmentEvent.create({
          data: {
            shopId,
            orderRecordId: snapshotLine.snapshot.orderRecordId,
            shopifyLineItemId: snapshotLine.shopifyLineItemId,
            sourceType: "manual",
            sourceKey: `manual:${randomUUID()}`,
            replacementPolicy: "reapply",
            actor: "merchant",
            reason: input.reason?.trim() || "Manual adjustment",
            laborAdj,
            materialAdj,
            packagingAdj,
            equipmentAdj,
            netContribAdj,
          },
          select: { id: true },
        })
      : null;
    const created = await tx.adjustment.create({
      data: {
        shopId,
        snapshotLineId: input.snapshotLineId,
        adjustmentEventId: event?.id ?? null,
        type: "manual",
        reason: input.reason?.trim() || "Manual adjustment",
        actor: "merchant",
        laborAdj,
        materialAdj,
        packagingAdj,
        equipmentAdj,
        netContribAdj,
      },
    });

    await recomputeTaxOffsetCache(shopId, tx);

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "Adjustment",
        entityId: created.id,
        action: "MANUAL_ADJUSTMENT_CREATED",
        actor: "merchant",
        payload: {
          snapshotLineId: input.snapshotLineId,
        },
      },
    });

    return created;
  });

  return { adjustmentId: adjustment.id };
}

export function buildOrderUpdateSignature(order: ShopifyOrderPayload) {
  const orderId = normaliseStringId(order.admin_graphql_api_id) ?? "unknown-order";
  const lineSignature = (order.line_items ?? [])
    .map((lineItem) => {
      const identifier =
        normaliseStringId(lineItem.admin_graphql_api_id) ??
        normaliseStringId(lineItem.id) ??
        "unknown-line";
      return `${identifier}:${normaliseStringId(lineItem.quantity) ?? "0"}:${normaliseStringId(lineItem.price) ?? "0"}`;
    })
    .sort()
    .join("|");

  const payload = `${orderId}::${normaliseStringId(order.subtotal_price) ?? "0"}::${lineSignature}`;
  return createHash("sha256").update(payload).digest("hex");
}

async function findSnapshotWithLines(db: any, shopId: string, shopifyOrderId: string) {
  if (db.orderRecord?.findUnique) {
    const record = await db.orderRecord.findUnique({
      where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
      include: {
        currentSnapshot: {
          include: {
            lines: {
              include: {
                adjustments: {
                  select: {
                    laborAdj: true,
                    materialAdj: true,
                    packagingAdj: true,
                    equipmentAdj: true,
                    netContribAdj: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    return record?.currentSnapshot
      ? { ...record.currentSnapshot, orderRecordId: record.id }
      : null;
  }
  return db.orderSnapshot.findFirst({
    where: { shopId, shopifyOrderId },
    include: {
      lines: {
        include: {
          adjustments: {
            select: {
              laborAdj: true,
              materialAdj: true,
              packagingAdj: true,
              equipmentAdj: true,
              netContribAdj: true,
            },
          },
        },
      },
    },
  });
}

async function acquireIdempotencyLock(tx: any, scope: string, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}), hashtext(${key}))`;
}

function findIncomingSubtotalForSnapshotLine(
  snapshotLine: Pick<SnapshotLineWithAdjustments, "shopifyLineItemId">,
  currentLines: Map<string, { subtotal: Prisma.Decimal }>,
) {
  const identifiers = buildLineItemIdentifiers({
    id: snapshotLine.shopifyLineItemId,
    admin_graphql_api_id: snapshotLine.shopifyLineItemId,
  });

  for (const identifier of identifiers) {
    const match = currentLines.get(identifier);
    if (match) return match.subtotal;
  }

  return null;
}

export async function processRefund(
  shopId: string,
  refundPayload: ShopifyRefundPayload,
  db: any = prisma,
): Promise<{ created: number; skipped: number }> {
  const refundId = normaliseStringId(refundPayload.admin_graphql_api_id) ?? normaliseStringId(refundPayload.id);
  if (!refundId) {
    throw new Error("Refund payload is missing an id.");
  }

  const orderId = normaliseStringId(refundPayload.order_id);
  if (!orderId) {
    throw new Error("Refund payload is missing order_id.");
  }

  const shopifyOrderId = /^gid:\/\//.test(orderId) ? orderId : `gid://shopify/Order/${orderId}`;
  return db.$transaction(async (tx: any) => {
    await acquireIdempotencyLock(tx, "refund", `${shopId}:${refundId}`);

    const alreadyProcessed = await tx.auditLog.findFirst({
      where: {
        shopId,
        entity: "Adjustment",
        entityId: refundId,
        action: "REFUND_PROCESSED",
      },
      select: { id: true },
    });

    if (alreadyProcessed) {
      return { created: 0, skipped: 0 };
    }

    const logicalOrder = tx.orderRecord?.upsert
      ? await ensureOrderRecord(shopId, shopifyOrderId, tx)
      : null;

    const snapshot = await findSnapshotWithLines(tx, shopId, shopifyOrderId);
    if (!snapshot) {
      if (logicalOrder && tx.orderRefundEvent?.create) {
        const sourceLines = (refundPayload.refund_line_items ?? []).flatMap((refundLine) => {
          const rawLineId = normaliseStringId(
            refundLine.line_item?.admin_graphql_api_id ??
              refundLine.line_item?.id ??
              refundLine.line_item_id,
          );
          const quantity = Math.max(0, Number(refundLine.quantity ?? 0));
          if (!rawLineId || quantity <= 0) return [];
          return [{
            shopId,
            shopifyLineItemId: /^gid:\/\//.test(rawLineId)
              ? rawLineId
              : `gid://shopify/LineItem/${rawLineId}`,
            quantity: new Prisma.Decimal(quantity),
            refundedSubtotalAmount:
              refundLine.subtotal === null || refundLine.subtotal === undefined
                ? null
                : toDecimal(refundLine.subtotal),
          }];
        });
        await tx.orderRefundEvent.create({
          data: {
            shopId,
            orderRecordId: logicalOrder.id,
            shopifyRefundId: refundId,
            refundedAt: refundPayload.created_at ? new Date(refundPayload.created_at) : null,
            source: "webhook",
            lines: { create: sourceLines },
          },
        });
        await tx.orderLifecycle.upsert({
          where: { orderRecordId: logicalOrder.id, shopId },
          create: {
            shopId,
            orderRecordId: logicalOrder.id,
            state: "partially_refunded",
            source: "webhook",
            reviewReason: "Refund received before the first snapshot; final state will be reconciled on activation.",
          },
          update: {
            state: "partially_refunded",
            source: "webhook",
            reviewReason: "Refund received before the first snapshot; final state will be reconciled on activation.",
          },
        });
      }
      await tx.auditLog.create({
        data: {
          shopId,
          entity: "Adjustment",
          entityId: refundId,
          action: logicalOrder ? "REFUND_PROCESSED" : "REFUND_SKIPPED_NO_SNAPSHOT",
          actor: "webhook",
          payload: { shopifyOrderId, deferredUntilSnapshot: Boolean(logicalOrder) },
        },
      });
      return { created: 0, skipped: logicalOrder ? 0 : 1 };
    }

    const lineMap = new Map<string, SnapshotLineWithAdjustments>();
    for (const line of snapshot.lines as SnapshotLineWithAdjustments[]) {
      for (const identifier of buildLineItemIdentifiers({ id: line.shopifyLineItemId, admin_graphql_api_id: line.shopifyLineItemId })) {
        lineMap.set(identifier, line);
      }
    }

    const refundLines = refundPayload.refund_line_items ?? [];
    const adjustmentsToCreate: Array<{
      snapshotLineId: string;
      shopifyLineItemId: string;
      refundedQuantity: number;
      refundedSubtotalAmount: Prisma.Decimal | null;
    } & AdjustmentBreakdown> = [];
    let skipped = 0;

    for (const refundLine of refundLines) {
      const identifiers = buildLineItemIdentifiers({
        line_item_id: refundLine.line_item_id,
        id: refundLine.line_item?.id,
        admin_graphql_api_id: refundLine.line_item?.admin_graphql_api_id,
      });
      const snapshotLine = [...identifiers].map((identifier) => lineMap.get(identifier)).find(Boolean) ?? null;

      if (!snapshotLine) {
        skipped += 1;
        continue;
      }

      const refundedQuantity = Math.min(snapshotLine.quantity, Math.max(0, Number(refundLine.quantity ?? 0)));
      if (refundedQuantity <= 0 || snapshotLine.quantity <= 0) {
        skipped += 1;
        continue;
      }

      const adjustmentBase = getEffectiveSnapshotLineState(snapshotLine);
      const refundRatio = new Prisma.Decimal(refundedQuantity).div(snapshotLine.quantity).neg();
      const adjustment = buildProportionalAdjustment(
        {
          laborCost: adjustmentBase.labor,
          materialCost: adjustmentBase.material,
          packagingCost: adjustmentBase.packaging,
          equipmentCost: adjustmentBase.equipment,
          netContribution: adjustmentBase.netContribution,
        },
        refundRatio,
      );

      adjustmentsToCreate.push({
        snapshotLineId: snapshotLine.id,
        shopifyLineItemId: snapshotLine.shopifyLineItemId,
        refundedQuantity,
        refundedSubtotalAmount:
          refundLine.subtotal === null || refundLine.subtotal === undefined
            ? null
            : toDecimal(refundLine.subtotal),
        ...adjustment,
      });
    }

    let refundEventId: string | null = null;
    if (tx.orderRefundEvent?.create && snapshot.orderRecordId) {
      const refundEvent = await tx.orderRefundEvent.create({
        data: {
          shopId,
          orderRecordId: snapshot.orderRecordId,
          shopifyRefundId: refundId,
          refundedAt: refundPayload.created_at ? new Date(refundPayload.created_at) : null,
          source: "webhook",
          lines: {
            create: adjustmentsToCreate.map((adjustment) => ({
              shopId,
              shopifyLineItemId: adjustment.shopifyLineItemId,
              quantity: new Prisma.Decimal(adjustment.refundedQuantity),
              refundedSubtotalAmount: adjustment.refundedSubtotalAmount,
            })),
          },
        },
        select: { id: true },
      });
      refundEventId = refundEvent.id;

      const refundedByLine = await tx.orderRefundLine.groupBy({
        by: ["shopifyLineItemId"],
        where: { shopId, refundEvent: { orderRecordId: snapshot.orderRecordId } },
        _sum: { quantity: true },
      });
      const refundedMap = new Map<string, Prisma.Decimal>(
        refundedByLine.map((line: { shopifyLineItemId: string; _sum: { quantity: Prisma.Decimal | null } }) => [
          line.shopifyLineItemId,
          line._sum.quantity ?? ZERO,
        ]),
      );
      const fullyRefunded = (snapshot.lines as SnapshotLineWithAdjustments[]).every((line) =>
        (refundedMap.get(line.shopifyLineItemId) ?? ZERO).gte(line.quantity),
      );
      const existingLifecycle = await tx.orderLifecycle.findUnique({
        where: { orderRecordId: snapshot.orderRecordId, shopId },
        select: { state: true },
      });
      if (existingLifecycle?.state !== "canceled") {
        await tx.orderLifecycle.upsert({
          where: { orderRecordId: snapshot.orderRecordId, shopId },
          create: {
            shopId,
            orderRecordId: snapshot.orderRecordId,
            state: fullyRefunded ? "fully_refunded" : "partially_refunded",
            source: "webhook",
          },
          update: {
            state: fullyRefunded ? "fully_refunded" : "partially_refunded",
            source: "webhook",
            reviewReason: null,
          },
        });
      }
    }

    if (adjustmentsToCreate.length === 0) {
      if (
        snapshot.orderRecordId &&
        tx.orderAdjustmentEvent?.upsert &&
        tx.orderLifecycle?.findUnique &&
        tx.orderRefundLine?.groupBy
      ) {
        await reconcileLifecycleAdjustmentsForSnapshot({
          shopId,
          orderRecordId: snapshot.orderRecordId,
          snapshotId: snapshot.id,
          db: tx,
        });
        await recomputeTaxOffsetCache(shopId, tx);
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "Adjustment",
          entityId: refundId,
          action: "REFUND_PROCESSED",
          actor: "webhook",
          payload: {
            shopifyOrderId,
            created: 0,
            skipped,
          },
        },
      });
      return { created: 0, skipped };
    }

    for (const adjustment of adjustmentsToCreate) {
      const adjustmentEvent = snapshot.orderRecordId && tx.orderAdjustmentEvent?.upsert
        ? await tx.orderAdjustmentEvent.upsert({
            where: {
              shopId_sourceKey: {
                shopId,
                sourceKey: `refund:${refundId}:${adjustment.shopifyLineItemId}`,
              },
            },
            create: {
              shopId,
              orderRecordId: snapshot.orderRecordId,
              shopifyLineItemId: adjustment.shopifyLineItemId,
              sourceType: "refund",
              sourceKey: `refund:${refundId}:${adjustment.shopifyLineItemId}`,
              replacementPolicy: "regenerate",
              actor: "webhook",
              reason: "Refund lifecycle evidence",
            },
            update: {},
            select: { id: true },
          })
        : null;
      await tx.adjustment.create({
        data: {
          shopId,
          snapshotLineId: adjustment.snapshotLineId,
          adjustmentEventId: adjustmentEvent?.id ?? null,
          type: "refund",
          reason: refundPayload.note?.slice(0, 500) ?? "refunds/create webhook",
          actor: "webhook",
          laborAdj: adjustment.laborAdj,
          materialAdj: adjustment.materialAdj,
          packagingAdj: adjustment.packagingAdj,
          equipmentAdj: adjustment.equipmentAdj,
          netContribAdj: adjustment.netContribAdj,
        },
      });
    }

    if (
      snapshot.orderRecordId &&
      tx.orderAdjustmentEvent?.upsert &&
      tx.orderLifecycle?.findUnique &&
      tx.orderRefundLine?.groupBy
    ) {
      await reconcileLifecycleAdjustmentsForSnapshot({
        shopId,
        orderRecordId: snapshot.orderRecordId,
        snapshotId: snapshot.id,
        db: tx,
      });
    }

    await recomputeTaxOffsetCache(shopId, tx);

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "Adjustment",
        entityId: refundId,
        action: "REFUND_PROCESSED",
        actor: "webhook",
        payload: {
          shopifyOrderId,
          refundEventId,
          created: adjustmentsToCreate.length,
          skipped,
        },
      },
    });
    return { created: adjustmentsToCreate.length, skipped };
  });
}

export async function processOrderUpdate(
  shopId: string,
  orderPayload: ShopifyOrderPayload,
  db: any = prisma,
): Promise<{ created: number; skipped: number }> {
  const shopifyOrderId = normaliseStringId(orderPayload.admin_graphql_api_id);
  if (!shopifyOrderId) {
    throw new Error("Order update payload is missing admin_graphql_api_id.");
  }

  const signature = buildOrderUpdateSignature(orderPayload);
  return db.$transaction(async (tx: any) => {
    await acquireIdempotencyLock(tx, "order-update", `${shopId}:${signature}`);

    const alreadyProcessed = await tx.auditLog.findFirst({
      where: {
        shopId,
        entity: "OrderSnapshot",
        entityId: signature,
        action: "ORDER_UPDATE_PROCESSED",
      },
      select: { id: true },
    });

    if (alreadyProcessed) {
      return { created: 0, skipped: 0 };
    }

    const logicalOrder = tx.orderRecord?.upsert
      ? await ensureOrderRecord(shopId, shopifyOrderId, tx)
      : null;
    if (logicalOrder && tx.orderLifecycle?.upsert) {
      await mergeOrderLifecycle({
        shopId,
        orderRecordId: logicalOrder.id,
        payload: orderPayload,
        source: "webhook",
        db: tx,
      });
    }

    const snapshot = await findSnapshotWithLines(tx, shopId, shopifyOrderId);
    if (!snapshot) {
      await tx.auditLog.create({
        data: {
          shopId,
          entity: "OrderSnapshot",
          entityId: signature,
          action: "ORDER_UPDATE_SKIPPED_NO_SNAPSHOT",
          actor: "webhook",
          payload: { shopifyOrderId },
        },
      });
      return { created: 0, skipped: 1 };
    }

    const currentLines = new Map<string, { subtotal: Prisma.Decimal }>();
    for (const lineItem of orderPayload.line_items ?? []) {
      const subtotal = getDiscountedLineSubtotal(lineItem);
      for (const identifier of buildLineItemIdentifiers(lineItem)) {
        currentLines.set(identifier, { subtotal });
      }
    }

    const adjustmentsToCreate: Array<{ snapshotLineId: string } & AdjustmentBreakdown> = [];
    let unmatchedSnapshotLineCount = 0;

    for (const snapshotLine of snapshot.lines as SnapshotLineWithAdjustments[]) {
      const effective = getEffectiveSnapshotLineState(snapshotLine);
      if (effective.subtotal.eq(ZERO)) {
        continue;
      }

      const incomingSubtotal = findIncomingSubtotalForSnapshotLine(snapshotLine, currentLines);
      if (incomingSubtotal === null) {
        unmatchedSnapshotLineCount += 1;
        continue;
      }
      if (incomingSubtotal.eq(effective.subtotal)) {
        continue;
      }

      const ratio = incomingSubtotal.sub(effective.subtotal).div(effective.subtotal);
      const adjustment = buildProportionalAdjustment(
        {
          laborCost: effective.labor,
          materialCost: effective.material,
          packagingCost: effective.packaging,
          equipmentCost: effective.equipment,
          netContribution: effective.netContribution,
        },
        ratio,
      );

      adjustmentsToCreate.push({
        snapshotLineId: snapshotLine.id,
        ...adjustment,
      });
    }

    const unmatchedPayloadLineCount = (orderPayload.line_items ?? []).filter((lineItem) => {
      const identifiers = buildLineItemIdentifiers(lineItem);
      return [...identifiers].every((identifier) => {
        const matchingSnapshotLine = (snapshot.lines as SnapshotLineWithAdjustments[]).find((line) => {
          const lineIdentifiers = buildLineItemIdentifiers({
            id: line.shopifyLineItemId,
            admin_graphql_api_id: line.shopifyLineItemId,
          });
          return lineIdentifiers.has(identifier);
        });
        return !matchingSnapshotLine;
      });
    }).length;

    if (adjustmentsToCreate.length === 0) {
      if (
        snapshot.orderRecordId &&
        tx.orderAdjustmentEvent?.upsert &&
        tx.orderLifecycle?.findUnique &&
        tx.orderRefundLine?.groupBy
      ) {
        await reconcileLifecycleAdjustmentsForSnapshot({
          shopId,
          orderRecordId: snapshot.orderRecordId,
          snapshotId: snapshot.id,
          db: tx,
        });
        await recomputeTaxOffsetCache(shopId, tx);
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "OrderSnapshot",
          entityId: signature,
          action: "ORDER_UPDATE_PROCESSED",
          actor: "webhook",
          payload: {
            shopifyOrderId,
            created: 0,
          },
        },
      });

      if (unmatchedSnapshotLineCount > 0) {
        await tx.auditLog.create({
          data: {
            shopId,
            entity: "OrderSnapshot",
            entityId: shopifyOrderId,
            action: "ORDER_UPDATE_CONTAINS_UNMATCHED_SNAPSHOT_LINES",
            actor: "webhook",
            payload: {
              unmatchedSnapshotLineCount,
              note: "Snapshotted lines without payload matches were not auto-reversed.",
            },
          },
        });
      }

      if (unmatchedPayloadLineCount > 0) {
        await tx.auditLog.create({
          data: {
            shopId,
            entity: "OrderSnapshot",
            entityId: shopifyOrderId,
            action: "ORDER_UPDATE_CONTAINS_UNSNAPSHOTTED_LINES",
            actor: "webhook",
            payload: {
              unmatchedPayloadLineCount,
              note: "New order line items cannot yet be represented as adjustments.",
            },
          },
        });
      }

      return { created: 0, skipped: 0 };
    }

    for (const adjustment of adjustmentsToCreate) {
      const sourceLine = (snapshot.lines as SnapshotLineWithAdjustments[]).find(
        (line) => line.id === adjustment.snapshotLineId,
      );
      const adjustmentEvent = sourceLine && snapshot.orderRecordId && tx.orderAdjustmentEvent?.upsert
        ? await tx.orderAdjustmentEvent.upsert({
            where: {
              shopId_sourceKey: {
                shopId,
                sourceKey: `order-update:${signature}:${sourceLine.shopifyLineItemId}`,
              },
            },
            create: {
              shopId,
              orderRecordId: snapshot.orderRecordId,
              shopifyLineItemId: sourceLine.shopifyLineItemId,
              sourceType: "order_update",
              sourceKey: `order-update:${signature}:${sourceLine.shopifyLineItemId}`,
              replacementPolicy: "order_update_delta",
              actor: "webhook",
              reason: "orders/updated webhook",
              laborAdj: adjustment.laborAdj,
              materialAdj: adjustment.materialAdj,
              packagingAdj: adjustment.packagingAdj,
              equipmentAdj: adjustment.equipmentAdj,
              netContribAdj: adjustment.netContribAdj,
            },
            update: {},
            select: { id: true },
          })
        : null;
      await tx.adjustment.create({
        data: {
          shopId,
          snapshotLineId: adjustment.snapshotLineId,
          adjustmentEventId: adjustmentEvent?.id ?? null,
          type: "manual",
          reason: "orders/updated webhook",
          actor: "webhook",
          laborAdj: adjustment.laborAdj,
          materialAdj: adjustment.materialAdj,
          packagingAdj: adjustment.packagingAdj,
          equipmentAdj: adjustment.equipmentAdj,
          netContribAdj: adjustment.netContribAdj,
        },
      });
    }

    if (
      snapshot.orderRecordId &&
      tx.orderAdjustmentEvent?.upsert &&
      tx.orderLifecycle?.findUnique &&
      tx.orderRefundLine?.groupBy
    ) {
      await reconcileLifecycleAdjustmentsForSnapshot({
        shopId,
        orderRecordId: snapshot.orderRecordId,
        snapshotId: snapshot.id,
        db: tx,
      });
    }

    await recomputeTaxOffsetCache(shopId, tx);

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "OrderSnapshot",
        entityId: signature,
        action: "ORDER_UPDATE_PROCESSED",
        actor: "webhook",
        payload: {
          shopifyOrderId,
          created: adjustmentsToCreate.length,
        },
      },
    });

    if (unmatchedPayloadLineCount > 0) {
      await tx.auditLog.create({
        data: {
          shopId,
          entity: "OrderSnapshot",
          entityId: shopifyOrderId,
          action: "ORDER_UPDATE_CONTAINS_UNSNAPSHOTTED_LINES",
          actor: "webhook",
          payload: {
            unmatchedPayloadLineCount,
            note: "New order line items cannot yet be represented as adjustments.",
          },
        },
      });
    }

    if (unmatchedSnapshotLineCount > 0) {
      await tx.auditLog.create({
        data: {
          shopId,
          entity: "OrderSnapshot",
          entityId: shopifyOrderId,
          action: "ORDER_UPDATE_CONTAINS_UNMATCHED_SNAPSHOT_LINES",
          actor: "webhook",
          payload: {
            unmatchedSnapshotLineCount,
            note: "Snapshotted lines without payload matches were not auto-reversed.",
          },
        },
      });
    }
    return { created: adjustmentsToCreate.length, skipped: 0 };
  });
}
