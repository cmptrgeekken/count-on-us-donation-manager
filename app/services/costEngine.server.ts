/**
 * CostEngine — pure cost resolution function (ADR-003).
 *
 * Rules:
 * - No DB writes. No internal state. No caching.
 * - Accepts a Prisma client to allow callers to pass a transaction client.
 * - Returns a fully materialised cost structure.
 * - "snapshot" mode: includes netContribution and raw library values.
 * - "preview" mode: display-safe at API assembly time — omits netContribution from CostEngine output.
 */
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export type CostEngineMode = "snapshot" | "preview";

export type ResolvedMaterialLine = {
  materialId: string;
  name: string;
  type: string; // "production" | "shipping"
  costingModel: string | null;
  quantity: Prisma.Decimal;
  yield: Prisma.Decimal | null;
  usesPerVariant: Prisma.Decimal | null;
  lineCost: Prisma.Decimal;
  unitDescription?: string | null;
  purchaseLink?: string | null;
  totalUsesPerUnit?: Prisma.Decimal | null;
  purchasePrice?: Prisma.Decimal;
  purchaseQty?: Prisma.Decimal;
  perUnitCost?: Prisma.Decimal;
};

export type ResolvedEquipmentLine = {
  equipmentId: string;
  name: string;
  usageMode: string;
  minutes: Prisma.Decimal | null;
  uses: Prisma.Decimal | null;
  yieldDurationMinutes: Prisma.Decimal | null;
  yieldUses: Prisma.Decimal | null;
  yieldQuantity: Prisma.Decimal | null;
  lineCost: Prisma.Decimal;
  purchaseLink?: string | null;
  hourlyRate?: Prisma.Decimal | null;
  perUseCost?: Prisma.Decimal | null;
  hourlyRateMode?: string;
  perUseCostMode?: string;
  componentCosts?: ResolvedEquipmentComponentCosts;
  consumableLines?: ResolvedEquipmentConsumableLine[];
};

export type ResolvedEquipmentComponentCosts = {
  electricityCost: Prisma.Decimal;
  depreciationCost: Prisma.Decimal;
  consumablesCost: Prisma.Decimal;
  maintenanceCost: Prisma.Decimal;
  manualOverrideCost: Prisma.Decimal;
};

export type ResolvedEquipmentConsumableLine = {
  consumableId: string;
  name: string;
  lifespanUnit: string;
  lineCost: Prisma.Decimal;
};

export type ResolvedPodLine = {
  provider: string;
  costLineType: string;
  description: string | null;
  amount: Prisma.Decimal;
  currency: string;
};

export type CostResult = {
  laborCost: Prisma.Decimal;
  materialCost: Prisma.Decimal;      // production materials only (before mistake buffer)
  packagingCost: Prisma.Decimal;     // sum of shipping material lines in preview; order flows may override
  equipmentCost: Prisma.Decimal;
  mistakeBufferAmount: Prisma.Decimal; // applied to production materials only
  podCost: Prisma.Decimal;
  podLines: ResolvedPodLine[];
  podCostEstimated: boolean;
  podCostMissing: boolean;
  totalCost: Prisma.Decimal;
  materialLines: ResolvedMaterialLine[];
  equipmentLines: ResolvedEquipmentLine[];
  // snapshot mode only:
  netContribution?: Prisma.Decimal;
};

export type PodCostResolution = Pick<
  CostResult,
  "podCost" | "podLines" | "podCostEstimated" | "podCostMissing"
>;

const ZERO = new Prisma.Decimal(0);

function decimalOrZero(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value ?? ZERO;
}

/**
 * Compute material line cost.
 * Counted parts: perUnitCost * quantity
 * Variable yield: (purchasePrice / purchaseQty / yield) * quantity
 * Portioned use:  (purchasePrice / purchaseQty / totalUsesPerUnit) * usesPerVariant
 * Legacy flat shipping: perUnitCost * quantity
 */
