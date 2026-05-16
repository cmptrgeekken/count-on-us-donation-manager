import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { resolveCosts } from "./costEngine.server";
import { computeEstimatedTaxReserve, normalizeTaxDeductionMode } from "./taxReserve.server";

const ZERO = new Prisma.Decimal(0);
export const PROCESSING_FLAT_FEE = new Prisma.Decimal("0.30");
export const WIDGET_MANAGED_MARKETS_RATE = new Prisma.Decimal("0.00");

type VariantEstimateCauseAssignment = {
  causeId: string;
  percentage: Prisma.Decimal;
  cause: {
    id: string;
    name: string;
    is501c3: boolean;
    iconUrl: string | null;
    donationLink: string | null;
  };
};

type VariantEstimateShop = {
  currency: string;
  paymentRate: Prisma.Decimal | null;
  effectiveTaxRate: Prisma.Decimal | null;
  taxDeductionMode: string;
};

type EstimateMaterialLinePayload = {
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
};

type EstimateEquipmentLinePayload = Omit<EstimateMaterialLinePayload, "type">;

export type VariantEstimatePayload = {
  variantId: string;
  price: string;
  currencyCode: string;
  laborCost: string;
  materialLines: EstimateMaterialLinePayload[];
  equipmentLines: EstimateEquipmentLinePayload[];
  shippingMaterialLines: EstimateMaterialLinePayload[];
  podCostTotal: string;
  podCostEstimated: boolean;
  podCostMissing: boolean;
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

export function formatEstimateMoney(value: Prisma.Decimal) {
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
  return `$${formatEstimateMoney(value)}/${unit}`;
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
    return `${formatDecimal(line.yield)} ${unit}/purchase unit @ $${formatEstimateMoney(line.purchasePrice.div(line.purchaseQty))}/purchase unit`;
  }

  if (line.costingModel === "uses" && line.totalUsesPerUnit && line.totalUsesPerUnit.gt(ZERO)) {
    return `${formatDecimal(line.totalUsesPerUnit)} ${unit}/purchase unit @ $${formatEstimateMoney(line.purchasePrice.div(line.purchaseQty))}/purchase unit`;
  }

  return `$${formatEstimateMoney(line.purchasePrice.div(line.purchaseQty))}/purchase unit`;
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
    lineCost: formatEstimateMoney(line.lineCost),
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
    line.hourlyRate ? `$${formatEstimateMoney(line.hourlyRate)}/hr` : null,
    line.perUseCost ? `$${formatEstimateMoney(line.perUseCost)}/use` : null,
  ].filter(Boolean);

  return {
    name: line.name,
    lineCost: formatEstimateMoney(line.lineCost),
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

export async function buildVariantEstimatePayload(input: {
  shopId: string;
  variant: {
    id: string;
    shopifyId: string;
    price: Prisma.Decimal;
  };
  causeAssignments: VariantEstimateCauseAssignment[];
  shop: VariantEstimateShop;
  widgetTaxSuppressed: boolean;
  quantity?: number;
  lineSubtotal?: Prisma.Decimal | null;
  db?: any;
}): Promise<VariantEstimatePayload> {
  const db = input.db ?? prisma;
  const costs = await resolveCosts(
    input.shopId,
    input.variant.id,
    input.variant.price,
    "preview",
    db as Parameters<typeof resolveCosts>[4],
  );
  const processingRate = input.shop.paymentRate ?? ZERO;
  const quantity = new Prisma.Decimal(input.quantity ?? 1);
  const estimatedTotal = input.lineSubtotal ?? input.variant.price.mul(quantity);
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

  const normalizedTaxDeductionMode = normalizeTaxDeductionMode(input.shop.taxDeductionMode);
  const allocations = input.causeAssignments.map((assignment) => ({
    is501c3: assignment.cause.is501c3,
    allocated: preTaxContribution.mul(assignment.percentage).div(100),
  }));
  const taxReserve = input.widgetTaxSuppressed
    ? {
        taxableBase: ZERO,
        taxableWeight: ZERO,
        estimatedTaxReserve: ZERO,
      }
    : computeEstimatedTaxReserve({
        totalNetContribution: preTaxContribution,
        businessExpenseTotal: ZERO,
        allocations,
        effectiveTaxRate: input.shop.effectiveTaxRate,
        taxDeductionMode: normalizedTaxDeductionMode,
      });
  const donationPool = nonNegative(preTaxContribution.sub(taxReserve.estimatedTaxReserve));
  const assignedDonationTotal = input.causeAssignments.reduce(
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
    variantId: input.variant.shopifyId,
    price: formatEstimateMoney(estimatedTotal),
    currencyCode: input.shop.currency,
    laborCost: formatEstimateMoney(laborCost),
    materialLines: costs.materialLines
      .filter((line) => line.type === "production")
      .map(displayMaterialLine),
    equipmentLines: costs.equipmentLines.map(displayEquipmentLine),
    shippingMaterialLines: costs.materialLines
      .filter((line) => line.type === "shipping")
      .map(displayMaterialLine),
    podCostTotal: formatEstimateMoney(podCost),
    podCostEstimated: costs.podCostEstimated,
    podCostMissing: costs.podCostMissing,
    mistakeBufferAmount: formatEstimateMoney(mistakeBufferAmount),
    shopifyFees: {
      processingRate: formatPercent(input.shop.paymentRate),
      processingFlatFee: formatEstimateMoney(PROCESSING_FLAT_FEE),
      managedMarketsRate: formatEstimateMoney(WIDGET_MANAGED_MARKETS_RATE),
      managedMarketsApplicable: false,
    },
    causes: input.causeAssignments.map((assignment) => ({
      causeId: assignment.cause.id,
      name: assignment.cause.name,
      iconUrl: assignment.cause.iconUrl ?? null,
      donationPercentage: assignment.percentage.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      estimatedDonationAmount: formatEstimateMoney(donationPool.mul(assignment.percentage).div(100)),
      donationCurrencyCode: input.shop.currency,
      donationLink: assignment.cause.donationLink ?? null,
    })),
    taxReserve: {
      suppressed: input.widgetTaxSuppressed,
      estimatedRate: formatPercent(input.shop.effectiveTaxRate),
      estimatedAmount: input.widgetTaxSuppressed ? "0.00" : formatEstimateMoney(taxReserve.estimatedTaxReserve),
    },
    reconciliation: {
      estimatedTotal: formatEstimateMoney(estimatedTotal),
      allocatedDonations: formatEstimateMoney(assignedDonationTotal),
      retainedByShop: formatEstimateMoney(retainedByShop),
      labor: formatEstimateMoney(laborCost),
      materials: formatEstimateMoney(materialCost),
      equipment: formatEstimateMoney(equipmentCost),
      packaging: formatEstimateMoney(packagingCost),
      pod: formatEstimateMoney(podCost),
      mistakeBuffer: formatEstimateMoney(mistakeBufferAmount),
      shopifyFees: formatEstimateMoney(processingFee),
      taxReserve: input.widgetTaxSuppressed ? "0.00" : formatEstimateMoney(taxReserve.estimatedTaxReserve),
      remainder: formatEstimateMoney(remainder),
    },
  };
}

export async function buildAdminVariantEstimate(
  shopId: string,
  variantId: string,
  db: any = prisma,
): Promise<VariantEstimatePayload | null> {
  const [variant, shop, taxOffsetCache] = await Promise.all([
    db.variant.findFirst({
      where: { id: variantId, shopId },
      select: {
        id: true,
        shopifyId: true,
        price: true,
        productId: true,
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

  if (!variant || !shop) return null;

  const causeAssignments = await db.productCauseAssignment.findMany({
    where: {
      shopId,
      productId: variant.productId,
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

  return buildVariantEstimatePayload({
    shopId,
    variant,
    causeAssignments,
    shop,
    widgetTaxSuppressed: taxOffsetCache?.widgetTaxSuppressed ?? true,
    db,
  });
}
