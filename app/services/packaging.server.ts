import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { recomputeTaxOffsetCache } from "./taxOffsetCache.server";

const ZERO = new Prisma.Decimal(0);
const REVIEW_DELTA_THRESHOLD = new Prisma.Decimal("0.50");

type PackageMaterialLine = {
  quantity: Prisma.Decimal;
  material: {
    perUnitCost: Prisma.Decimal;
  };
};

type PackageCandidate = {
  id: string;
  name: string;
  length: Prisma.Decimal;
  width: Prisma.Decimal;
  height: Prisma.Decimal;
  emptyWeightGrams: Prisma.Decimal | null;
  maxWeightGrams: Prisma.Decimal | null;
  materialLines: PackageMaterialLine[];
};

type VariantShippingConfig = {
  variantId: string;
  preferredPackageId: string | null;
  packedLength: Prisma.Decimal | null;
  packedWidth: Prisma.Decimal | null;
  packedHeight: Prisma.Decimal | null;
  packedWeightGrams: Prisma.Decimal | null;
  canSharePackage: boolean;
};

type SnapshotPackagingLine = {
  id: string;
  variantId: string | null;
  quantity: number;
  subtotal: Prisma.Decimal;
  packagingCost: Prisma.Decimal;
};

type PackedUnit = {
  lineId: string;
  variantId: string | null;
  length: Prisma.Decimal | null;
  width: Prisma.Decimal | null;
  height: Prisma.Decimal | null;
  weightGrams: Prisma.Decimal;
  canSharePackage: boolean;
  preferredPackageId: string | null;
};

type PackedBox = {
  package: PackageCandidate;
  units: PackedUnit[];
  usedVolume: Prisma.Decimal;
  usedWeight: Prisma.Decimal;
  confidence: "high" | "low";
  reason: string | null;
};

export type PackagingCartonizationResult = {
  allocations: Array<{
    packageId: string;
    packageName: string;
    quantity: number;
    materialCost: Prisma.Decimal;
    confidence: "high" | "low";
    reason: string | null;
  }>;
  totalMaterialCost: Prisma.Decimal;
  reviewReasons: string[];
};

function packageVolume(pkg: Pick<PackageCandidate, "length" | "width" | "height">) {
  return pkg.length.mul(pkg.width).mul(pkg.height);
}

function unitVolume(unit: Pick<PackedUnit, "length" | "width" | "height">) {
  if (!unit.length || !unit.width || !unit.height) return null;
  return unit.length.mul(unit.width).mul(unit.height);
}

export function calculatePackageMaterialCost(pkg: { materialLines: PackageMaterialLine[] }) {
  return pkg.materialLines.reduce(
    (sum, line) => sum.add(line.material.perUnitCost.mul(line.quantity)),
    ZERO,
  );
}

function fitsDimensions(unit: PackedUnit, pkg: PackageCandidate) {
  if (!unit.length || !unit.width || !unit.height) return false;
  const unitDims = [unit.length, unit.width, unit.height].sort((a, b) => a.comparedTo(b));
  const packageDims = [pkg.length, pkg.width, pkg.height].sort((a, b) => a.comparedTo(b));
  return unitDims.every((dim, index) => dim.lte(packageDims[index]!));
}

function fitsWeight(currentWeight: Prisma.Decimal, unit: PackedUnit, pkg: PackageCandidate) {
  if (!pkg.maxWeightGrams) return true;
  const emptyWeight = pkg.emptyWeightGrams ?? ZERO;
  return emptyWeight.add(currentWeight).add(unit.weightGrams).lte(pkg.maxWeightGrams);
}

function canAddToBox(box: PackedBox, unit: PackedUnit) {
  if (!unit.canSharePackage || !fitsDimensions(unit, box.package)) return false;
  const volume = unitVolume(unit);
  if (!volume) return false;
  return box.usedVolume.add(volume).lte(packageVolume(box.package)) && fitsWeight(box.usedWeight, unit, box.package);
}

function chooseSmallestFittingPackage(unit: PackedUnit, packages: PackageCandidate[]) {
  const preferred = unit.preferredPackageId
    ? packages.find((pkg) => pkg.id === unit.preferredPackageId && fitsDimensions(unit, pkg) && fitsWeight(ZERO, unit, pkg))
    : null;
  if (preferred) return preferred;

  return packages
    .filter((pkg) => fitsDimensions(unit, pkg) && fitsWeight(ZERO, unit, pkg))
    .sort((a, b) => packageVolume(a).comparedTo(packageVolume(b)))[0] ?? null;
}

function chooseFallbackPackage(unit: PackedUnit, packages: PackageCandidate[]) {
  if (unit.preferredPackageId) {
    const preferred = packages.find((pkg) => pkg.id === unit.preferredPackageId);
    if (preferred) return preferred;
  }
  return packages.sort((a, b) => packageVolume(a).comparedTo(packageVolume(b)))[0] ?? null;
}