function computeMaterialLineCost(params: {
  type: string;
  costingModel: string | null;
  purchasePrice: Prisma.Decimal;
  purchaseQty: Prisma.Decimal;
  totalUsesPerUnit: Prisma.Decimal | null;
  yield_: Prisma.Decimal | null;
  quantity: Prisma.Decimal;
  usesPerVariant: Prisma.Decimal | null;
}): Prisma.Decimal {
  const { costingModel, purchasePrice, purchaseQty, totalUsesPerUnit, yield_, quantity, usesPerVariant } = params;
  const perUnit = purchasePrice.div(purchaseQty);

  if (costingModel === "counted") {
    return perUnit.mul(quantity);
  }

  if (costingModel === "yield" && yield_ && yield_.gt(ZERO)) {
    return perUnit.div(yield_).mul(quantity);
  }

  if (costingModel === "uses" && totalUsesPerUnit && totalUsesPerUnit.gt(ZERO) && usesPerVariant) {
    return perUnit.div(totalUsesPerUnit).mul(usesPerVariant);
  }

  // Fallback: treat as per-unit × quantity
  return perUnit.mul(quantity);
}

/**
 * Compute equipment line cost.
 * Direct: (hourlyRate * minutes / 60) + (perUseCost * uses)
 * Duration yield: (hourlyRate * yieldDurationMinutes / 60) / yieldQuantity
 * Use yield: (perUseCost * yieldUses) / yieldQuantity
 */
function computeEquipmentLineCost(params: {
  hourlyRate: Prisma.Decimal | null;
  perUseCost: Prisma.Decimal | null;
  usageMode: string | null;
  minutes: Prisma.Decimal | null;
  uses: Prisma.Decimal | null;
  yieldDurationMinutes: Prisma.Decimal | null;
  yieldUses: Prisma.Decimal | null;
  yieldQuantity: Prisma.Decimal | null;
}): Prisma.Decimal {
  const { hourlyRate, perUseCost, usageMode, minutes, uses, yieldDurationMinutes, yieldUses, yieldQuantity } = params;
  let cost = ZERO;

  if (usageMode === "duration_yield") {
    if (hourlyRate && yieldDurationMinutes && yieldQuantity && yieldQuantity.gt(ZERO)) {
      return hourlyRate.mul(yieldDurationMinutes).div(60).div(yieldQuantity);
    }
    return ZERO;
  }

  if (usageMode === "use_yield") {
    if (perUseCost && yieldUses && yieldQuantity && yieldQuantity.gt(ZERO)) {
      return perUseCost.mul(yieldUses).div(yieldQuantity);
    }
    return ZERO;
  }

  if (hourlyRate && minutes) {
    cost = cost.add(hourlyRate.mul(minutes).div(60));
  }
  if (perUseCost && uses) {
    cost = cost.add(perUseCost.mul(uses));
  }

  return cost;
}

export type EquipmentConsumableForCosting = {
  id: string;
  name: string;
  replacementCost: Prisma.Decimal;
  lifespanQuantity: Prisma.Decimal;
  lifespanUnit: string;
  status: string;
};

export type EquipmentForCosting = {
  hourlyRate: Prisma.Decimal | null;
  hourlyRateMode?: string | null;
  perUseCost: Prisma.Decimal | null;
  perUseCostMode?: string | null;
  equipmentCost?: Prisma.Decimal | null;
  acquisitionCost?: Prisma.Decimal | null;
  expectedLifespanHours?: Prisma.Decimal | null;
  expectedLifespanUnit?: string | null;
  salvageValue?: Prisma.Decimal | null;
  wattsPerOperatingHour?: Prisma.Decimal | null;
  electricityCostPerKwhOverride?: Prisma.Decimal | null;
  consumables?: EquipmentConsumableForCosting[];
};

function hourlyRateMode(equipment: EquipmentForCosting): string {
  return equipment.hourlyRateMode === "calculated" ? "calculated" : "manual";
}

