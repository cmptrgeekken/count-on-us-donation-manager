import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import { resolveCosts, type CostResult, type PodCostResolution } from "./costEngine.server";
import { reconcileSnapshotPackaging } from "./packaging.server";
import { detectAndUpsertExternalSettlementReview } from "./orderSettlement.server";
import { decryptProviderCredential } from "./providerCredentials.server";
import { listPrintifyProducts } from "./printify.server";
import { recomputeTaxOffsetCache } from "./taxOffsetCache.server";
import { hashNormalizedCustomerEmail } from "../utils/customer-identity.server";
import {
  mergeOrderLifecycle,
  reconcileLifecycleAdjustmentsForSnapshot,
} from "./orderLifecycle.server";

type SnapshotLineItemPayload = {
  admin_graphql_api_id?: string;
  id?: string | number;
  variant_id?: string | number | null;
  product_id?: string | number | null;
  title?: string | null;
  variant_title?: string | null;
  sku?: string | null;
  importMappingKey?: string | null;
  importLineKind?: "product" | "tip" | "custom" | null;
  quantity?: number | string | null;
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

export type ShopifyOrderPayload = {
  admin_graphql_api_id?: string;
  name?: string | null;
  order_number?: string | number | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  cancelled_at?: string | null;
  canceled_at?: string | null;
  source_name?: string | null;
  landing_site?: string | null;
  referring_site?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  currency?: string | null;
  presentment_currency?: string | null;
  total_price?: string | number | null;
  current_total_price?: string | number | null;
  total_line_items_price?: string | number | null;
  current_total_discounts?: string | number | null;
  total_discounts?: string | number | null;
  subtotal_price?: string | number | null;
  current_subtotal_price?: string | number | null;
  total_received?: string | number | null;
  total_outstanding?: string | number | null;
  payment_gateway_names?: string[] | null;
  gateway?: string | null;
  total_price_set?: {
    shop_money?: {
      amount?: string | number | null;
      currency_code?: string | null;
    } | null;
  } | null;
  current_total_price_set?: {
    shop_money?: {
      amount?: string | number | null;
      currency_code?: string | null;
    } | null;
  } | null;
  subtotal_price_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
  current_subtotal_price_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
  total_line_items_price_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
  current_total_discounts_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
  total_discounts_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
  total_shipping_price_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
  shipping_lines?: Array<{
    price?: string | number | null;
    discounted_price?: string | number | null;
    price_set?: {
      shop_money?: {
        amount?: string | number | null;
      } | null;
    } | null;
    discounted_price_set?: {
      shop_money?: {
        amount?: string | number | null;
      } | null;
    } | null;
  }>;
  total_tax?: string | number | null;
  current_total_tax?: string | number | null;
  total_tax_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
  current_total_tax_set?: {
    shop_money?: {
      amount?: string | number | null;
    } | null;
  } | null;
  contact_email?: string | null;
  email?: string | null;
  customer?: {
    id?: string | number | null;
    admin_graphql_api_id?: string | null;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  billing_address?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  shipping_address?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  line_items?: SnapshotLineItemPayload[];
};

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function toDecimal(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return ZERO;
  return new Prisma.Decimal(value);
}

function getLineDiscount(lineItem: SnapshotLineItemPayload) {
  if (lineItem.total_discount !== null && lineItem.total_discount !== undefined && lineItem.total_discount !== "") {
    return toDecimal(lineItem.total_discount);
  }

  return (lineItem.discount_allocations ?? []).reduce((sum, allocation) => {
    const amount = allocation.amount ?? allocation.amount_set?.shop_money?.amount;
    return sum.add(toDecimal(amount));
  }, ZERO);
}

function getDiscountedLineSubtotal(lineItem: SnapshotLineItemPayload, quantity: number) {
  const explicitDiscountedTotal = lineItem.discounted_total ?? lineItem.discounted_total_set?.shop_money?.amount;
  if (explicitDiscountedTotal !== null && explicitDiscountedTotal !== undefined && explicitDiscountedTotal !== "") {
    return toDecimal(explicitDiscountedTotal);
  }

  const undiscountedSubtotal = toDecimal(lineItem.price).mul(quantity);
  const discountedSubtotal = undiscountedSubtotal.sub(getLineDiscount(lineItem));
  return discountedSubtotal.isNegative() ? ZERO : discountedSubtotal;
}

function getDiscountedUnitPrice(lineItem: SnapshotLineItemPayload, quantity: number) {
  if (quantity <= 0) return ZERO;
  return getDiscountedLineSubtotal(lineItem, quantity).div(quantity);
}

function getLineKind(lineItem: SnapshotLineItemPayload): "product" | "tip" | "custom" {
  return lineItem.importLineKind === "tip" || lineItem.importLineKind === "custom"
    ? lineItem.importLineKind
    : "product";
}

function getOrderDiscount(order: ShopifyOrderPayload) {
  return toDecimal(
    order.current_total_discounts ??
      order.current_total_discounts_set?.shop_money?.amount ??
      order.total_discounts ??
      order.total_discounts_set?.shop_money?.amount,
  );
}

function getOrderTotal(order: ShopifyOrderPayload) {
  return toDecimal(
    order.current_total_price ??
      order.current_total_price_set?.shop_money?.amount ??
      order.total_price ??
      order.total_price_set?.shop_money?.amount,
  );
}

function getOrderSalesTax(order: ShopifyOrderPayload) {
  return toDecimal(
    order.current_total_tax ??
      order.current_total_tax_set?.shop_money?.amount ??
      order.total_tax ??
      order.total_tax_set?.shop_money?.amount,
  );
}

function getOrderShipping(order: ShopifyOrderPayload) {
  const explicitShipping = order.total_shipping_price_set?.shop_money?.amount;
  if (explicitShipping !== null && explicitShipping !== undefined && explicitShipping !== "") {
    return toDecimal(explicitShipping);
  }

  return (order.shipping_lines ?? []).reduce((sum, line) => {
    const amount =
      line.discounted_price ??
      line.discounted_price_set?.shop_money?.amount ??
      line.price ??
      line.price_set?.shop_money?.amount;
    return sum.add(toDecimal(amount));
  }, ZERO);
}

function getOrderDiscountedSubtotal(order: ShopifyOrderPayload) {
  const explicitSubtotal =
    order.current_subtotal_price ??
    order.current_subtotal_price_set?.shop_money?.amount ??
    order.subtotal_price ??
    order.subtotal_price_set?.shop_money?.amount;

  if (explicitSubtotal !== null && explicitSubtotal !== undefined && explicitSubtotal !== "") {
    return toDecimal(explicitSubtotal);
  }

  const preDiscountSubtotal = toDecimal(
    order.total_line_items_price ?? order.total_line_items_price_set?.shop_money?.amount,
  );
  const discount = getOrderDiscount(order);
  if (preDiscountSubtotal.greaterThan(ZERO) || discount.greaterThan(ZERO)) {
    return Prisma.Decimal.max(preDiscountSubtotal.sub(discount), ZERO);
  }

  const total = getOrderTotal(order);
  if (total.greaterThan(ZERO)) {
    return Prisma.Decimal.max(total.sub(getOrderShipping(order)).sub(getOrderSalesTax(order)), ZERO);
  }

  return null;
}

function buildName(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function getCustomerDisplayName(order: ShopifyOrderPayload) {
  const customerName = buildName([order.customer?.first_name, order.customer?.last_name]);
  if (customerName) return customerName;

  const billingName = order.billing_address?.name?.trim() ||
    buildName([order.billing_address?.first_name, order.billing_address?.last_name]);
  if (billingName) return billingName;

  const shippingName = order.shipping_address?.name?.trim() ||
    buildName([order.shipping_address?.first_name, order.shipping_address?.last_name]);
  return shippingName || null;
}

function allocateOrderLevelDiscounts<T extends { subtotal: Prisma.Decimal; quantity: number; salePrice: Prisma.Decimal; discountEligible: boolean }>(
  lines: T[],
  orderDiscountedSubtotal: Prisma.Decimal | null,
): T[] {
  if (!orderDiscountedSubtotal || lines.length === 0) return lines;

  const eligibleSubtotal = lines.reduce(
    (sum, line) => line.discountEligible ? sum.add(line.subtotal) : sum,
    ZERO,
  );
  const excludedSubtotal = lines.reduce(
    (sum, line) => line.discountEligible ? sum : sum.add(line.subtotal),
    ZERO,
  );
  const targetEligibleSubtotal = Prisma.Decimal.max(orderDiscountedSubtotal.sub(excludedSubtotal), ZERO);
  if (eligibleSubtotal.lessThanOrEqualTo(ZERO) || targetEligibleSubtotal.greaterThanOrEqualTo(eligibleSubtotal)) {
    return lines;
  }

  const ratio = targetEligibleSubtotal.div(eligibleSubtotal);
  let allocatedSubtotal = ZERO;
  const lastEligibleIndex = lines.reduce(
    (lastIndex, line, index) => line.discountEligible ? index : lastIndex,
    -1,
  );

  return lines.map((line, index) => {
    if (!line.discountEligible) return line;
    const subtotal =
      index === lastEligibleIndex
        ? Prisma.Decimal.max(targetEligibleSubtotal.sub(allocatedSubtotal), ZERO)
        : line.subtotal.mul(ratio).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    allocatedSubtotal = allocatedSubtotal.add(subtotal);
    return {
      ...line,
      subtotal,
      salePrice: line.quantity > 0 ? subtotal.div(line.quantity) : ZERO,
    };
  });
}

function getOrderCreatedAt(order: ShopifyOrderPayload) {
  const value = order.created_at ?? order.createdAt;
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toCustomerGid(order: ShopifyOrderPayload) {
  const explicitGid = order.customer?.admin_graphql_api_id;
  if (explicitGid) return explicitGid;
  const id = order.customer?.id;
  if (typeof id === "string" && id.startsWith("gid://")) return id;
  if (id !== null && id !== undefined && id !== "") return `gid://shopify/Customer/${id}`;
  return null;
}

function getCustomerEmailHash(order: ShopifyOrderPayload) {
  return hashNormalizedCustomerEmail(order.customer?.email ?? order.contact_email ?? order.email);
}

function toVariantGid(lineItem: SnapshotLineItemPayload) {
  if (lineItem.admin_graphql_api_id?.includes("ProductVariant")) {
    return lineItem.admin_graphql_api_id;
  }
  if (typeof lineItem.variant_id === "string" && lineItem.variant_id.startsWith("gid://")) {
    return lineItem.variant_id;
  }
  if (lineItem.variant_id !== null && lineItem.variant_id !== undefined && lineItem.variant_id !== "") {
    return `gid://shopify/ProductVariant/${lineItem.variant_id}`;
  }
  return null;
}

function toProductGid(lineItem: SnapshotLineItemPayload) {
  if (typeof lineItem.product_id === "string" && lineItem.product_id.startsWith("gid://")) {
    return lineItem.product_id;
  }
  if (lineItem.product_id !== null && lineItem.product_id !== undefined && lineItem.product_id !== "") {
    return `gid://shopify/Product/${lineItem.product_id}`;
  }
  return null;
}

type SnapshotResolution = {
  lineKind: "product" | "tip" | "custom";
  variantId: string | null;
  productGid: string | null;
  lineItemId: string;
  variantGid: string | null;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  salePrice: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  firstPass: CostResult;
  packagingAllocated: Prisma.Decimal;
  finalCosts: CostResult;
  allocations: Array<{
    causeId: string;
    causeName: string;
    is501c3: boolean;
    percentage: Prisma.Decimal;
    amount: Prisma.Decimal;
    source: "product" | "artist" | "product_override";
    artistId?: string | null;
    artistName?: string | null;
  }>;
  artistAllocations: Array<{
    artistId: string;
    artistName: string;
    creditName: string;
    creditPreference: string;
    collaborationShare: Prisma.Decimal;
    payoutEnabled: boolean;
    payoutRate: Prisma.Decimal;
    payoutBasis: Prisma.Decimal;
    payoutAmount: Prisma.Decimal;
    payoutExclusionReason: string | null;
    donationRoutableAmount: Prisma.Decimal;
  }>;
};

function scaleDecimal(value: Prisma.Decimal | null | undefined, quantity: number) {
  if (value === null || value === undefined) return value ?? null;
  return value.mul(quantity);
}

function getCachedPodResolution(mapping: {
  provider: string;
  costLines: Array<{
    costLineType: string;
    description: string | null;
    amount: Prisma.Decimal;
    currency: string;
    syncedAt: Date;
  }>;
}): PodCostResolution {
  const latestSyncedAt = mapping.costLines[0]?.syncedAt;
  if (!latestSyncedAt) {
    return {
      podCost: ZERO,
      podLines: [],
      podCostEstimated: false,
      podCostMissing: true,
    };
  }

  const latestLines = mapping.costLines.filter((line) => line.syncedAt.getTime() === latestSyncedAt.getTime());
  if (latestLines.length === 0) {
    return {
      podCost: ZERO,
      podLines: [],
      podCostEstimated: false,
      podCostMissing: true,
    };
  }

  const podLines = latestLines.map((line) => ({
    provider: mapping.provider,
    costLineType: line.costLineType,
    description: line.description,
    amount: line.amount,
    currency: line.currency,
  }));

  return {
    podCost: podLines.reduce((sum, line) => sum.add(line.amount), ZERO),
    podLines,
    podCostEstimated: true,
    podCostMissing: false,
  };
}

async function fetchSnapshotPodOverrides(
  shopId: string,
  variantIds: string[],
  db: any,
  fetchImpl: typeof fetch,
): Promise<Map<string, PodCostResolution>> {
  if (variantIds.length === 0 || !db.providerVariantMapping?.findMany) {
    return new Map();
  }

  const [mappings, shop] = await Promise.all([
    db.providerVariantMapping.findMany({
      where: {
        shopId,
        variantId: {
          in: variantIds,
        },
      },
      include: {
        connection: {
          select: {
            id: true,
            provider: true,
            status: true,
            providerAccountId: true,
            credentialsEncrypted: true,
          },
        },
        costLines: {
          orderBy: [{ syncedAt: "desc" }, { createdAt: "desc" }],
        },
      },
    }),
    db.shop?.findUnique
      ? db.shop.findUnique({
          where: { shopId },
          select: { currency: true },
        })
      : Promise.resolve(null),
  ]);

  const activeMappings = mappings.filter(
    (mapping: any) =>
      mapping.connection?.provider === "printify" &&
      mapping.connection?.status === "validated" &&
      mapping.status !== "inactive" &&
      Boolean(mapping.providerVariantId),
  );

  if (activeMappings.length === 0) {
    return new Map();
  }

  const resolutionByVariantId = new Map<string, PodCostResolution>();
  const currency = shop?.currency ?? "USD";
  const mappingsByConnection = new Map<string, typeof activeMappings>();

  for (const mapping of activeMappings) {
    const bucket = mappingsByConnection.get(mapping.connection.id) ?? [];
    bucket.push(mapping);
    mappingsByConnection.set(mapping.connection.id, bucket);
  }

  for (const connectionMappings of mappingsByConnection.values()) {
    const connection = connectionMappings[0]!.connection;
    if (!connection.credentialsEncrypted || !connection.providerAccountId) {
      for (const mapping of connectionMappings) {
        resolutionByVariantId.set(mapping.variantId, getCachedPodResolution(mapping));
      }
      continue;
    }

    try {
      const liveVariants = await listPrintifyProducts(
        decryptProviderCredential(connection.credentialsEncrypted),
        connection.providerAccountId,
        fetchImpl,
      );
      const liveVariantById = new Map(
        liveVariants.map((variant) => [variant.variantId, variant]),
      );

      for (const mapping of connectionMappings) {
        const liveVariant = mapping.providerVariantId ? liveVariantById.get(mapping.providerVariantId) : null;
        if (liveVariant && typeof liveVariant.cost === "number") {
          resolutionByVariantId.set(mapping.variantId, {
            podCost: new Prisma.Decimal(liveVariant.cost).div(100),
            podLines: [
              {
                provider: mapping.provider,
                costLineType: "base_fulfillment",
                description: liveVariant.variantTitle ?? liveVariant.productTitle ?? "Printify fulfillment cost",
                amount: new Prisma.Decimal(liveVariant.cost).div(100),
                currency,
              },
            ],
            podCostEstimated: false,
            podCostMissing: false,
          });
          continue;
        }

        resolutionByVariantId.set(mapping.variantId, getCachedPodResolution(mapping));
      }
    } catch {
      for (const mapping of connectionMappings) {
        resolutionByVariantId.set(mapping.variantId, getCachedPodResolution(mapping));
      }
    }
  }

  return resolutionByVariantId;
}

export async function createSnapshot(
  shopId: string,
  order: ShopifyOrderPayload,
  db: any = prisma,
  origin: "webhook" | "reconciliation" | "historical_import" = "webhook",
  fetchImpl: typeof fetch = fetch,
  metadata: {
    importBatchId?: string | null;
    importedAt?: Date | null;
    periodId?: string | null;
    replaceExistingSnapshotId?: string | null;
    replacementReason?: string | null;
    replacementSource?: string | null;
    fallbackSnapshot?: {
      customerDisplayName: string | null;
      shopifyCustomerId: string | null;
      normalizedCustomerEmailHash: string | null;
      subtotalAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      shippingAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      salesTaxCollected: Prisma.Decimal;
    };
  } = {},
): Promise<{ created: boolean; snapshotId?: string }> {
  const shopifyOrderId = order.admin_graphql_api_id ?? null;
  if (!shopifyOrderId) {
    throw new Error("Shopify order GID is required to create a snapshot.");
  }

  const logicalOrder = db.orderRecord?.findUnique
    ? await db.orderRecord.findUnique({
        where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
        select: {
          id: true,
          currentSnapshotId: true,
          currentSnapshot: {
            select: {
              id: true,
              revision: true,
              orderRecordId: true,
              periodId: true,
              salesTaxCollected: true,
            },
          },
        },
      })
    : null;
  const existing = logicalOrder?.currentSnapshot ?? await db.orderSnapshot.findFirst({
    where: { shopId, shopifyOrderId },
    select: { id: true, salesTaxCollected: true, revision: true, orderRecordId: true, periodId: true },
  });

  const replacementSnapshotId = metadata.replaceExistingSnapshotId ?? null;
  const isReplacing = Boolean(replacementSnapshotId && existing?.id === replacementSnapshotId);

  if (existing && !isReplacing) {
    if (logicalOrder && db.orderLifecycle?.upsert) {
      await db.$transaction(async (tx: typeof prisma) => {
        const lifecycleResult = await mergeOrderLifecycle({
          shopId,
          orderRecordId: logicalOrder.id,
          payload: order,
          source: origin,
          db: tx,
        });
        const adjustmentResult = await reconcileLifecycleAdjustmentsForSnapshot({
          shopId,
          orderRecordId: logicalOrder.id,
          snapshotId: existing.id,
          db: tx,
        });
        await recomputeTaxOffsetCache(shopId, tx);
        await tx.auditLog.create({
          data: {
            shopId,
            entity: "OrderLifecycle",
            entityId: logicalOrder.id,
            action: "ORDER_LIFECYCLE_RECONCILED",
            actor: "system",
            payload: {
              state: lifecycleResult.state,
              lifecycleUpdated: lifecycleResult.updated,
              adjustmentCount: adjustmentResult.created,
              unresolvedCount: adjustmentResult.unresolved.length,
              origin,
            },
          },
        });
      });
    }
    return { created: false, snapshotId: existing.id };
  }

  const lineItems = order.line_items ?? [];
  const missingProductGids = new Set<string>();
  const variantGids = Array.from(
    new Set(lineItems.map((lineItem) => toVariantGid(lineItem)).filter((variantGid): variantGid is string => Boolean(variantGid))),
  );
  const variants =
    db.variant?.findMany && variantGids.length > 0
      ? await db.variant.findMany({
          where: {
            shopId,
            shopifyId: {
              in: variantGids,
            },
          },
          select: {
            id: true,
            shopifyId: true,
          },
        })
      : [];
  const variantByGid = new Map(
    variants.map((variant: { id: string; shopifyId: string }) => [variant.shopifyId, variant]),
  );
  const productGids = Array.from(
    new Set(lineItems.map((lineItem) => toProductGid(lineItem)).filter((productGid): productGid is string => Boolean(productGid))),
  );
  const products =
    db.product?.findMany && productGids.length > 0
      ? await db.product.findMany({
          where: {
            shopId,
            shopifyId: {
              in: productGids,
            },
          },
          select: {
            id: true,
            shopifyId: true,
          },
        })
      : [];
  const productByGid = new Map<string, { id: string; shopifyId: string; donationRoutingMode: string }>(
    products.map((product: { id: string; shopifyId: string; donationRoutingMode: string }) => [product.shopifyId, product]),
  );
  const initialVariantIds = variants.map((variant: { id: string }) => variant.id);
  const podOverrides = await fetchSnapshotPodOverrides(shopId, initialVariantIds, db, fetchImpl);
  const shopifyCustomerId = toCustomerGid(order) ?? metadata.fallbackSnapshot?.shopifyCustomerId ?? null;
  const normalizedCustomerEmailHash = getCustomerEmailHash(order) ?? metadata.fallbackSnapshot?.normalizedCustomerEmailHash ?? null;
  const customerDisplayName = getCustomerDisplayName(order) ?? metadata.fallbackSnapshot?.customerDisplayName ?? null;
  const customerArtistAssociation =
    db.customerArtistAssociation?.findFirst && (shopifyCustomerId || normalizedCustomerEmailHash)
      ? await db.customerArtistAssociation.findFirst({
          where: {
            shopId,
            OR: [
              ...(shopifyCustomerId ? [{ shopifyCustomerId }] : []),
              ...(normalizedCustomerEmailHash ? [{ normalizedCustomerEmailHash }] : []),
            ],
          },
          select: { artistId: true },
      })
      : null;
  const unadjustedLinePricing = lineItems.map((lineItem) => {
      const quantity = Math.max(0, Number(lineItem.quantity ?? 0));
      const subtotal = getDiscountedLineSubtotal(lineItem, quantity);
      const lineKind = getLineKind(lineItem);
      return {
        quantity,
        subtotal,
        salePrice: quantity > 0 ? subtotal.div(quantity) : ZERO,
        discountEligible: lineKind !== "tip",
      };
    });
  const unadjustedLineSubtotal = unadjustedLinePricing.reduce((sum, line) => sum.add(line.subtotal), ZERO);
  const suppliedOrderDiscountedSubtotal = getOrderDiscountedSubtotal(order);
  const orderDiscountedSubtotal = suppliedOrderDiscountedSubtotal?.equals(ZERO) &&
    unadjustedLineSubtotal.gt(ZERO) &&
    getOrderDiscount(order).equals(ZERO)
    ? null
    : suppliedOrderDiscountedSubtotal;
  const adjustedLinePricing = allocateOrderLevelDiscounts(
    unadjustedLinePricing,
    orderDiscountedSubtotal,
  );

  const firstPassResolutions = await Promise.all(
    lineItems.map(async (lineItem, index): Promise<SnapshotResolution> => {
      const variantGid = toVariantGid(lineItem);
      const productGid = toProductGid(lineItem);
      const lineKind = getLineKind(lineItem);
      const pricing = adjustedLinePricing[index] ?? {
        quantity: Math.max(0, Number(lineItem.quantity ?? 0)),
        salePrice: getDiscountedUnitPrice(lineItem, Math.max(0, Number(lineItem.quantity ?? 0))),
        subtotal: getDiscountedLineSubtotal(lineItem, Math.max(0, Number(lineItem.quantity ?? 0))),
        discountEligible: lineKind !== "tip",
      };
      const quantity = pricing.quantity;
      const salePrice = pricing.salePrice;
      const subtotal = pricing.subtotal;

      const variant =
        (variantGid ? variantByGid.get(variantGid) : null) ??
        (variantGid && !db.variant?.findMany
          ? await db.variant.findFirst({
              where: { shopId, shopifyId: variantGid },
              select: { id: true },
            })
          : null);

      if (!variant && productGid) {
        missingProductGids.add(productGid);
      }

      const firstPass = variant
        ? await resolveCosts(shopId, variant.id, salePrice, "snapshot", db, undefined, podOverrides.get(variant.id))
        : {
            laborCost: ZERO,
            materialCost: ZERO,
            packagingCost: ZERO,
            equipmentCost: ZERO,
            mistakeBufferAmount: ZERO,
            podCost: ZERO,
            podLines: [],
            podCostEstimated: false,
            podCostMissing: false,
            totalCost: ZERO,
            materialLines: [],
            equipmentLines: [],
            netContribution: lineKind === "tip" ? ZERO : salePrice,
          };

      return {
        lineKind,
        variantId: variant?.id ?? null,
        productGid,
        lineItemId: lineItem.admin_graphql_api_id ?? lineItem.id?.toString() ?? crypto.randomUUID(),
        variantGid,
        productTitle: lineItem.title ?? "Unknown product",
        variantTitle: lineItem.variant_title ?? lineItem.title ?? "Default title",
        quantity,
        salePrice,
        subtotal,
        firstPass,
        packagingAllocated: ZERO,
        finalCosts: firstPass,
        allocations: [],
        artistAllocations: [],
      };
    }),
  );

  const snapshotLineSubtotal = firstPassResolutions.reduce((sum, line) => sum.add(line.subtotal), ZERO);
  const packagingEligibleSubtotal = firstPassResolutions.reduce(
    (sum, line) => line.lineKind === "tip" ? sum : sum.add(line.subtotal),
    ZERO,
  );
  const packagingCost = firstPassResolutions.reduce(
    (max, line) => (line.firstPass.packagingCost.gt(max) ? line.firstPass.packagingCost : max),
    ZERO,
  );

  const withFinalCosts = await Promise.all(
    firstPassResolutions.map(async (line) => {
      const packagingAllocated =
        line.lineKind !== "tip" && packagingEligibleSubtotal.gt(ZERO)
          ? packagingCost.mul(line.subtotal).div(packagingEligibleSubtotal)
          : ZERO;
      const packagingAllocatedPerUnit =
        line.quantity > 0 ? packagingAllocated.div(line.quantity) : ZERO;

      const finalCosts =
        line.variantId
          ? await resolveCosts(
              shopId,
              line.variantId,
              line.salePrice,
              "snapshot",
              db,
              packagingAllocatedPerUnit,
              podOverrides.get(line.variantId),
            )
          : {
              ...line.firstPass,
              packagingCost: packagingAllocatedPerUnit,
              totalCost: line.firstPass.totalCost.add(packagingAllocatedPerUnit).sub(line.firstPass.packagingCost),
              netContribution: line.lineKind === "tip"
                ? ZERO
                : line.salePrice.sub(
                    line.firstPass.totalCost.add(packagingAllocatedPerUnit).sub(line.firstPass.packagingCost),
                  ),
            };

      let allocations: SnapshotResolution["allocations"] = [];
      const artistAllocations: SnapshotResolution["artistAllocations"] = [];
      if (line.lineKind === "product" && line.productGid) {
        const product = productByGid.get(line.productGid);
        const productId = product?.id ?? "__missing_product__";
        const productArtistAssignments = db.productArtistAssignment?.findMany
          ? await db.productArtistAssignment.findMany({
              where: { shopId, productId, status: "active" },
              orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
              include: {
                artist: {
                  include: {
                    causeAssignments: {
                      include: {
                        cause: {
                          select: { id: true, name: true, is501c3: true },
                        },
                      },
                    },
                  },
                },
              },
            })
          : [];

        const allocationBase = Prisma.Decimal.max(finalCosts.netContribution!.mul(line.quantity), ZERO);
        const productOverrideEnabled = product?.donationRoutingMode === "product_override";

        if (productArtistAssignments.length > 0) {
          for (const assignment of productArtistAssignments) {
            const artist = assignment.artist;
            const collaborationShare = new Prisma.Decimal(assignment.collaborationShare);
            const selfPurchaseExcluded = customerArtistAssociation?.artistId === artist.id;
            const payoutEnabled = selfPurchaseExcluded
              ? false
              : assignment.payoutEnabledOverride ?? artist.paymentEnabled;
            const payoutRate = new Prisma.Decimal(assignment.payoutRateOverride ?? artist.defaultPayoutRate);
            const payoutBasis = line.subtotal.mul(collaborationShare).div(100);
            const payoutAmount = payoutEnabled ? payoutBasis.mul(payoutRate).div(100) : ZERO;
            const artistDonationBase = allocationBase.mul(collaborationShare).div(100);
            const donationRoutableAmount = Prisma.Decimal.max(artistDonationBase.sub(payoutAmount), ZERO);
            const artistName = artist.displayName;
            const creditName = assignment.creditOverride?.trim() || artist.creditName || artist.displayName;

            artistAllocations.push({
              artistId: artist.id,
              artistName,
              creditName,
              creditPreference: artist.creditPreference,
              collaborationShare,
              payoutEnabled,
              payoutRate,
              payoutBasis,
              payoutAmount,
              payoutExclusionReason: selfPurchaseExcluded ? "SELF_PURCHASE" : null,
              donationRoutableAmount,
            });

            if (!productOverrideEnabled) {
              for (const artistCauseAssignment of artist.causeAssignments) {
                allocations.push({
                  causeId: artistCauseAssignment.causeId,
                  causeName: artistCauseAssignment.cause.name,
                  is501c3: artistCauseAssignment.cause.is501c3,
                  percentage: artistCauseAssignment.percentage,
                  amount: donationRoutableAmount.mul(artistCauseAssignment.percentage).div(100),
                  source: "artist",
                  artistId: artist.id,
                  artistName,
                });
              }
            }
          }

          if (productOverrideEnabled) {
            const productAssignments = await db.productCauseAssignment.findMany({
              where: { shopId, productId },
              include: {
                cause: { select: { id: true, name: true, is501c3: true } },
              },
            });
            const pooledDonationRoutableAmount = artistAllocations.reduce(
              (sum, allocation) => sum.add(allocation.donationRoutableAmount),
              ZERO,
            );
            allocations = productAssignments.map((assignment: any) => ({
              causeId: assignment.causeId,
              causeName: assignment.cause.name,
              is501c3: assignment.cause.is501c3,
              percentage: assignment.percentage,
              amount: pooledDonationRoutableAmount.mul(assignment.percentage).div(100),
              source: "product_override" as const,
              artistId: null,
              artistName: null,
            }));
          }
        } else {
          const productAssignments = await db.productCauseAssignment.findMany({
            where: { shopId, productId },
            include: {
              cause: {
                select: { id: true, name: true, is501c3: true },
              },
            },
          });

          allocations = productAssignments.map((assignment: any) => ({
            causeId: assignment.causeId,
            causeName: assignment.cause.name,
            is501c3: assignment.cause.is501c3,
            percentage: assignment.percentage,
            amount: allocationBase.mul(assignment.percentage).div(100),
            source: "product",
            artistId: null,
            artistName: null,
          }));
        }
      }

      return {
        ...line,
        packagingAllocated,
        finalCosts,
        allocations,
        artistAllocations,
      };
    }),
  );

  try {
    const result = await db.$transaction(async (tx: any) => {
      const record = tx.orderRecord?.upsert
        ? await tx.orderRecord.upsert({
            where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
            create: { shopId, shopifyOrderId },
            update: {},
            select: { id: true, currentSnapshotId: true },
          })
        : null;
      if (isReplacing && record?.currentSnapshotId !== replacementSnapshotId) {
        throw new Error("Snapshot replacement target is no longer the current revision.");
      }
      if (!isReplacing && record?.currentSnapshotId) {
        return { id: record.currentSnapshotId, created: false };
      }
      const revision = isReplacing ? Number(existing?.revision ?? 1) + 1 : 1;

      const computedSnapshotSubtotal = orderDiscountedSubtotal ?? snapshotLineSubtotal;
      const snapshotSubtotal = computedSnapshotSubtotal.equals(ZERO) && snapshotLineSubtotal.equals(ZERO)
        ? metadata.fallbackSnapshot?.subtotalAmount ?? computedSnapshotSubtotal
        : computedSnapshotSubtotal;
      const hasShipping = order.total_shipping_price_set?.shop_money?.amount !== undefined || (order.shipping_lines?.length ?? 0) > 0;
      const shippingAmount = hasShipping
        ? getOrderShipping(order)
        : metadata.fallbackSnapshot?.shippingAmount ?? ZERO;
      const hasSalesTax = order.current_total_tax !== undefined || order.current_total_tax_set?.shop_money?.amount !== undefined || order.total_tax !== undefined || order.total_tax_set?.shop_money?.amount !== undefined;
      const salesTaxCollected = hasSalesTax
        ? getOrderSalesTax(order)
        : metadata.fallbackSnapshot?.salesTaxCollected ?? ZERO;
      const hasDiscount = order.current_total_discounts !== undefined || order.current_total_discounts_set?.shop_money?.amount !== undefined || order.total_discounts !== undefined || order.total_discounts_set?.shop_money?.amount !== undefined;
      const discountAmount = hasDiscount
        ? getOrderDiscount(order)
        : metadata.fallbackSnapshot?.discountAmount ?? ZERO;
      const derivedOrderTotal = snapshotSubtotal.add(shippingAmount).add(salesTaxCollected);
      const suppliedOrderTotal = getOrderTotal(order);
      const snapshotTotal = suppliedOrderTotal.equals(ZERO)
        ? derivedOrderTotal.gt(ZERO)
          ? derivedOrderTotal
          : metadata.fallbackSnapshot?.totalAmount ?? ZERO
        : suppliedOrderTotal;
      const snapshot = await tx.orderSnapshot.create({
        data: {
          shopId,
          shopifyOrderId,
          ...(record
            ? {
                orderRecordId: record.id,
                revision,
                replacementSource: isReplacing ? metadata.replacementSource ?? origin : null,
                replacementReason: isReplacing ? metadata.replacementReason ?? null : null,
              }
            : {}),
          orderNumber: order.name ?? order.order_number?.toString() ?? null,
          customerDisplayName,
          origin,
          periodId: metadata.periodId ?? null,
          importBatchId: metadata.importBatchId ?? null,
          importedAt: metadata.importedAt ?? null,
          subtotalAmount: snapshotSubtotal,
          discountAmount,
          shippingAmount,
          totalAmount: snapshotTotal,
          salesTaxCollected,
          shopifyCustomerId,
          normalizedCustomerEmailHash,
          createdAt: getOrderCreatedAt(order),
        },
      });
      if (customerArtistAssociation) {
        await tx.orderArtistAttribution.create({
          data: {
            shopId,
            snapshotId: snapshot.id,
            artistId: customerArtistAssociation.artistId,
            source: "customer_association",
          },
        });
      }
      const packagingLines: Array<{
        id: string;
        variantId: string | null;
        quantity: number;
        subtotal: Prisma.Decimal;
        packagingCost: Prisma.Decimal;
      }> = [];

      for (const line of withFinalCosts) {
        const snapshotLine = await tx.orderSnapshotLine.create({
          data: {
            shopId,
            snapshotId: snapshot.id,
            shopifyLineItemId: line.lineItemId,
            shopifyProductId: line.productGid,
            shopifyVariantId: line.variantGid ?? "unknown",
            lineKind: line.lineKind,
            variantTitle: line.variantTitle,
            productTitle: line.productTitle,
            quantity: line.quantity,
            salePrice: line.salePrice,
            subtotal: line.subtotal,
            laborCost: line.finalCosts.laborCost.mul(line.quantity),
            materialCost: line.finalCosts.materialCost.mul(line.quantity),
            packagingCost: line.finalCosts.packagingCost.mul(line.quantity),
            equipmentCost: line.finalCosts.equipmentCost.mul(line.quantity),
            podCost: line.finalCosts.podCost.mul(line.quantity),
            mistakeBufferAmount: line.finalCosts.mistakeBufferAmount.mul(line.quantity),
            totalCost: line.finalCosts.totalCost.mul(line.quantity),
            netContribution: (line.finalCosts.netContribution ?? ZERO).mul(line.quantity),
            podCostEstimated: line.finalCosts.podCostEstimated,
            podCostMissing: line.finalCosts.podCostMissing,
            laborMinutes: line.variantId
              ? (
                  await tx.variantCostConfig.findFirst({
                    where: { variantId: line.variantId, shopId },
                    select: { laborMinutes: true },
                  })
                )?.laborMinutes?.mul(line.quantity) ?? null
              : null,
            laborRate: line.variantId
              ? (
                  await tx.variantCostConfig.findFirst({
                    where: { variantId: line.variantId, shopId },
                    select: { laborRate: true },
                  })
                )?.laborRate ?? null
              : null,
          },
        });
        packagingLines.push({
          id: snapshotLine.id,
          variantId: line.variantId,
          quantity: line.quantity,
          subtotal: line.subtotal,
          packagingCost: line.finalCosts.packagingCost.mul(line.quantity),
        });

        if (line.finalCosts.materialLines.length > 0) {
          await tx.orderSnapshotMaterialLine.createMany({
            data: line.finalCosts.materialLines.map((materialLine) => ({
              snapshotLineId: snapshotLine.id,
              materialId: materialLine.materialId,
              materialName: materialLine.name,
              materialType: materialLine.type,
              costingModel: materialLine.costingModel,
              purchasePrice: materialLine.purchasePrice ?? ZERO,
              purchaseQty: materialLine.purchaseQty ?? ONE,
              perUnitCost: materialLine.perUnitCost ?? ZERO,
              yield_: materialLine.yield,
              usesPerVariant: scaleDecimal(materialLine.usesPerVariant, line.quantity),
              quantity: materialLine.quantity.mul(line.quantity),
              lineCost: materialLine.lineCost.mul(line.quantity),
            })),
          });
        }

        if (line.finalCosts.equipmentLines.length > 0) {
          for (const equipmentLine of line.finalCosts.equipmentLines) {
            const snapshotEquipmentLine = await tx.orderSnapshotEquipmentLine.create({
              data: {
                snapshotLineId: snapshotLine.id,
                equipmentId: equipmentLine.equipmentId,
                equipmentName: equipmentLine.name,
                hourlyRate: equipmentLine.hourlyRate,
                perUseCost: equipmentLine.perUseCost,
                hourlyRateMode: equipmentLine.hourlyRateMode ?? "manual",
                perUseCostMode: equipmentLine.perUseCostMode ?? "manual",
                usageMode: equipmentLine.usageMode,
                minutes: scaleDecimal(equipmentLine.minutes, line.quantity),
                uses: scaleDecimal(equipmentLine.uses, line.quantity),
                yieldDurationMinutes: equipmentLine.yieldDurationMinutes,
                yieldUses: equipmentLine.yieldUses,
                yieldQuantity: equipmentLine.yieldQuantity,
                electricityCost: (equipmentLine.componentCosts?.electricityCost ?? ZERO).mul(line.quantity),
                depreciationCost: (equipmentLine.componentCosts?.depreciationCost ?? ZERO).mul(line.quantity),
                consumablesCost: (equipmentLine.componentCosts?.consumablesCost ?? ZERO).mul(line.quantity),
                maintenanceCost: (equipmentLine.componentCosts?.maintenanceCost ?? ZERO).mul(line.quantity),
                manualOverrideCost: (equipmentLine.componentCosts?.manualOverrideCost ?? equipmentLine.lineCost).mul(line.quantity),
                lineCost: equipmentLine.lineCost.mul(line.quantity),
              },
            });

            if ((equipmentLine.consumableLines ?? []).length > 0) {
              await tx.orderSnapshotEquipmentConsumableLine.createMany({
                data: (equipmentLine.consumableLines ?? []).map((consumableLine) => ({
                  snapshotEquipmentLineId: snapshotEquipmentLine.id,
                  consumableId: consumableLine.consumableId,
                  consumableName: consumableLine.name,
                  lifespanUnit: consumableLine.lifespanUnit,
                  lineCost: consumableLine.lineCost.mul(line.quantity),
                })),
              });
            }
          }
        }

        if (line.finalCosts.podLines.length > 0) {
          await tx.orderSnapshotPODLine.createMany({
            data: line.finalCosts.podLines.map((podLine) => ({
              snapshotLineId: snapshotLine.id,
              provider: podLine.provider,
              costLineType: podLine.costLineType,
              description: podLine.description,
              amount: podLine.amount.mul(line.quantity),
            })),
          });
        }

        if (line.allocations.length > 0) {
          await tx.lineCauseAllocation.createMany({
            data: line.allocations.map((allocation) => ({
              shopId,
              snapshotLineId: snapshotLine.id,
              causeId: allocation.causeId,
              causeName: allocation.causeName,
              is501c3: allocation.is501c3,
              percentage: allocation.percentage,
              amount: allocation.amount,
              source: allocation.source,
              artistId: allocation.artistId ?? null,
              artistName: allocation.artistName ?? null,
            })),
          });
        }

        if (line.artistAllocations.length > 0) {
          await tx.lineArtistAllocation.createMany({
            data: line.artistAllocations.map((allocation) => ({
              shopId,
              snapshotLineId: snapshotLine.id,
              artistId: allocation.artistId,
              artistName: allocation.artistName,
              creditName: allocation.creditName,
              creditPreference: allocation.creditPreference,
              collaborationShare: allocation.collaborationShare,
              payoutEnabled: allocation.payoutEnabled,
              payoutRate: allocation.payoutRate,
              payoutBasis: allocation.payoutBasis,
              payoutAmount: allocation.payoutAmount,
              payoutExclusionReason: allocation.payoutExclusionReason,
              donationRoutableAmount: allocation.donationRoutableAmount,
            })),
          });
        }
      }

      if (typeof tx.orderPackageAllocation?.upsert === "function") {
        await reconcileSnapshotPackaging(shopId, snapshot.id, packagingLines, tx);
      }

      if (record && tx.orderLifecycle?.upsert) {
        const lifecycleResult = await mergeOrderLifecycle({
          shopId,
          orderRecordId: record.id,
          payload: order,
          source: origin,
          db: tx,
        });
        if (
          isReplacing &&
          (lifecycleResult.state === "unknown" || lifecycleResult.state === "review_required")
        ) {
          throw new Error("Snapshot replacement requires resolved order lifecycle evidence.");
        }
        const adjustmentResult = await reconcileLifecycleAdjustmentsForSnapshot({
          shopId,
          orderRecordId: record.id,
          snapshotId: snapshot.id,
          db: tx,
        });
        if (isReplacing && adjustmentResult.unresolved.length > 0) {
          throw new Error(
            `Snapshot replacement could not map adjustment events: ${adjustmentResult.unresolved.join(", ")}`,
          );
        }
        await tx.orderRecord.update({
          where: { id: record.id, shopId },
          data: { currentSnapshotId: snapshot.id },
        });
        if (isReplacing && existing?.periodId) {
          await tx.reportingPeriod.updateMany({
            where: { id: existing.periodId, shopId },
            data: { rebuildRequired: true, rebuildRequestedAt: new Date() },
          });
        }
      }

      await recomputeTaxOffsetCache(shopId, tx);

      if (typeof tx.orderSettlement?.upsert === "function") {
        await detectAndUpsertExternalSettlementReview({
          shopId,
          snapshotId: snapshot.id,
          periodId: metadata.periodId ?? null,
          order,
          db: tx,
        });
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "OrderSnapshot",
          entityId: snapshot.id,
          action: isReplacing ? "ORDER_SNAPSHOT_REPLACED" : "ORDER_SNAPSHOT_CREATED",
          actor: isReplacing ? "merchant" : "system",
          payload: {
            shopifyOrderId,
            lineCount: withFinalCosts.length,
            origin,
            revision,
            replacedSnapshotId: replacementSnapshotId,
            replacementReason: metadata.replacementReason ?? null,
          },
        },
      });

      return { ...snapshot, created: true };
    });

    for (const productGid of missingProductGids) {
      await jobQueue.send("catalog.sync.incremental", { shopId, productGid });
    }

    return { created: result.created, snapshotId: result.id };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existingRecord = db.orderRecord?.findUnique
      ? await db.orderRecord.findUnique({
          where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
          select: { currentSnapshotId: true },
        })
      : null;
    const existingSnapshot = existingRecord?.currentSnapshotId
      ? { id: existingRecord.currentSnapshotId }
      : await db.orderSnapshot.findFirst({
          where: { shopId, shopifyOrderId },
          select: { id: true },
        });

    return {
      created: false,
      snapshotId: existingSnapshot?.id,
    };
  }
}
