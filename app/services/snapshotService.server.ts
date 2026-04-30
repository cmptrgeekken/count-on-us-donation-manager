import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import { resolveCosts, type CostResult, type PodCostResolution } from "./costEngine.server";
import { decryptProviderCredential } from "./providerCredentials.server";
import { listPrintifyProducts } from "./printify.server";
import { recomputeTaxOffsetCache } from "./taxOffsetCache.server";

type SnapshotLineItemPayload = {
  admin_graphql_api_id?: string;
  id?: string | number;
  variant_id?: string | number | null;
  product_id?: string | number | null;
  title?: string | null;
  variant_title?: string | null;
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

type ShopifyOrderPayload = {
  admin_graphql_api_id?: string;
  name?: string | null;
  order_number?: string | number | null;
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
  origin: "webhook" | "reconciliation" = "webhook",
  fetchImpl: typeof fetch = fetch,
): Promise<{ created: boolean; snapshotId?: string }> {
  const shopifyOrderId = order.admin_graphql_api_id ?? null;
  if (!shopifyOrderId) {
    throw new Error("Shopify order GID is required to create a snapshot.");
  }

  const existing = await db.orderSnapshot.findFirst({
    where: { shopId, shopifyOrderId },
    select: { id: true },
  });

  if (existing) {
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
  const productByGid = new Map(
    products.map((product: { id: string; shopifyId: string }) => [product.shopifyId, product]),
  );
  const initialVariantIds = variants.map((variant: { id: string }) => variant.id);
  const podOverrides = await fetchSnapshotPodOverrides(shopId, initialVariantIds, db, fetchImpl);

  const firstPassResolutions = await Promise.all(
    lineItems.map(async (lineItem): Promise<SnapshotResolution> => {
      const variantGid = toVariantGid(lineItem);
      const productGid = toProductGid(lineItem);
      const quantity = Math.max(0, Number(lineItem.quantity ?? 0));
      const salePrice = getDiscountedUnitPrice(lineItem, quantity);
      const subtotal = getDiscountedLineSubtotal(lineItem, quantity);

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
            netContribution: salePrice,
          };

      return {
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
      };
    }),
  );

  const orderSubtotal = firstPassResolutions.reduce((sum, line) => sum.add(line.subtotal), ZERO);
  const packagingCost = firstPassResolutions.reduce(
    (max, line) => (line.firstPass.packagingCost.gt(max) ? line.firstPass.packagingCost : max),
    ZERO,
  );

  const withFinalCosts = await Promise.all(
    firstPassResolutions.map(async (line) => {
      const packagingAllocated =
        orderSubtotal.gt(ZERO) ? packagingCost.mul(line.subtotal).div(orderSubtotal) : ZERO;
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
              netContribution: line.salePrice.sub(
                line.firstPass.totalCost.add(packagingAllocatedPerUnit).sub(line.firstPass.packagingCost),
              ),
            };

      let allocations: SnapshotResolution["allocations"] = [];
      if (line.productGid) {
        const product = productByGid.get(line.productGid);
        const productAssignments = await db.productCauseAssignment.findMany({
          where: { shopId, productId: product?.id ?? "__missing_product__" },
          include: {
            cause: {
              select: { id: true, name: true, is501c3: true },
            },
          },
        });

        const allocationBase = Prisma.Decimal.max(finalCosts.netContribution!.mul(line.quantity), ZERO);
        allocations = productAssignments.map((assignment: any) => ({
          causeId: assignment.causeId,
          causeName: assignment.cause.name,
          is501c3: assignment.cause.is501c3,
          percentage: assignment.percentage,
          amount: allocationBase.mul(assignment.percentage).div(100),
        }));
      }

      return {
        ...line,
        packagingAllocated,
        finalCosts,
        allocations,
      };
    }),
  );

  try {
    const result = await db.$transaction(async (tx: any) => {
      const snapshot = await tx.orderSnapshot.create({
        data: {
          shopId,
          shopifyOrderId,
          orderNumber: order.name ?? order.order_number?.toString() ?? null,
          origin,
        },
      });

      for (const line of withFinalCosts) {
        const snapshotLine = await tx.orderSnapshotLine.create({
          data: {
            shopId,
            snapshotId: snapshot.id,
            shopifyLineItemId: line.lineItemId,
            shopifyVariantId: line.variantGid ?? "unknown",
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
          await tx.orderSnapshotEquipmentLine.createMany({
            data: line.finalCosts.equipmentLines.map((equipmentLine) => ({
              snapshotLineId: snapshotLine.id,
              equipmentId: equipmentLine.equipmentId,
              equipmentName: equipmentLine.name,
              hourlyRate: equipmentLine.hourlyRate,
              perUseCost: equipmentLine.perUseCost,
              minutes: scaleDecimal(equipmentLine.minutes, line.quantity),
              uses: scaleDecimal(equipmentLine.uses, line.quantity),
              lineCost: equipmentLine.lineCost.mul(line.quantity),
            })),
          });
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
            })),
          });
        }
      }

      await recomputeTaxOffsetCache(shopId, tx);

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "OrderSnapshot",
          entityId: snapshot.id,
          action: "ORDER_SNAPSHOT_CREATED",
          actor: "system",
          payload: {
            shopifyOrderId,
            lineCount: withFinalCosts.length,
            origin,
          },
        },
      });

      return snapshot;
    });

    for (const productGid of missingProductGids) {
      await jobQueue.send("catalog.sync.incremental", { shopId, productGid });
    }

    return { created: true, snapshotId: result.id };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existingSnapshot = await db.orderSnapshot.findFirst({
      where: { shopId, shopifyOrderId },
      select: { id: true },
    });

    return {
      created: false,
      snapshotId: existingSnapshot?.id,
    };
  }
}