function perUseCostMode(equipment: EquipmentForCosting): string {
  return equipment.perUseCostMode === "calculated" ? "calculated" : "manual";
}

function ratePerConsumableUse(consumable: EquipmentConsumableForCosting): Prisma.Decimal {
  if (consumable.status !== "active" || consumable.lifespanQuantity.lte(ZERO)) {
    return ZERO;
  }
  return consumable.replacementCost.div(consumable.lifespanQuantity);
}

function computeDepreciationRate(equipment: EquipmentForCosting): Prisma.Decimal {
  const acquisitionCost = equipment.acquisitionCost ?? equipment.equipmentCost;
  if (!acquisitionCost || !equipment.expectedLifespanHours || equipment.expectedLifespanHours.lte(ZERO)) {
    return ZERO;
  }

  const depreciableCost = acquisitionCost.sub(equipment.salvageValue ?? ZERO);
  if (depreciableCost.lte(ZERO)) {
    return ZERO;
  }

  return depreciableCost.div(equipment.expectedLifespanHours);
}

function computeElectricityHourlyRate(
  equipment: EquipmentForCosting,
  defaultElectricityCostPerKwh: Prisma.Decimal | null | undefined,
): Prisma.Decimal {
  const costPerKwh = equipment.electricityCostPerKwhOverride ?? defaultElectricityCostPerKwh;
  if (!equipment.wattsPerOperatingHour || !costPerKwh) {
    return ZERO;
  }

  return equipment.wattsPerOperatingHour.div(1000).mul(costPerKwh);
}

function computeEquipmentComponentRates(
  equipment: EquipmentForCosting,
  defaultElectricityCostPerKwh: Prisma.Decimal | null | undefined,
): {
  hourlyRate: Prisma.Decimal | null;
  perUseCost: Prisma.Decimal | null;
  electricityHourlyRate: Prisma.Decimal;
  depreciationHourlyRate: Prisma.Decimal;
  depreciationPerUseCost: Prisma.Decimal;
  hourlyConsumableRates: Array<{ consumable: EquipmentConsumableForCosting; rate: Prisma.Decimal }>;
  perUseConsumableRates: Array<{ consumable: EquipmentConsumableForCosting; rate: Prisma.Decimal }>;
} {
  const electricityHourlyRate = computeElectricityHourlyRate(equipment, defaultElectricityCostPerKwh);
  const depreciationRate = computeDepreciationRate(equipment);
  const depreciationUnit = equipment.expectedLifespanUnit === "uses" ? "uses" : "hours";
  const depreciationHourlyRate = depreciationUnit === "hours" ? depreciationRate : ZERO;
  const depreciationPerUseCost = depreciationUnit === "uses" ? depreciationRate : ZERO;
  const hourlyConsumableRates = (equipment.consumables ?? [])
    .filter((consumable) => consumable.lifespanUnit === "hours")
    .map((consumable) => ({ consumable, rate: ratePerConsumableUse(consumable) }))
    .filter((line) => line.rate.gt(ZERO));
  const perUseConsumableRates = (equipment.consumables ?? [])
    .filter((consumable) => consumable.lifespanUnit === "uses")
    .map((consumable) => ({ consumable, rate: ratePerConsumableUse(consumable) }))
    .filter((line) => line.rate.gt(ZERO));

  const calculatedHourlyRate = hourlyConsumableRates
    .reduce((sum, line) => sum.add(line.rate), ZERO)
    .add(electricityHourlyRate)
    .add(depreciationHourlyRate);
  const calculatedPerUseCost = perUseConsumableRates
    .reduce((sum, line) => sum.add(line.rate), ZERO)
    .add(depreciationPerUseCost);

  return {
    hourlyRate: hourlyRateMode(equipment) === "calculated" ? calculatedHourlyRate : equipment.hourlyRate,
    perUseCost: perUseCostMode(equipment) === "calculated" ? calculatedPerUseCost : equipment.perUseCost,
    electricityHourlyRate,
    depreciationHourlyRate,
    depreciationPerUseCost,
    hourlyConsumableRates,
    perUseConsumableRates,
  };
}

