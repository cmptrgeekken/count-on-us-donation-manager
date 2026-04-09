import { Prisma } from "@prisma/client";

import { prisma } from "../db.server";
import { resolveCosts } from "./costEngine.server";
import { computeEstimatedTaxReserve, normalizeTaxDeductionMode } from "./taxReserve.server";

const ZERO = new Prisma.Decimal(0);
const PROCESSING_FLAT_FEE = new Prisma.Decimal("0.30");
const WIDGET_MANAGED_MARKETS_RATE = new Prisma.Decimal("0.00");

export const WIDGET_PRELOAD_LINE_THRESHOLD = 200;
export const WIDGET_RATE_LIMIT_PER_MINUTE = 60;

function formatMoney(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function formatPercent(value: Prisma.Decimal | null | undefined) {
  if (!value) return "0.00";
  return value.mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function nonNegative(value: Prisma.Decimal) {
  return value.lessThan(ZERO) ? ZERO : value;
}

export type WidgetVariantPayload = {
  variantId: string;
  price: string;
  currencyCode: string;
  laborCost: string;
  materialLines: Array<{
    name: string;
    type: string;
    lineCost: string;
  }>;
  equipmentLines: Array<{
    name: string;
    lineCost: string;
  }>;
  shippingMaterialLines: Array<{
    name: string;
    lineCost: string;
  }>;
  podCostTotal: string;
  mistakeBufferAmount: string;
  shopifyFees: {
    processingRate: string;
    processingFlatFee: string;
    managedMarketsRate: string;
    managedMarketsApplicable: boolean;
  };
  causes: Array<{
    causeId: string;
    name: string;
    iconUrl: string | null;
    donationPercentage: string;
    estimatedDonationAmount: string;
    donationCurrencyCode: string;
    donationLink: string | null;
  }>;
  taxReserve: {
    suppressed: boolean;
    estimatedRate: string;
    estimatedAmount: string;
  };
};

export type WidgetProductPayload = {
  productId: string;
  deliveryMode: "preload" | "lazy";
  visible: boolean;
  totalLineItemCount: number;
  variants: WidgetVariantPayload[];
};

export async function buildWidgetProductPayload(
  shopId: string,
  productShopifyId: string,
  db = prisma,
): Promise<WidgetProductPayload | null> {
  const [product, causeAssignments, shop, taxOffsetCache] = await Promise.all([
    db.product.findFirst({
      where: { shopId, shopifyId: productShopifyId },
      select: {
        id: true,
        shopifyId: true,
        variants: {
          orderBy: [{ title: "asc" }, { shopifyId: "asc" }],
          select: {
            id: true,
            shopifyId: true,
            price: true,
            costConfig: {
              select: {
                lineItemCount: true,
              },
            },
          },
        },
      },
    }),
    db.productCauseAssignment.findMany({
      where: {
        shopId,
        shopifyProductId: productShopifyId,
        cause: {
          status: "active",
        },
      },
      orderBy: [{ percentage: "desc" }, { cause: { name: "asc" } }],
      select: {
        causeId: true,
        percentage: true,
        cause: {
          select: {
            id: true,
            name: true,
            is501c3: true,
            iconUrl: true,
            donationLink: true,
          },
        },
      },
    }),
    db.shop.findUnique({
      where: { shopId },
      select: {
        currency: true,
        paymentRate: true,
        effectiveTaxRate: true,
        taxDeductionMode: true,
      },
    }),
    db.taxOffsetCache.findUnique({
      where: { shopId },
      select: {
        widgetTaxSuppressed: true,
      },
    }),
  ]);

  if (!product || !shop) {
    return null;
  }

  const totalLineItemCount = product.variants.reduce(
    (sum, variant) => sum + (variant.costConfig?.lineItemCount ?? 0),
    0,
  );
  const deliveryMode = totalLineItemCount < WIDGET_PRELOAD_LINE_THRESHOLD ? "preload" : "lazy";
  const visible = causeAssignments.length > 0 && product.variants.length > 0;
  const normalizedTaxDeductionMode = normalizeTaxDeductionMode(shop.taxDeductionMode);
  const widgetTaxSuppressed = taxOffsetCache?.widgetTaxSuppressed ?? true;
  const currencyCode = shop.currency;

  const variants = await Promise.all(
    product.variants.map(async (variant) => {
      const costs = await resolveCosts(
        shopId,
        variant.id,
        variant.price,
        "preview",
        db as Parameters<typeof resolveCosts>[4],
      );
      const netContribution = nonNegative(variant.price.sub(costs.totalCost));

      const allocations = causeAssignments.map((assignment) => ({
        is501c3: assignment.cause.is501c3,
        allocated: netContribution.mul(assignment.percentage).div(100),
      }));
      const taxReserve = widgetTaxSuppressed
        ? {
            taxableBase: ZERO,
            taxableWeight: ZERO,
            estimatedTaxReserve: ZERO,
          }
        : computeEstimatedTaxReserve({
            totalNetContribution: netContribution,
            businessExpenseTotal: ZERO,
            allocations,
            effectiveTaxRate: shop.effectiveTaxRate,
            taxDeductionMode: normalizedTaxDeductionMode,
          });

      return {
        variantId: variant.shopifyId,
        price: formatMoney(variant.price),
        currencyCode,
        laborCost: formatMoney(costs.laborCost),
        materialLines: costs.materialLines
          .filter((line) => line.type === "production")
          .map((line) => ({
            name: line.name,
            type: line.type,
            lineCost: formatMoney(line.lineCost),
          })),
        equipmentLines: costs.equipmentLines.map((line) => ({
          name: line.name,
          lineCost: formatMoney(line.lineCost),
        })),
        shippingMaterialLines: costs.materialLines
          .filter((line) => line.type === "shipping")
          .map((line) => ({
            name: line.name,
            lineCost: formatMoney(line.lineCost),
          })),
        podCostTotal: formatMoney(costs.podCost),
        mistakeBufferAmount: formatMoney(costs.mistakeBufferAmount),
        shopifyFees: {
          processingRate: formatPercent(shop.paymentRate),
          processingFlatFee: formatMoney(PROCESSING_FLAT_FEE),
          managedMarketsRate: formatMoney(WIDGET_MANAGED_MARKETS_RATE),
          managedMarketsApplicable: false,
        },
        causes: causeAssignments.map((assignment) => ({
          causeId: assignment.cause.id,
          name: assignment.cause.name,
          iconUrl: assignment.cause.iconUrl ?? null,
          donationPercentage: assignment.percentage.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
          estimatedDonationAmount: formatMoney(
            nonNegative(netContribution.mul(assignment.percentage).div(100)),
          ),
          donationCurrencyCode: currencyCode,
          donationLink: assignment.cause.donationLink ?? null,
        })),
        taxReserve: {
          suppressed: widgetTaxSuppressed,
          estimatedRate: formatPercent(shop.effectiveTaxRate),
          estimatedAmount: widgetTaxSuppressed ? "0.00" : formatMoney(taxReserve.estimatedTaxReserve),
        },
      };
    }),
  );

  return {
    productId: product.shopifyId,
    deliveryMode,
    visible,
    totalLineItemCount,
    variants,
  };
}