function buildUnits(lines: SnapshotPackagingLine[], configs: Map<string, VariantShippingConfig>) {
  const units: PackedUnit[] = [];
  const reviewReasons = new Set<string>();

  for (const line of lines) {
    const config = line.variantId ? configs.get(line.variantId) : null;
    if (!config) {
      reviewReasons.add("missing_variant_shipping_profile");
    }

    const hasDimensions = Boolean(config?.packedLength && config?.packedWidth && config?.packedHeight);
    if (!hasDimensions) {
      reviewReasons.add("missing_variant_dimensions");
    }

    for (let index = 0; index < line.quantity; index += 1) {
      units.push({
        lineId: line.id,
        variantId: line.variantId,
        length: config?.packedLength ?? null,
        width: config?.packedWidth ?? null,
        height: config?.packedHeight ?? null,
        weightGrams: config?.packedWeightGrams ?? ZERO,
        canSharePackage: config?.canSharePackage ?? true,
        preferredPackageId: config?.preferredPackageId ?? null,
      });
    }
  }

  return {
    units: units.sort((a, b) => (unitVolume(b) ?? ZERO).comparedTo(unitVolume(a) ?? ZERO)),
    reviewReasons,
  };
}

export async function cartonizeOrderPackaging(
  shopId: string,
  lines: SnapshotPackagingLine[],
  db: any,
): Promise<PackagingCartonizationResult> {
  const variantIds = [...new Set(lines.map((line) => line.variantId).filter((id): id is string => Boolean(id)))];
  const [packages, configs] = await Promise.all([
    db.shippingPackage?.findMany
      ? db.shippingPackage.findMany({
          where: { shopId, status: "active" },
          include: {
            materialLines: {
              include: {
                material: {
                  select: { perUnitCost: true },
                },
              },
            },
          },
        })
      : [],
    variantIds.length > 0 && db.variantCostConfig?.findMany
      ? db.variantCostConfig.findMany({
          where: { shopId, variantId: { in: variantIds } },
          select: {
            variantId: true,
            preferredPackageId: true,
            packedLength: true,
            packedWidth: true,
            packedHeight: true,
            packedWeightGrams: true,
            canSharePackage: true,
          },
        })
      : [],
  ]);

  if (packages.length === 0) {
    return {
      allocations: [],
      totalMaterialCost: ZERO,
      reviewReasons: ["no_active_packages"],
    };
  }

  const configByVariantId = new Map<string, VariantShippingConfig>(
    configs.map((config: VariantShippingConfig) => [config.variantId, config]),
  );
  const { units, reviewReasons } = buildUnits(lines, configByVariantId);
  const boxes: PackedBox[] = [];

  for (const unit of units) {
    const hasDimensions = Boolean(unit.length && unit.width && unit.height);
    if (!hasDimensions) {
      const fallback = chooseFallbackPackage(unit, packages);
      if (!fallback) {
        reviewReasons.add("no_fallback_package");
        continue;
      }
      boxes.push({
        package: fallback,
        units: [unit],
        usedVolume: ZERO,
        usedWeight: unit.weightGrams,
        confidence: "low",
        reason: "Missing variant dimensions; used preferred/default package.",
      });
      continue;
    }

    const existingBox = unit.canSharePackage ? boxes.find((box) => box.confidence === "high" && canAddToBox(box, unit)) : null;
    if (existingBox) {
      existingBox.units.push(unit);
      existingBox.usedVolume = existingBox.usedVolume.add(unitVolume(unit) ?? ZERO);
      existingBox.usedWeight = existingBox.usedWeight.add(unit.weightGrams);
      continue;
    }

    const selectedPackage = chooseSmallestFittingPackage(unit, packages);
    if (!selectedPackage) {
      const fallback = chooseFallbackPackage(unit, packages);
      if (!fallback) {
        reviewReasons.add("no_fitting_package");
        continue;
      }
      reviewReasons.add("no_fitting_package");
      boxes.push({
        package: fallback,
        units: [unit],
        usedVolume: unitVolume(unit) ?? ZERO,
        usedWeight: unit.weightGrams,
        confidence: "low",
        reason: "No package fit the configured item dimensions; used preferred/default package.",
      });
      continue;
    }

    boxes.push({
      package: selectedPackage,
      units: [unit],
      usedVolume: unitVolume(unit) ?? ZERO,
      usedWeight: unit.weightGrams,
      confidence: "high",
      reason: null,
    });
  }

  if (boxes.length > 1) {
    reviewReasons.add("multiple_packages");
  }
  if (boxes.some((box) => box.confidence === "low")) {
    reviewReasons.add("low_confidence_allocation");
  }

  const grouped = new Map<string, PackagingCartonizationResult["allocations"][number]>();
  for (const box of boxes) {
    const unitCost = calculatePackageMaterialCost(box.package);
    const key = `${box.package.id}:${box.confidence}:${box.reason ?? ""}`;
    const current = grouped.get(key);
    if (current) {
      current.quantity += 1;
      current.materialCost = current.materialCost.add(unitCost);
    } else {
      grouped.set(key, {
        packageId: box.package.id,
        packageName: box.package.name,
        quantity: 1,
        materialCost: unitCost,
        confidence: box.confidence,
        reason: box.reason,
      });
    }
  }

  const allocations = [...grouped.values()];
  return {
    allocations,
    totalMaterialCost: allocations.reduce((sum, allocation) => sum.add(allocation.materialCost), ZERO),
    reviewReasons: [...reviewReasons],
  };
}