export function resolveEquipmentEffectiveRates(
  equipment: EquipmentForCosting,
  defaultElectricityCostPerKwh: Prisma.Decimal | null | undefined,
): {
  hourlyRate: Prisma.Decimal | null;
  perUseCost: Prisma.Decimal | null;
} {
  const rates = computeEquipmentComponentRates(equipment, defaultElectricityCostPerKwh);
  return {
    hourlyRate: rates.hourlyRate,
    perUseCost: rates.perUseCost,
  };
}

function computeEquipmentComponentBreakdown(params: {
  equipment: EquipmentForCosting;
  componentRates: ReturnType<typeof computeEquipmentComponentRates>;
  usageMode: string;
  minutes: Prisma.Decimal | null;
  uses: Prisma.Decimal | null;
  yieldDurationMinutes: Prisma.Decimal | null;
  yieldUses: Prisma.Decimal | null;
  yieldQuantity: Prisma.Decimal | null;
}): {
  componentCosts: ResolvedEquipmentComponentCosts;
  consumableLines: ResolvedEquipmentConsumableLine[];
} {
  const {
    equipment,
    componentRates,
    usageMode,
    minutes,
    uses,
    yieldDurationMinutes,
    yieldUses,
    yieldQuantity,
  } = params;
  const electricityCost =
    hourlyRateMode(equipment) === "calculated"
      ? computeEquipmentLineCost({
          hourlyRate: componentRates.electricityHourlyRate,
          perUseCost: null,
          usageMode,
          minutes,
          uses: null,
          yieldDurationMinutes,
          yieldUses: null,
          yieldQuantity,
        })
      : ZERO;
  const depreciationCost =
    hourlyRateMode(equipment) === "calculated" || perUseCostMode(equipment) === "calculated"
      ? computeEquipmentLineCost({
          hourlyRate: hourlyRateMode(equipment) === "calculated" ? componentRates.depreciationHourlyRate : null,
          perUseCost: perUseCostMode(equipment) === "calculated" ? componentRates.depreciationPerUseCost : null,
          usageMode,
          minutes,
          uses,
          yieldDurationMinutes: hourlyRateMode(equipment) === "calculated" ? yieldDurationMinutes : null,
          yieldUses: perUseCostMode(equipment) === "calculated" ? yieldUses : null,
          yieldQuantity,
        })
      : ZERO;

  const hourlyConsumableLines =
    hourlyRateMode(equipment) === "calculated"
      ? componentRates.hourlyConsumableRates.map((line) => ({
          consumableId: line.consumable.id,
          name: line.consumable.name,
          lifespanUnit: line.consumable.lifespanUnit,
          lineCost: computeEquipmentLineCost({
            hourlyRate: line.rate,
            perUseCost: null,
            usageMode,
            minutes,
            uses: null,
            yieldDurationMinutes,
            yieldUses: null,
            yieldQuantity,
          }),
        }))
      : [];
  const perUseConsumableLines =
    perUseCostMode(equipment) === "calculated"
      ? componentRates.perUseConsumableRates.map((line) => ({
          consumableId: line.consumable.id,
          name: line.consumable.name,
          lifespanUnit: line.consumable.lifespanUnit,
          lineCost: computeEquipmentLineCost({
            hourlyRate: null,
            perUseCost: line.rate,
            usageMode,
            minutes: null,
            uses,
            yieldDurationMinutes: null,
            yieldUses,
            yieldQuantity,
          }),
        }))
      : [];

  const consumableLines = [...hourlyConsumableLines, ...perUseConsumableLines].filter((line) =>
    line.lineCost.gt(ZERO),
  );
  const consumablesCost = consumableLines.reduce((sum, line) => sum.add(line.lineCost), ZERO);
  const manualOverrideCost = computeEquipmentLineCost({
    hourlyRate: hourlyRateMode(equipment) === "manual" ? equipment.hourlyRate : null,
    perUseCost: perUseCostMode(equipment) === "manual" ? equipment.perUseCost : null,
    usageMode,
    minutes,
    uses,
    yieldDurationMinutes,
    yieldUses,
    yieldQuantity,
  });

  return {
    componentCosts: {
      electricityCost,
      depreciationCost,
      consumablesCost,
      maintenanceCost: ZERO,
      manualOverrideCost,
    },
    consumableLines,
  };
}

