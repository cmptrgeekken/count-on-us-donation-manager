import { Prisma } from "@prisma/client";

import { prisma } from "../db.server";
import { resolveCosts } from "./costEngine.server";
import { computeEstimatedTaxReserve, normalizeTaxDeductionMode } from "./taxReserve.server";

const ZERO = new Prisma.Decimal(0);
const PROCESSING_FLAT_FEE = new Prisma.Decimal("0.30");
const WIDGET_MANAGED_MARKETS_RATE = new Prisma.Decimal("0.00");

export const WIDGET_PRELOAD_LINE_THRESHOLD = 200;
export const WIDGET_RATE_LIMIT_PER_MINUTE = 60;

type WidgetProductContext = {
  product: {
    id: string;
    shopifyId: string;
    variants: Array<{
      id: string;
      shopifyId: string;
      price: Prisma.Decimal;
      costConfig: {
        lineItemCount: number;
      } | null;
    }>;
  };
  causeAssignments: Array<{
    causeId: string;
    percentage: Prisma.Decimal;
    cause: {
      id: string;
      name: string;
      is501c3: boolean;
      iconUrl: string | null;
      donationLink: string | null;
    };
  }>;
  shop: {
    currency: string;
    paymentRate: Prisma.Decimal | null;
    effectiveTaxRate: Prisma.Decimal | null;
    taxDeductionMode: string;
  };
  taxOffsetCache: {
    widgetTaxSuppressed: boolean;
  } | null;
};

