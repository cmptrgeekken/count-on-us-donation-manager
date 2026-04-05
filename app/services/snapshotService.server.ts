import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import { resolveCosts, type CostResult } from "./costEngine.server";
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
};

type ShopifyOrderPayload = {
  admin_graphql_api_id?: string;
  name?: string | null;
  order_number?: string | number | null;
  line_items?: SnapshotLineItemPayload[];
};

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

function toDecimal(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return ZERO;
  return new Prisma.Decimal(value);
}

function toVariantGid(lineItem: SnapshotLineItemPayload) {
  if (lineItem.admin_graphql_api_id?.includes("ProductVariant")) {
    return lineItem.admin_graphql_api_id;
  }
  if (lineItem.variant_id !== null && lineItem.variant_id !== undefined && lineItem.variant_id !== "") {
    return `gid://shopify/ProductVariant/${lineItem.variant_id}`;
  }
  return null;
}

function toProductGid(lineItem: SnapshotLineItemPayload) {
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

export async function createSnapshot(
  shopId: string,
  order: ShopifyOrderPayload,
  db: any = prisma,
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

  const firstPassResolutions = await Promise.all(
    lineItems.map(async (lineItem): Promise<SnapshotResolution> => {
      const variantGid = toVariantGid(lineItem);
      const productGid = toProductGid(lineItem);
      const quantity = Math.max(0, Number(lineItem.quantity ?? 0));
      const salePrice = toDecimal(lineItem.price);
      const subtotal = salePrice.mul(quantity);

      const variant =
        variantGid
          ? await db.variant.findFirst({
              where: { shopId, shopifyId: variantGid },
              select: { id: true },
            })
          : null;

      if (!variant && productGid) {
        await jobQueue.send("catalog.sync.incremental", { shopId, productGid });
      }

      const firstPass = variant
        ? await resolveCosts(shopId, variant.id, salePrice, "snapshot", db)
        : {
            laborCost: ZERO,
            materialCost: ZERO,
            packagingCost: ZERO,
            equipmentCost: ZERO,
            mistakeBufferAmount: ZERO,
            podCost: ZERO,
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

      const finalCosts =
        line.variantId
          ? await resolveCosts(shopId, line.variantId, line.salePrice, "snapshot", db, packagingAllocated)
          : {
              ...line.firstPass,
              packagingCost: packagingAllocated,
              totalCost: line.firstPass.totalCost.add(packagingAllocated).sub(line.firstPass.packagingCost),
              netContribution: line.salePrice.sub(
                line.firstPass.totalCost.add(packagingAllocated).sub(line.firstPass.packagingCost),
              ),
            };

      let allocations: SnapshotResolution["allocations"] = [];
      if (line.productGid) {
        const productAssignments = await db.productCauseAssignment.findMany({
          where: { shopId, shopifyProductId: line.productGid },
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
          amount: finalCosts.netContribution!.mul(line.quantity).mul(assignment.percentage).div(100),
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

  const result = await db.$transaction(async (tx: any) => {
    const snapshot = await tx.orderSnapshot.create({
      data: {
        shopId,
        shopifyOrderId,
        orderNumber: order.name ?? order.order_number?.toString() ?? null,
        origin: "webhook",
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
        },
      },
    });

    return snapshot;
  });

  return { created: true, snapshotId: result.id };
}