async function resolvePodCosts(
  shopId: string,
  variantId: string,
  db: PrismaClient,
): Promise<PodCostResolution> {
  const mappings = await db.providerVariantMapping.findMany({
    where: {
      shopId,
      variantId,
    },
    include: {
      connection: {
        select: {
          status: true,
        },
      },
      costLines: {
        orderBy: [{ syncedAt: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  const activeMappings = mappings.filter(
    (mapping) =>
      mapping.connection.status === "validated" &&
      mapping.status !== "inactive" &&
      Boolean(mapping.providerVariantId),
  );

  const podLines: ResolvedPodLine[] = [];
  let podCostMissing = false;

  for (const mapping of activeMappings) {
    const latestSyncedAt = mapping.costLines[0]?.syncedAt;
    if (!latestSyncedAt) {
      podCostMissing = true;
      continue;
    }

    const latestLines = mapping.costLines.filter(
      (line) => line.syncedAt.getTime() === latestSyncedAt.getTime(),
    );

    if (latestLines.length === 0) {
      podCostMissing = true;
      continue;
    }

    for (const line of latestLines) {
      podLines.push({
        provider: mapping.provider,
        costLineType: line.costLineType,
        description: line.description ?? null,
        amount: line.amount,
        currency: line.currency,
      });
    }
  }

  const podCost = podLines.reduce((sum, line) => sum.add(line.amount), ZERO);

  return {
    podCost,
    podLines,
    podCostEstimated: podLines.length > 0,
    podCostMissing,
  };
}

export async function resolveCosts(
  shopId: string,
  variantId: string,
  salePrice: Prisma.Decimal,
  mode: CostEngineMode,
  db: PrismaClient,
  packagingCostOverride?: Prisma.Decimal,
  podCostOverride?: PodCostResolution,
): Promise<CostResult> {
  // Step 1: Load VariantCostConfig with all lines and library items
  const config = await db.variantCostConfig.findUnique({
    where: { variantId, shopId },
    include: {
      productionTemplate: {
        include: {
          defaultShippingTemplate: {
            include: {
              materialLines: { include: { material: true } },
              equipmentLines: { include: { equipment: { include: { consumables: true } } } },
            },
          },
          materialLines: { include: { material: true } },
          equipmentLines: { include: { equipment: { include: { consumables: true } } } },
        },
      },
      shippingTemplate: {
        include: {
          materialLines: { include: { material: true } },
          equipmentLines: { include: { equipment: { include: { consumables: true } } } },
        },
      },
      materialLines: { include: { material: true, templateLine: true } },
      equipmentLines: { include: { equipment: { include: { consumables: true } }, templateLine: true } },
    },
  });
  const {
    podCost,
    podLines,
    podCostEstimated,
    podCostMissing,
  } = podCostOverride ?? await resolvePodCosts(shopId, variantId, db);
  // No config — return all zeros (valid, not configured yet)
  if (!config) {
    const totalCost = podCost;
    return {
      laborCost: ZERO,
      materialCost: ZERO,
      packagingCost: ZERO,
      equipmentCost: ZERO,
      mistakeBufferAmount: ZERO,
      podCost,
      podLines,
      podCostEstimated,
      podCostMissing,
      totalCost,
      materialLines: [],
      equipmentLines: [],
      ...(mode === "snapshot" ? { netContribution: salePrice.sub(totalCost) } : {}),
    };
  }

  // Step 2: Load shop defaults
  const shop = await db.shop.findUnique({
    where: { shopId },
    select: { mistakeBuffer: true, defaultLaborRate: true, defaultElectricityCostPerKwh: true },
  });

  const productionTemplate = config.productionTemplate;
  const effectiveShippingTemplate =
    config.shippingTemplate ?? productionTemplate?.defaultShippingTemplate ?? null;

  // Step 3: Merge material lines — variant overrides take precedence over template
  // Build a map from materialId → variant override line
  const templateMaterialLines = productionTemplate?.materialLines ?? [];
  const shippingTemplateMaterialLines = effectiveShippingTemplate?.materialLines ?? [];
  const explicitMaterialOverrideMap = new Map(
    config.materialLines
      .filter((line) => line.templateLineId)
      .map((line) => [line.templateLineId as string, line]),
  );
  const templateMaterialIds = new Set(templateMaterialLines.map((line) => line.materialId));
  const materialIdTemplateCounts = new Map<string, number>();

  for (const line of templateMaterialLines) {
    materialIdTemplateCounts.set(
      line.materialId,
      (materialIdTemplateCounts.get(line.materialId) ?? 0) + 1,
    );
  }

  const legacyMaterialOverrides = new Map(
    config.materialLines
      .filter(
        (line) =>
          !line.templateLineId &&
          templateMaterialIds.has(line.materialId) &&
          (materialIdTemplateCounts.get(line.materialId) ?? 0) === 1,
      )
      .map((line) => [line.materialId, line]),
  );
  const consumedVariantMaterialLineIds = new Set<string>();
  const allMaterialLines: Array<{
    materialId: string;
    material: (typeof config.materialLines)[0]["material"];
    yield_: Prisma.Decimal | null;
    quantity: Prisma.Decimal;
    usesPerVariant: Prisma.Decimal | null;
  }> = [];

  for (const tl of templateMaterialLines) {
    const explicitOverride = explicitMaterialOverrideMap.get(tl.id);
    const legacyOverride = explicitOverride ? null : legacyMaterialOverrides.get(tl.materialId);
    const override = explicitOverride ?? legacyOverride;
    const assignmentYield =
      !override && tl.material.costingModel === "yield"
        ? config.templateProductYield
        : null;
    allMaterialLines.push({
      materialId: tl.materialId,
      material: override?.material ?? tl.material,
      yield_: override?.yield ?? assignmentYield ?? tl.yield,
      quantity: override?.quantity ?? tl.quantity,
      usesPerVariant: override?.usesPerVariant ?? tl.usesPerVariant,
    });
    if (override) consumedVariantMaterialLineIds.add(override.id);
  }

  for (const tl of shippingTemplateMaterialLines) {
    allMaterialLines.push({
      materialId: tl.materialId,
      material: tl.material,
      yield_: tl.yield,
      quantity: tl.quantity,
      usesPerVariant: tl.usesPerVariant,
    });
  }

  // Add variant-only lines (not in template)
  for (const vl of config.materialLines) {
    if (!consumedVariantMaterialLineIds.has(vl.id) && !vl.templateLineId) {
      allMaterialLines.push({
        materialId: vl.materialId,
        material: vl.material,
        yield_: vl.yield,
        quantity: vl.quantity,
        usesPerVariant: vl.usesPerVariant,
      });
    }
  }

  // Resolve material line costs
  const resolvedMaterialLines: ResolvedMaterialLine[] = allMaterialLines.map((l) => {
    const lineCost = computeMaterialLineCost({
      type: l.material.type,
      costingModel: l.material.costingModel,
      purchasePrice: l.material.purchasePrice,
      purchaseQty: l.material.purchaseQty,
      totalUsesPerUnit: l.material.totalUsesPerUnit,
      yield_: l.yield_,
      quantity: l.quantity,
      usesPerVariant: l.usesPerVariant,
    });

    const line: ResolvedMaterialLine = {
      materialId: l.materialId,
      name: l.material.name,
      type: l.material.type,
      costingModel: l.material.costingModel,
      quantity: l.quantity,
      yield: l.yield_,
      usesPerVariant: l.usesPerVariant,
      lineCost,
      unitDescription: l.material.unitDescription ?? null,
      purchaseLink: l.material.purchaseLink ?? null,
      totalUsesPerUnit: l.material.totalUsesPerUnit,
    };

    line.purchasePrice = l.material.purchasePrice;
    line.purchaseQty = l.material.purchaseQty;
    line.perUnitCost = l.material.perUnitCost;

    return line;
  });

  // Step 3 (continued): Merge equipment lines
  const templateEquipmentLines = productionTemplate?.equipmentLines ?? [];
  const explicitEquipmentOverrideMap = new Map(
    config.equipmentLines
      .filter((line) => line.templateLineId)
      .map((line) => [line.templateLineId as string, line]),
  );
  const templateEquipmentIds = new Set(templateEquipmentLines.map((line) => line.equipmentId));
  const equipmentIdTemplateCounts = new Map<string, number>();

  for (const line of templateEquipmentLines) {
    equipmentIdTemplateCounts.set(
      line.equipmentId,
      (equipmentIdTemplateCounts.get(line.equipmentId) ?? 0) + 1,
    );
  }

  const legacyEquipmentOverrides = new Map(
    config.equipmentLines
      .filter(
        (line) =>
          !line.templateLineId &&
          templateEquipmentIds.has(line.equipmentId) &&
          (equipmentIdTemplateCounts.get(line.equipmentId) ?? 0) === 1,
      )
      .map((line) => [line.equipmentId, line]),
  );
  const consumedVariantEquipmentLineIds = new Set<string>();
  const allEquipmentLines: Array<{
    equipmentId: string;
    equipment: (typeof config.equipmentLines)[0]["equipment"];
    usageMode: string;
    minutes: Prisma.Decimal | null;
    uses: Prisma.Decimal | null;
    yieldDurationMinutes: Prisma.Decimal | null;
    yieldUses: Prisma.Decimal | null;
    yieldQuantity: Prisma.Decimal | null;
  }> = [];

  for (const tl of templateEquipmentLines) {
    const explicitOverride = explicitEquipmentOverrideMap.get(tl.id);
    const legacyOverride = explicitOverride ? null : legacyEquipmentOverrides.get(tl.equipmentId);
    const override = explicitOverride ?? legacyOverride;
    const effectiveUsageMode = override?.usageMode ?? tl.usageMode;
    const assignmentYieldQuantity =
      !override && (effectiveUsageMode === "duration_yield" || effectiveUsageMode === "use_yield")
        ? config.templateProductYield
        : null;
    allEquipmentLines.push({
      equipmentId: tl.equipmentId,
      equipment: override?.equipment ?? tl.equipment,
      usageMode: effectiveUsageMode,
      minutes: override?.minutes ?? tl.minutes,
      uses: override?.uses ?? tl.uses,
      yieldDurationMinutes: override?.yieldDurationMinutes ?? tl.yieldDurationMinutes,
      yieldUses: override?.yieldUses ?? tl.yieldUses,
      yieldQuantity: override?.yieldQuantity ?? assignmentYieldQuantity ?? tl.yieldQuantity,
    });
    if (override) consumedVariantEquipmentLineIds.add(override.id);
  }

  for (const vl of config.equipmentLines) {
    if (!consumedVariantEquipmentLineIds.has(vl.id) && !vl.templateLineId) {
      allEquipmentLines.push({
        equipmentId: vl.equipmentId,
        equipment: vl.equipment,
        usageMode: vl.usageMode,
        minutes: vl.minutes,
        uses: vl.uses,
        yieldDurationMinutes: vl.yieldDurationMinutes,
        yieldUses: vl.yieldUses,
        yieldQuantity: vl.yieldQuantity,
      });
    }
  }

  const resolvedEquipmentLines: ResolvedEquipmentLine[] = allEquipmentLines.map((l) => {
    const componentRates = computeEquipmentComponentRates(
      l.equipment,
      shop?.defaultElectricityCostPerKwh,
    );
    const lineCost = computeEquipmentLineCost({
      hourlyRate: componentRates.hourlyRate,
      perUseCost: componentRates.perUseCost,
      usageMode: l.usageMode,
      minutes: l.minutes,
      uses: l.uses,
      yieldDurationMinutes: l.yieldDurationMinutes,
      yieldUses: l.yieldUses,
      yieldQuantity: l.yieldQuantity,
    });
    const { componentCosts, consumableLines } = computeEquipmentComponentBreakdown({
      equipment: l.equipment,
      componentRates,
      usageMode: l.usageMode,
      minutes: l.minutes,
      uses: l.uses,
      yieldDurationMinutes: l.yieldDurationMinutes,
      yieldUses: l.yieldUses,
      yieldQuantity: l.yieldQuantity,
    });

    const line: ResolvedEquipmentLine = {
      equipmentId: l.equipmentId,
      name: l.equipment.name,
      usageMode: l.usageMode,
      minutes: l.minutes,
      uses: l.uses,
      yieldDurationMinutes: l.yieldDurationMinutes,
      yieldUses: l.yieldUses,
      yieldQuantity: l.yieldQuantity,
      lineCost,
      purchaseLink: l.equipment.purchaseLink ?? null,
    };

    line.hourlyRate = componentRates.hourlyRate;
    line.perUseCost = componentRates.perUseCost;
    line.hourlyRateMode = hourlyRateMode(l.equipment);
    line.perUseCostMode = perUseCostMode(l.equipment);
    line.componentCosts = componentCosts;
    line.consumableLines = consumableLines;

    return line;
  });

  // Step 5: Packaging preview — sum shipping material lines.
  const shippingLineCosts = resolvedMaterialLines
    .filter((l) => l.type === "shipping")
    .map((l) => l.lineCost);

  const computedPackagingCost =
    shippingLineCosts.length > 0
      ? shippingLineCosts.reduce((sum, c) => sum.add(c), ZERO)
      : ZERO;

  const packagingCost =
    mode === "snapshot" && packagingCostOverride !== undefined
      ? packagingCostOverride
      : computedPackagingCost;

  // Production material cost = sum of production lines only
  const productionLineCosts = resolvedMaterialLines
    .filter((l) => l.type === "production")
    .map((l) => l.lineCost);

  const materialCost = productionLineCosts.reduce((sum, c) => sum.add(c), ZERO);

  // Equipment cost
  const equipmentCost = resolvedEquipmentLines.reduce(
    (sum, l) => sum.add(l.lineCost),
    ZERO,
  );

  // Step 6: Mistake buffer — applied to production materials only
  const mistakeBufferPct = decimalOrZero(config.mistakeBuffer ?? shop?.mistakeBuffer);
  const mistakeBufferAmount = materialCost.mul(mistakeBufferPct);

  const laborMinutes = config.laborMinutes ?? productionTemplate?.defaultLaborMinutes;
  const laborRate = config.laborRate ?? productionTemplate?.defaultLaborRate ?? shop?.defaultLaborRate;

  // Labor cost
  const laborCost =
    laborMinutes && laborRate
      ? laborRate.mul(laborMinutes).div(60)
      : ZERO;

  // Step 7: Return materialised cost structure
  const totalCost = laborCost
    .add(materialCost)
    .add(packagingCost)
    .add(equipmentCost)
    .add(mistakeBufferAmount)
    .add(podCost);

  const result: CostResult = {
    laborCost,
    materialCost,
    packagingCost,
    equipmentCost,
    mistakeBufferAmount,
    podCost,
    podLines,
    podCostEstimated,
    podCostMissing,
    totalCost,
    materialLines: resolvedMaterialLines,
    equipmentLines: resolvedEquipmentLines,
  };

  if (mode === "snapshot") {
    result.netContribution = salePrice.sub(totalCost);
  }

  return result;
}