function formatMoney(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function formatDecimal(value: Prisma.Decimal) {
  const fixed = value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed();
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

function formatPercent(value: Prisma.Decimal | null | undefined) {
  if (!value) return "0.00";
  return value.mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function nonNegative(value: Prisma.Decimal) {
  return value.lessThan(ZERO) ? ZERO : value;
}

function displayUnit(unitDescription: string | null | undefined) {
  return unitDescription?.trim() || "pc";
}

function quantityLabel(value: Prisma.Decimal | null | undefined, unit: string) {
  if (!value) return null;
  return `${formatDecimal(value)} ${unit}`;
}

function rateLabel(value: Prisma.Decimal | null | undefined, unit: string) {
  if (!value) return null;
  return `$${formatMoney(value)}/${unit}`;
}

function materialRateDetail(line: {
  costingModel: string | null;
  purchasePrice?: Prisma.Decimal;
  purchaseQty?: Prisma.Decimal;
  yield: Prisma.Decimal | null;
  totalUsesPerUnit?: Prisma.Decimal | null;
  unitDescription?: string | null;
}) {
  if (!line.purchasePrice || !line.purchaseQty || line.purchaseQty.lte(ZERO)) return null;

  const unit = displayUnit(line.unitDescription);
  if (line.costingModel === "yield" && line.yield && line.yield.gt(ZERO)) {
    return `${formatDecimal(line.yield)} ${unit}/purchase unit @ $${formatMoney(line.purchasePrice.div(line.purchaseQty))}/purchase unit`;
  }

  if (line.costingModel === "uses" && line.totalUsesPerUnit && line.totalUsesPerUnit.gt(ZERO)) {
    return `${formatDecimal(line.totalUsesPerUnit)} ${unit}/purchase unit @ $${formatMoney(line.purchasePrice.div(line.purchaseQty))}/purchase unit`;
  }

  return `$${formatMoney(line.purchasePrice.div(line.purchaseQty))}/purchase unit`;
}

function displayMaterialLine(line: {
  name: string;
  type: string;
  costingModel: string | null;
  quantity: Prisma.Decimal;
  yield: Prisma.Decimal | null;
  usesPerVariant: Prisma.Decimal | null;
  lineCost: Prisma.Decimal;
  unitDescription?: string | null;
  purchaseLink?: string | null;
  purchasePrice?: Prisma.Decimal;
  purchaseQty?: Prisma.Decimal;
  totalUsesPerUnit?: Prisma.Decimal | null;
}) {
  const unit = displayUnit(line.unitDescription);
  const quantityValue = line.costingModel === "uses" ? line.usesPerVariant : line.quantity;
  const rateBasis = quantityValue && quantityValue.gt(ZERO) ? line.lineCost.div(quantityValue) : null;

  return {
    name: line.name,
    type: line.type,
    lineCost: formatMoney(line.lineCost),
    quantity: quantityLabel(quantityValue, unit),
    quantityValue: quantityValue ? formatDecimal(quantityValue) : null,
    quantityUnit: unit,
    quantityParts: quantityValue ? [{ value: formatDecimal(quantityValue), unit }] : [],
    rate: rateLabel(rateBasis, unit),
    rateDetail: materialRateDetail(line),
    purchaseLink: line.purchaseLink ?? null,
  };
}

function displayEquipmentLine(line: {
  name: string;
  minutes: Prisma.Decimal | null;
  uses: Prisma.Decimal | null;
  lineCost: Prisma.Decimal;
  purchaseLink?: string | null;
  hourlyRate?: Prisma.Decimal | null;
  perUseCost?: Prisma.Decimal | null;
}) {
  const quantityParts = [
    quantityLabel(line.minutes, "min"),
    quantityLabel(line.uses, line.uses?.eq(1) ? "use" : "uses"),
  ].filter(Boolean);
  const rateParts = [
    line.hourlyRate ? `$${formatMoney(line.hourlyRate)}/hr` : null,
    line.perUseCost ? `$${formatMoney(line.perUseCost)}/use` : null,
  ].filter(Boolean);

  return {
    name: line.name,
    lineCost: formatMoney(line.lineCost),
    quantity: quantityParts.join(" + ") || null,
    quantityValue: null,
    quantityUnit: null,
    quantityParts: [
      line.minutes ? { value: formatDecimal(line.minutes), unit: "min" } : null,
      line.uses ? { value: formatDecimal(line.uses), unit: line.uses.eq(1) ? "use" : "uses" } : null,
    ].filter((part): part is { value: string; unit: string } => Boolean(part)),
    rate: rateParts.join(" + ") || null,
    rateDetail: null,
    purchaseLink: line.purchaseLink ?? null,
  };
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
    quantity: string | null;
    quantityValue: string | null;
    quantityUnit: string | null;
    quantityParts: Array<{ value: string; unit: string }>;
    rate: string | null;
    rateDetail: string | null;
    purchaseLink: string | null;
  }>;
  equipmentLines: Array<{
    name: string;
    lineCost: string;
    quantity: string | null;
    quantityValue: string | null;
    quantityUnit: string | null;
    quantityParts: Array<{ value: string; unit: string }>;
    rate: string | null;
    rateDetail: string | null;
    purchaseLink: string | null;
  }>;
  shippingMaterialLines: Array<{
    name: string;
    type: string;
    lineCost: string;
    quantity: string | null;
    quantityValue: string | null;
    quantityUnit: string | null;
    quantityParts: Array<{ value: string; unit: string }>;
    rate: string | null;
    rateDetail: string | null;
    purchaseLink: string | null;
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
  reconciliation: {
    estimatedTotal: string;
    allocatedDonations: string;
    retainedByShop: string;
    labor: string;
    materials: string;
    equipment: string;
    packaging: string;
    pod: string;
    mistakeBuffer: string;
    shopifyFees: string;
    taxReserve: string;
    remainder: string;
  };
};

type WidgetLineContext = {
  variantShopifyId: string;
  quantity: number;
  lineSubtotal: Prisma.Decimal | null;
};

export type WidgetProductPayload = {
  productId: string;
  deliveryMode: "preload" | "lazy";
  visible: boolean;
  totalLineItemCount: number;
  variants: WidgetVariantPayload[];
};

export type WidgetProductMetadata = Omit<WidgetProductPayload, "variants">;

async function loadWidgetProductContext(
  shopId: string,
  productShopifyId: string,
  db = prisma,
): Promise<WidgetProductContext | null> {
  const [product, shop, taxOffsetCache] = await Promise.all([
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

  const causeAssignments = await db.productCauseAssignment.findMany({
    where: {
      shopId,
      productId: product.id,
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
  });

  return {
    product,
    causeAssignments,
    shop,
    taxOffsetCache,
  };
}

export async function buildWidgetProductMetadata(
  shopId: string,
  productShopifyId: string,
  db = prisma,
): Promise<WidgetProductMetadata | null> {
  const context = await loadWidgetProductContext(shopId, productShopifyId, db);

  if (!context) {
    return null;
  }

  const totalLineItemCount = context.product.variants.reduce(
    (sum, variant) => sum + (variant.costConfig?.lineItemCount ?? 0),
    0,
  );
  const deliveryMode = totalLineItemCount < WIDGET_PRELOAD_LINE_THRESHOLD ? "preload" : "lazy";
  const visible = context.causeAssignments.length > 0 && context.product.variants.length > 0;

  return {
    productId: context.product.shopifyId,
    deliveryMode,
    visible,
    totalLineItemCount,
  };
}

export async function buildWidgetProductPayload(
  shopId: string,
  productShopifyId: string,
  db = prisma,
  lineContext?: WidgetLineContext,
): Promise<WidgetProductPayload | null> {
  const context = await loadWidgetProductContext(shopId, productShopifyId, db);

  if (!context) {
    return null;
  }

  const totalLineItemCount = context.product.variants.reduce(
    (sum, variant) => sum + (variant.costConfig?.lineItemCount ?? 0),
    0,
  );
  const deliveryMode = totalLineItemCount < WIDGET_PRELOAD_LINE_THRESHOLD ? "preload" : "lazy";
  const visible = context.causeAssignments.length > 0 && context.product.variants.length > 0;
  const normalizedTaxDeductionMode = normalizeTaxDeductionMode(context.shop.taxDeductionMode);
  const widgetTaxSuppressed = context.taxOffsetCache?.widgetTaxSuppressed ?? true;
  const currencyCode = context.shop.currency;

  const productVariants = lineContext
    ? context.product.variants.filter((variant) => variant.shopifyId === lineContext.variantShopifyId)
    : context.product.variants;

  const variants = await Promise.all(
    productVariants.map(async (variant) => {
      const costs = await resolveCosts(
        shopId,
        variant.id,
        variant.price,
        "preview",
        db as Parameters<typeof resolveCosts>[4],
      );
      const processingRate = context.shop.paymentRate ?? ZERO;
      const quantity = new Prisma.Decimal(lineContext?.quantity ?? 1);
      const estimatedTotal = lineContext?.lineSubtotal ?? variant.price.mul(quantity);
      const laborCost = costs.laborCost.mul(quantity);
      const materialCost = costs.materialCost.mul(quantity);
      const equipmentCost = costs.equipmentCost.mul(quantity);
      const packagingCost = costs.packagingCost;
      const podCost = costs.podCost.mul(quantity);
      const mistakeBufferAmount = costs.mistakeBufferAmount.mul(quantity);
      const processingFee = estimatedTotal.mul(processingRate).add(PROCESSING_FLAT_FEE);
      const preTaxContribution = nonNegative(
        estimatedTotal
          .sub(laborCost)
          .sub(materialCost)
          .sub(equipmentCost)
          .sub(packagingCost)
          .sub(podCost)
          .sub(mistakeBufferAmount)
          .sub(processingFee),
      );

      const allocations = context.causeAssignments.map((assignment) => ({
        is501c3: assignment.cause.is501c3,
        allocated: preTaxContribution.mul(assignment.percentage).div(100),
      }));
      const taxReserve = widgetTaxSuppressed
        ? {
            taxableBase: ZERO,
            taxableWeight: ZERO,
            estimatedTaxReserve: ZERO,
          }
        : computeEstimatedTaxReserve({
            totalNetContribution: preTaxContribution,
            businessExpenseTotal: ZERO,
            allocations,
            effectiveTaxRate: context.shop.effectiveTaxRate,
            taxDeductionMode: normalizedTaxDeductionMode,
          });
      const donationPool = nonNegative(preTaxContribution.sub(taxReserve.estimatedTaxReserve));
      const assignedDonationTotal = context.causeAssignments.reduce(
        (sum, assignment) => sum.add(donationPool.mul(assignment.percentage).div(100)),
        ZERO,
      );
      const retainedByShop = nonNegative(donationPool.sub(assignedDonationTotal));
      const attributedTotal = assignedDonationTotal
        .add(retainedByShop)
        .add(laborCost)
        .add(materialCost)
        .add(equipmentCost)
        .add(packagingCost)
        .add(podCost)
        .add(mistakeBufferAmount)
        .add(processingFee)
        .add(taxReserve.estimatedTaxReserve);
      const rawRemainder = estimatedTotal.sub(attributedTotal);
      const remainder = rawRemainder.abs().lessThan(new Prisma.Decimal("0.005")) ? ZERO : rawRemainder;

      return {
        variantId: variant.shopifyId,
        price: formatMoney(estimatedTotal),
        currencyCode,
        laborCost: formatMoney(laborCost),
        materialLines: costs.materialLines
          .filter((line) => line.type === "production")
          .map(displayMaterialLine),
        equipmentLines: costs.equipmentLines.map(displayEquipmentLine),
        shippingMaterialLines: costs.materialLines
          .filter((line) => line.type === "shipping")
          .map(displayMaterialLine),
        podCostTotal: formatMoney(podCost),
        mistakeBufferAmount: formatMoney(mistakeBufferAmount),
        shopifyFees: {
          processingRate: formatPercent(context.shop.paymentRate),
          processingFlatFee: formatMoney(PROCESSING_FLAT_FEE),
          managedMarketsRate: formatMoney(WIDGET_MANAGED_MARKETS_RATE),
          managedMarketsApplicable: false,
        },
        causes: context.causeAssignments.map((assignment) => ({
          causeId: assignment.cause.id,
          name: assignment.cause.name,
          iconUrl: assignment.cause.iconUrl ?? null,
          donationPercentage: assignment.percentage.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
          estimatedDonationAmount: formatMoney(donationPool.mul(assignment.percentage).div(100)),
          donationCurrencyCode: currencyCode,
          donationLink: assignment.cause.donationLink ?? null,
        })),
        taxReserve: {
          suppressed: widgetTaxSuppressed,
          estimatedRate: formatPercent(context.shop.effectiveTaxRate),
          estimatedAmount: widgetTaxSuppressed ? "0.00" : formatMoney(taxReserve.estimatedTaxReserve),
        },
        reconciliation: {
          estimatedTotal: formatMoney(estimatedTotal),
          allocatedDonations: formatMoney(assignedDonationTotal),
          retainedByShop: formatMoney(retainedByShop),
          labor: formatMoney(laborCost),
          materials: formatMoney(materialCost),
          equipment: formatMoney(equipmentCost),
          packaging: formatMoney(packagingCost),
          pod: formatMoney(podCost),
          mistakeBuffer: formatMoney(mistakeBufferAmount),
          shopifyFees: formatMoney(processingFee),
          taxReserve: widgetTaxSuppressed ? "0.00" : formatMoney(taxReserve.estimatedTaxReserve),
          remainder: formatMoney(remainder),
        },
      };
    }),
  );

  return {
    productId: context.product.shopifyId,
    deliveryMode,
    visible,
    totalLineItemCount,
    variants,
  };
}
