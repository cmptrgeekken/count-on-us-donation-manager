/**
 * CostEngine — pure cost resolution function (ADR-003).
 *
 * Rules:
 * - No DB writes. No internal state. No caching.
 * - Accepts a Prisma client to allow callers to pass a transaction client.
 * - Returns a fully materialised cost structure.
 * - "snapshot" mode: includes netContribution and raw library values.
 * - "preview" mode: display-safe — omits netContribution, purchasePrice, perUnitCost.
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
  // snapshot mode only:
  purchasePrice?: Prisma.Decimal;
  purchaseQty?: Prisma.Decimal;
  perUnitCost?: Prisma.Decimal;
};

export type ResolvedEquipmentLine = {
  equipmentId: string;
  name: string;
  minutes: Prisma.Decimal | null;
  uses: Prisma.Decimal | null;
  lineCost: Prisma.Decimal;
  // snapshot mode only:
  hourlyRate?: Prisma.Decimal | null;
  perUseCost?: Prisma.Decimal | null;
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
  packagingCost: Prisma.Decimal;     // max shipping material line (ADR-003 packaging rule)
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
 * Yield-based:  (purchasePrice / purchaseQty / yield) * quantity
 * Uses-based:   (purchasePrice / purchaseQty / totalUsesPerUnit) * usesPerVariant
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
 * (hourlyRate * minutes / 60) + (perUseCost * uses)
 */
function computeEquipmentLineCost(params: {
  hourlyRate: Prisma.Decimal | null;
  perUseCost: Prisma.Decimal | null;
  minutes: Prisma.Decimal | null;
  uses: Prisma.Decimal | null;
}): Prisma.Decimal {
  const { hourlyRate, perUseCost, minutes, uses } = params;
  let cost = ZERO;

  if (hourlyRate && minutes) {
    cost = cost.add(hourlyRate.mul(minutes).div(60));
  }
  if (perUseCost && uses) {
    cost = cost.add(perUseCost.mul(uses));
  }

  return cost;
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
              equipmentLines: { include: { equipment: true } },
            },
          },
          materialLines: { include: { material: true } },
          equipmentLines: { include: { equipment: true } },
        },
      },
      shippingTemplate: {
        include: {
          materialLines: { include: { material: true } },
          equipmentLines: { include: { equipment: true } },
        },
      },
      materialLines: { include: { material: true, templateLine: true } },
      equipmentLines: { include: { equipment: true, templateLine: true } },
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

  // Step 2: Load shop mistake buffer fallback
  const shop = await db.shop.findUnique({
    where: { shopId },
    select: { mistakeBuffer: true, defaultLaborRate: true },
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
    allMaterialLines.push({
      materialId: tl.materialId,
      material: override?.material ?? tl.material,
      yield_: override?.yield ?? tl.yield,
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
    };

    if (mode === "snapshot") {
      line.purchasePrice = l.material.purchasePrice;
      line.purchaseQty = l.material.purchaseQty;
      line.perUnitCost = l.material.perUnitCost;
    }

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
    minutes: Prisma.Decimal | null;
    uses: Prisma.Decimal | null;
  }> = [];

  for (const tl of templateEquipmentLines) {
    const explicitOverride = explicitEquipmentOverrideMap.get(tl.id);
    const legacyOverride = explicitOverride ? null : legacyEquipmentOverrides.get(tl.equipmentId);
    const override = explicitOverride ?? legacyOverride;
    allEquipmentLines.push({
      equipmentId: tl.equipmentId,
      equipment: override?.equipment ?? tl.equipment,
      minutes: override?.minutes ?? tl.minutes,
      uses: override?.uses ?? tl.uses,
    });
    if (override) consumedVariantEquipmentLineIds.add(override.id);
  }

  for (const vl of config.equipmentLines) {
    if (!consumedVariantEquipmentLineIds.has(vl.id) && !vl.templateLineId) {
      allEquipmentLines.push({
        equipmentId: vl.equipmentId,
        equipment: vl.equipment,
        minutes: vl.minutes,
        uses: vl.uses,
      });
    }
  }

  const resolvedEquipmentLines: ResolvedEquipmentLine[] = allEquipmentLines.map((l) => {
    const lineCost = computeEquipmentLineCost({
      hourlyRate: l.equipment.hourlyRate,
      perUseCost: l.equipment.perUseCost,
      minutes: l.minutes,
      uses: l.uses,
    });

    const line: ResolvedEquipmentLine = {
      equipmentId: l.equipmentId,
      name: l.equipment.name,
      minutes: l.minutes,
      uses: l.uses,
      lineCost,
    };

    if (mode === "snapshot") {
      line.hourlyRate = l.equipment.hourlyRate;
      line.perUseCost = l.equipment.perUseCost;
    }

    return line;
  });

  // Step 5: Packaging rule — max cost among shipping material lines (ADR-003)
  const shippingLineCosts = resolvedMaterialLines
    .filter((l) => l.type === "shipping")
    .map((l) => l.lineCost);

  const computedPackagingCost =
    shippingLineCosts.length > 0
      ? shippingLineCosts.reduce((max, c) => (c.gt(max) ? c : max), ZERO)
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

  const laborRate = config.laborRate ?? shop?.defaultLaborRate;

  // Labor cost
  const laborCost =
    config.laborMinutes && laborRate
      ? laborRate.mul(config.laborMinutes).div(60)
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
