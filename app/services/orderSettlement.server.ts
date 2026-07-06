import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import type { ShopifyOrderPayload } from "./snapshotService.server";

const ZERO = new Prisma.Decimal(0);

type SettlementDb = {
  orderSettlement: {
    upsert: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    findFirst: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown[]>;
    aggregate: (args: unknown) => Promise<{ _sum: { feeAmount?: Prisma.Decimal | null } }>;
    count: (args: unknown) => Promise<number>;
  };
  auditLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

type SettlementReviewInput = {
  shopId: string;
  snapshotId: string;
  periodId?: string | null;
  order: ShopifyOrderPayload;
  db?: SettlementDb;
};

type SettlementMutationInput = {
  shopId: string;
  settlementId: string;
  actor?: string;
  db?: SettlementDb;
};

function toDecimal(value: string | number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  return new Prisma.Decimal(value);
}

function orderMoney(value: string | number | null | undefined, fallback?: string | number | null): Prisma.Decimal {
  return toDecimal(value) ?? toDecimal(fallback) ?? ZERO;
}

function grossOrderAmount(order: ShopifyOrderPayload): Prisma.Decimal {
  const setAmount = order.current_total_price_set?.shop_money?.amount ?? order.total_price_set?.shop_money?.amount;
  const explicitTotal = order.current_total_price ?? order.total_price ?? setAmount;
  const total = orderMoney(explicitTotal, order.current_subtotal_price ?? order.subtotal_price);
  if (total.greaterThan(ZERO)) return total;

  return (order.line_items ?? []).reduce((sum, line) => {
    const quantity = Number(line.quantity ?? 1);
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    return sum.add(orderMoney(line.discounted_total ?? line.price).mul(safeQuantity));
  }, ZERO);
}

function shopifyPaidAmount(order: ShopifyOrderPayload): Prisma.Decimal | null {
  const received = toDecimal(order.total_received);
  if (received) return received;

  const total = toDecimal(order.current_total_price ?? order.total_price);
  const outstanding = toDecimal(order.total_outstanding);
  if (total && outstanding) {
    const paid = total.sub(outstanding);
    return paid.lessThan(ZERO) ? ZERO : paid;
  }

  return null;
}

function normalizeSource(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function detectedSettlementSource(order: ShopifyOrderPayload): string | null {
  const sourceValues = [
    order.source_name,
    order.gateway,
    order.landing_site,
    order.referring_site,
    ...(order.payment_gateway_names ?? []),
  ].map(normalizeSource);
  const haystack = sourceValues.join(" ");

  if (haystack.includes("faire")) return "faire";
  if (haystack.includes("marketplace")) return "other_marketplace";
  if (haystack.includes("wholesale")) return "other_marketplace";
  if (haystack.includes("manual") && haystack.includes("outside")) return "manual";
  return null;
}

function appearsOperationallyComplete(order: ShopifyOrderPayload): boolean {
  const financialStatus = normalizeSource(order.financial_status);
  const fulfillmentStatus = normalizeSource(order.fulfillment_status);
  return ["paid", "partially_paid", "authorized"].includes(financialStatus) ||
    ["fulfilled", "partial"].includes(fulfillmentStatus);
}

function settlementReviewCandidate(order: ShopifyOrderPayload): {
  source: string;
  grossOrderAmount: Prisma.Decimal;
  shopifyPaidAmount: Prisma.Decimal | null;
  currency: string;
  reason: string;
} | null {
  const gross = grossOrderAmount(order);
  if (gross.lessThanOrEqualTo(ZERO)) return null;

  const paid = shopifyPaidAmount(order);
  const paidMissingOrZero = paid === null || paid.equals(ZERO);
  if (!paidMissingOrZero) return null;

  const source = detectedSettlementSource(order);
  const complete = appearsOperationallyComplete(order);
  if (!source && !(paid?.equals(ZERO) && complete)) return null;

  return {
    source: source ?? "manual",
    grossOrderAmount: gross.toDecimalPlaces(2),
    shopifyPaidAmount: paid,
    currency:
      order.current_total_price_set?.shop_money?.currency_code ??
      order.total_price_set?.shop_money?.currency_code ??
      order.presentment_currency ??
      order.currency ??
      "USD",
    reason: source
      ? "Marketplace or external payment source with no Shopify paid amount."
      : "Order appears complete but Shopify paid amount is zero.",
  };
}

export async function detectAndUpsertExternalSettlementReview(input: SettlementReviewInput): Promise<void> {
  const candidate = settlementReviewCandidate(input.order);
  if (!candidate) return;

  const db = input.db ?? prisma;
  const shopifyOrderId = input.order.admin_graphql_api_id;
  if (!shopifyOrderId) return;

  await db.orderSettlement.upsert({
    where: {
      shopId_shopifyOrderId: {
        shopId: input.shopId,
        shopifyOrderId,
      },
    },
    create: {
      shopId: input.shopId,
      snapshotId: input.snapshotId,
      periodId: input.periodId ?? null,
      shopifyOrderId,
      orderNumber: input.order.name ?? input.order.order_number?.toString() ?? null,
      source: candidate.source,
      status: "needs_review",
      grossOrderAmount: candidate.grossOrderAmount,
      shopifyPaidAmount: candidate.shopifyPaidAmount,
      feeAmount: ZERO,
      currency: candidate.currency,
      detectedReason: candidate.reason,
    },
    update: {
      snapshotId: input.snapshotId,
      periodId: input.periodId ?? null,
      orderNumber: input.order.name ?? input.order.order_number?.toString() ?? null,
      grossOrderAmount: candidate.grossOrderAmount,
      shopifyPaidAmount: candidate.shopifyPaidAmount,
      currency: candidate.currency,
      detectedReason: candidate.reason,
    },
  });
}

export async function confirmOrderSettlement(input: SettlementMutationInput & {
  amountReceived: Prisma.Decimal;
  paidAt?: Date | null;
  source?: string | null;
  referenceId?: string | null;
  notes?: string | null;
}): Promise<void> {
  const db = input.db ?? prisma;
  const existing = await db.orderSettlement.findFirst({
    where: { id: input.settlementId, shopId: input.shopId },
    select: { id: true, grossOrderAmount: true },
  }) as { id: string; grossOrderAmount: Prisma.Decimal } | null;
  if (!existing) throw new Error("Settlement review not found.");

  const feeAmount = new Prisma.Decimal(existing.grossOrderAmount).sub(input.amountReceived).toDecimalPlaces(2);
  await db.orderSettlement.update({
    where: { id: existing.id, shopId: input.shopId },
    data: {
      status: "confirmed",
      source: input.source?.trim() || undefined,
      amountReceived: input.amountReceived.toDecimalPlaces(2),
      feeAmount,
      paidAt: input.paidAt ?? null,
      referenceId: input.referenceId?.trim() || null,
      notes: input.notes?.trim() || null,
      confirmedAt: new Date(),
      confirmedBy: input.actor ?? "merchant",
      ignoredAt: null,
      ignoredBy: null,
      ignoreReason: null,
    },
  });

  await db.auditLog.create({
    data: {
      shopId: input.shopId,
      entity: "OrderSettlement",
      entityId: existing.id,
      action: "ORDER_SETTLEMENT_CONFIRMED",
      actor: input.actor ?? "merchant",
      payload: {
        amountReceived: input.amountReceived.toString(),
        feeAmount: feeAmount.toString(),
      },
    },
  });
}

export async function ignoreOrderSettlement(input: SettlementMutationInput & {
  ignoreReason: string;
}): Promise<void> {
  const db = input.db ?? prisma;
  const reason = input.ignoreReason.trim();
  if (reason.length < 8) throw new Error("Ignoring a settlement review requires a reason.");

  const existing = await db.orderSettlement.findFirst({
    where: { id: input.settlementId, shopId: input.shopId },
    select: { id: true },
  }) as { id: string } | null;
  if (!existing) throw new Error("Settlement review not found.");

  await db.orderSettlement.update({
    where: { id: existing.id, shopId: input.shopId },
    data: {
      status: "ignored",
      ignoredAt: new Date(),
      ignoredBy: input.actor ?? "merchant",
      ignoreReason: reason,
    },
  });

  await db.auditLog.create({
    data: {
      shopId: input.shopId,
      entity: "OrderSettlement",
      entityId: existing.id,
      action: "ORDER_SETTLEMENT_IGNORED",
      actor: input.actor ?? "merchant",
      payload: { reason },
    },
  });
}

export async function countUnresolvedSettlementsForPeriod(input: {
  shopId: string;
  periodId: string;
  periodStartDate: Date;
  periodEndDate: Date;
  db?: SettlementDb;
}): Promise<number> {
  const db = input.db ?? prisma;
  return db.orderSettlement.count({
    where: {
      shopId: input.shopId,
      status: "needs_review",
      OR: [
        { periodId: input.periodId },
        {
          periodId: null,
          snapshot: {
            createdAt: {
              gte: input.periodStartDate,
              lt: input.periodEndDate,
            },
          },
        },
      ],
    },
  });
}