function allocationSignature(allocation: PackagingCartonizationResult["allocations"][number]) {
  return createHash("sha256")
    .update([
      allocation.packageId,
      allocation.packageName,
      allocation.quantity,
      allocation.materialCost.toFixed(4),
      allocation.confidence,
      allocation.reason ?? "",
    ].join("|"))
    .digest("hex");
}

function buildReviewPayload(result: PackagingCartonizationResult, estimatedPackagingCost: Prisma.Decimal) {
  return {
    estimatedPackagingCost: estimatedPackagingCost.toFixed(4),
    actualPackagingCost: result.totalMaterialCost.toFixed(4),
    allocations: result.allocations.map((allocation) => ({
      packageId: allocation.packageId,
      packageName: allocation.packageName,
      quantity: allocation.quantity,
      materialCost: allocation.materialCost.toFixed(4),
      confidence: allocation.confidence,
      reason: allocation.reason,
    })),
    reviewReasons: result.reviewReasons,
  };
}

export async function reconcileSnapshotPackaging(
  shopId: string,
  snapshotId: string,
  lines: SnapshotPackagingLine[],
  db: any,
): Promise<PackagingCartonizationResult> {
  const result = await cartonizeOrderPackaging(shopId, lines, db);
  const estimatedPackagingCost = lines.reduce((sum, line) => sum.add(line.packagingCost), ZERO);
  const costDelta = result.totalMaterialCost.sub(estimatedPackagingCost);
  const snapshot = await db.orderSnapshot.findFirst({
    where: { id: snapshotId, shopId },
    select: { createdAt: true },
  });
  const coveringPeriod = snapshot
    ? await db.reportingPeriod.findFirst({
        where: {
          shopId,
          startDate: { lte: snapshot.createdAt },
          endDate: { gt: snapshot.createdAt },
        },
        select: { id: true, status: true },
      })
    : null;

  for (const allocation of result.allocations) {
    await db.orderPackageAllocation.upsert({
      where: {
        snapshotId_allocationSignature: {
          snapshotId,
          allocationSignature: allocationSignature(allocation),
        },
      },
      create: {
        shopId,
        snapshotId,
        packageId: allocation.packageId,
        packageName: allocation.packageName,
        quantity: allocation.quantity,
        materialCost: allocation.materialCost,
        source: "cartonization",
        confidence: allocation.confidence,
        reason: allocation.reason,
        allocationSignature: allocationSignature(allocation),
      },
      update: {},
    });
  }

  if (result.reviewReasons.length > 0 || costDelta.abs().gte(REVIEW_DELTA_THRESHOLD) || coveringPeriod?.status === "CLOSED") {
    await db.packagingReviewItem.create({
      data: {
        shopId,
        snapshotId,
        reason: coveringPeriod?.status === "CLOSED" ? "closed_period_true_up_required" : result.reviewReasons[0] ?? "packaging_cost_delta",
        severity: result.reviewReasons.includes("no_active_packages") || result.reviewReasons.includes("no_fitting_package") ? "high" : "medium",
        payload: buildReviewPayload(result, estimatedPackagingCost),
      },
    });
  }

  if (result.allocations.length === 0 || costDelta.equals(ZERO) || coveringPeriod?.status === "CLOSED") {
    return result;
  }

  const subtotalTotal = lines.reduce((sum, line) => sum.add(line.subtotal), ZERO);
  if (subtotalTotal.equals(ZERO)) {
    return result;
  }

  const adjustmentSignature = createHash("sha256")
    .update(`${snapshotId}:${result.totalMaterialCost.toFixed(4)}:${estimatedPackagingCost.toFixed(4)}`)
    .digest("hex");
  const existingAdjustment = await db.auditLog.findFirst({
    where: {
      shopId,
      entity: "Adjustment",
      entityId: adjustmentSignature,
      action: "PACKAGING_RECONCILIATION_PROCESSED",
    },
    select: { id: true },
  });
  if (existingAdjustment) {
    return result;
  }

  for (const line of lines) {
    const packagingAdj = costDelta.mul(line.subtotal).div(subtotalTotal);
    await db.adjustment.create({
      data: {
        shopId,
        snapshotLineId: line.id,
        type: "packaging_reconciliation",
        reason: "Automatic package cartonization",
        actor: "system",
        packagingAdj,
        netContribAdj: packagingAdj.neg(),
      },
    });
  }

  await recomputeTaxOffsetCache(shopId, db);

  await db.auditLog.create({
    data: {
      shopId,
      entity: "Adjustment",
      entityId: adjustmentSignature,
      action: "PACKAGING_RECONCILIATION_PROCESSED",
      actor: "system",
      payload: buildReviewPayload(result, estimatedPackagingCost),
    },
  });

  return result;
}
