import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import {
  resolveEligibleQuantity,
  type OrderLifecycleState,
} from "./orderLifecycle.server";

const ZERO = new Prisma.Decimal(0);
const BATCH_SIZE = 250;

export type ProductionUsageFilters = {
  startDate?: Date | null;
  endDateExclusive?: Date | null;
  origin?: "all" | "webhook" | "reconciliation" | "historical_import";
  search?: string | null;
};

type MaterialAggregate = {
  key: string;
  materialId: string | null;
  name: string;
  materialType: string;
  costingModels: Set<string>;
  purchaseUnits: Prisma.Decimal;
  portionUses: Prisma.Decimal;
  rawQuantity: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  incompleteQuantity: boolean;
  orderIds: Set<string>;
  latestAt: Date;
};

type ConsumableAggregate = {
  key: string;
  consumableId: string | null;
  name: string;
  lifespanUnits: Set<string>;
  totalCost: Prisma.Decimal;
};

type EquipmentAggregate = {
  key: string;
  equipmentId: string | null;
  name: string;
  minutes: Prisma.Decimal;
  uses: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  consumablesCost: Prisma.Decimal;
  electricityCost: Prisma.Decimal;
  depreciationCost: Prisma.Decimal;
  maintenanceCost: Prisma.Decimal;
  manualOverrideCost: Prisma.Decimal;
  incompleteUsage: boolean;
  orderIds: Set<string>;
  consumables: Map<string, ConsumableAggregate>;
  latestAt: Date;
};

type PackageAggregate = {
  key: string;
  name: string;
  quantity: Prisma.Decimal;
  materialCost: Prisma.Decimal;
  orderIds: Set<string>;
};

function materialKey(line: { materialId: string | null; materialName: string; materialType: string }): string {
  return line.materialId
    ? `id:${line.materialId}`
    : `historical:${line.materialType}:${line.materialName}`;
}

function equipmentKey(line: { equipmentId: string | null; equipmentName: string }): string {
  return line.equipmentId ? `id:${line.equipmentId}` : `historical:${line.equipmentName}`;
}

function consumableKey(line: { consumableId: string | null; consumableName: string }): string {
  return line.consumableId ? `id:${line.consumableId}` : `historical:${line.consumableName}`;
}

function decimalString(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toString();
}

function tenthsString(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toFixed(1);
}

function currencyString(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function matchesSearch(search: string, ...values: string[]): boolean {
  if (!search) return true;
  return values.some((value) => value.toLocaleLowerCase().includes(search));
}

export async function buildProductionUsageReport(
  shopId: string,
  filters: ProductionUsageFilters = {},
  db = prisma,
) {
  const materials = new Map<string, MaterialAggregate>();
  const equipment = new Map<string, EquipmentAggregate>();
  const packages = new Map<string, PackageAggregate>();
  const search = filters.search?.trim().toLocaleLowerCase() ?? "";
  let cursor: string | undefined;
  let includedOrderCount = 0;
  let excludedOrderCount = 0;
  let reviewRequiredOrderCount = 0;
  let mistakeBuffer = ZERO;
  let totalPackagingCost = ZERO;

  do {
    const records = await db.orderRecord.findMany({
      where: {
        shopId,
        currentSnapshot: {
          is: {
            ...(filters.origin && filters.origin !== "all" ? { origin: filters.origin } : {}),
            ...((filters.startDate || filters.endDateExclusive)
              ? {
                  createdAt: {
                    ...(filters.startDate ? { gte: filters.startDate } : {}),
                    ...(filters.endDateExclusive ? { lt: filters.endDateExclusive } : {}),
                  },
                }
              : {}),
          },
        },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        lifecycle: { select: { state: true } },
        refundEvents: {
          select: {
            lines: { select: { shopifyLineItemId: true, quantity: true } },
          },
        },
        currentSnapshot: {
          select: {
            createdAt: true,
            lines: {
              select: {
                shopifyLineItemId: true,
                quantity: true,
                mistakeBufferAmount: true,
                materialLines: true,
                equipmentLines: {
                  include: { consumableLines: true },
                },
              },
            },
            packageAllocations: {
              select: { packageName: true, quantity: true, materialCost: true },
            },
          },
        },
      },
    });

    if (records.length === 0) break;
    cursor = records.at(-1)?.id;

    for (const record of records) {
      const snapshot = record.currentSnapshot;
      if (!snapshot) continue;
      const lifecycleState = (record.lifecycle?.state ?? "unknown") as OrderLifecycleState;
      const refundedByLine = new Map<string, Prisma.Decimal>();
      for (const refundEvent of record.refundEvents) {
        for (const line of refundEvent.lines) {
          refundedByLine.set(
            line.shopifyLineItemId,
            (refundedByLine.get(line.shopifyLineItemId) ?? ZERO).add(line.quantity),
          );
        }
      }

      const lineEligibility = snapshot.lines.map((line) => ({
        line,
        eligibility: resolveEligibleQuantity({
          originalQuantity: line.quantity,
          refundedQuantity: refundedByLine.get(line.shopifyLineItemId) ?? ZERO,
          lifecycleState,
        }),
      }));
      const reviewRequired = lineEligibility.some(({ eligibility }) => eligibility.reviewRequired);
      const hasEligibleQuantity = lineEligibility.some(({ eligibility }) => eligibility.eligibleQuantity.gt(ZERO));
      if (reviewRequired) {
        reviewRequiredOrderCount += 1;
        excludedOrderCount += 1;
        continue;
      }
      if (!hasEligibleQuantity) {
        excludedOrderCount += 1;
        continue;
      }
      includedOrderCount += 1;

      let totalOriginalQuantity = ZERO;
      let totalEligibleQuantity = ZERO;
      for (const { line, eligibility } of lineEligibility) {
        totalOriginalQuantity = totalOriginalQuantity.add(line.quantity);
        totalEligibleQuantity = totalEligibleQuantity.add(eligibility.eligibleQuantity);
        const fraction = eligibility.eligibleFraction;
        if (fraction.equals(ZERO)) continue;
        mistakeBuffer = mistakeBuffer.add(line.mistakeBufferAmount.mul(fraction));

        for (const materialLine of line.materialLines) {
          if (materialLine.materialType === "shipping") continue;
          const key = materialKey(materialLine);
          const existing = materials.get(key) ?? {
            key,
            materialId: materialLine.materialId,
            name: materialLine.materialName,
            materialType: materialLine.materialType,
            costingModels: new Set<string>(),
            purchaseUnits: ZERO,
            portionUses: ZERO,
            rawQuantity: ZERO,
            totalCost: ZERO,
            incompleteQuantity: false,
            orderIds: new Set<string>(),
            latestAt: snapshot.createdAt,
          };
          const eligibleCost = materialLine.lineCost.mul(fraction);
          if (materialLine.perUnitCost.gt(ZERO)) {
            existing.purchaseUnits = existing.purchaseUnits.add(eligibleCost.div(materialLine.perUnitCost));
          } else {
            existing.incompleteQuantity = true;
          }
          existing.rawQuantity = existing.rawQuantity.add(materialLine.quantity.mul(fraction));
          existing.portionUses = existing.portionUses.add((materialLine.usesPerVariant ?? ZERO).mul(fraction));
          existing.totalCost = existing.totalCost.add(eligibleCost);
          if (materialLine.costingModel) existing.costingModels.add(materialLine.costingModel);
          existing.orderIds.add(record.id);
          if (snapshot.createdAt >= existing.latestAt) {
            existing.name = materialLine.materialName;
            existing.latestAt = snapshot.createdAt;
          }
          materials.set(key, existing);
        }

        for (const equipmentLine of line.equipmentLines) {
          const key = equipmentKey(equipmentLine);
          const existing = equipment.get(key) ?? {
            key,
            equipmentId: equipmentLine.equipmentId,
            name: equipmentLine.equipmentName,
            minutes: ZERO,
            uses: ZERO,
            totalCost: ZERO,
            consumablesCost: ZERO,
            electricityCost: ZERO,
            depreciationCost: ZERO,
            maintenanceCost: ZERO,
            manualOverrideCost: ZERO,
            incompleteUsage: false,
            orderIds: new Set<string>(),
            consumables: new Map<string, ConsumableAggregate>(),
            latestAt: snapshot.createdAt,
          };

          if (equipmentLine.usageMode === "duration_yield") {
            if (equipmentLine.yieldDurationMinutes && equipmentLine.yieldQuantity?.gt(ZERO)) {
              existing.minutes = existing.minutes.add(
                eligibility.eligibleQuantity.mul(equipmentLine.yieldDurationMinutes).div(equipmentLine.yieldQuantity),
              );
            } else {
              existing.incompleteUsage = true;
            }
          } else if (equipmentLine.usageMode === "use_yield") {
            if (equipmentLine.yieldUses && equipmentLine.yieldQuantity?.gt(ZERO)) {
              existing.uses = existing.uses.add(
                eligibility.eligibleQuantity.mul(equipmentLine.yieldUses).div(equipmentLine.yieldQuantity),
              );
            } else {
              existing.incompleteUsage = true;
            }
          } else {
            existing.minutes = existing.minutes.add((equipmentLine.minutes ?? ZERO).mul(fraction));
            existing.uses = existing.uses.add((equipmentLine.uses ?? ZERO).mul(fraction));
          }

          existing.totalCost = existing.totalCost.add(equipmentLine.lineCost.mul(fraction));
          existing.consumablesCost = existing.consumablesCost.add(equipmentLine.consumablesCost.mul(fraction));
          existing.electricityCost = existing.electricityCost.add(equipmentLine.electricityCost.mul(fraction));
          existing.depreciationCost = existing.depreciationCost.add(equipmentLine.depreciationCost.mul(fraction));
          existing.maintenanceCost = existing.maintenanceCost.add(equipmentLine.maintenanceCost.mul(fraction));
          existing.manualOverrideCost = existing.manualOverrideCost.add(equipmentLine.manualOverrideCost.mul(fraction));
          existing.orderIds.add(record.id);
          if (snapshot.createdAt >= existing.latestAt) {
            existing.name = equipmentLine.equipmentName;
            existing.latestAt = snapshot.createdAt;
          }

          for (const consumableLine of equipmentLine.consumableLines) {
            const consumableAggregateKey = consumableKey(consumableLine);
            const consumable = existing.consumables.get(consumableAggregateKey) ?? {
              key: consumableAggregateKey,
              consumableId: consumableLine.consumableId,
              name: consumableLine.consumableName,
              lifespanUnits: new Set<string>(),
              totalCost: ZERO,
            };
            consumable.lifespanUnits.add(consumableLine.lifespanUnit);
            consumable.totalCost = consumable.totalCost.add(consumableLine.lineCost.mul(fraction));
            existing.consumables.set(consumableAggregateKey, consumable);
          }
          equipment.set(key, existing);
        }
      }

      const packageFraction = totalOriginalQuantity.gt(ZERO)
        ? totalEligibleQuantity.div(totalOriginalQuantity)
        : ZERO;
      for (const allocation of snapshot.packageAllocations) {
        const key = allocation.packageName;
        const existing = packages.get(key) ?? {
          key,
          name: allocation.packageName,
          quantity: ZERO,
          materialCost: ZERO,
          orderIds: new Set<string>(),
        };
        existing.quantity = existing.quantity.add(new Prisma.Decimal(allocation.quantity).mul(packageFraction));
        existing.materialCost = existing.materialCost.add(allocation.materialCost.mul(packageFraction));
        existing.orderIds.add(record.id);
        totalPackagingCost = totalPackagingCost.add(allocation.materialCost.mul(packageFraction));
        packages.set(key, existing);
      }
    }

    if (records.length < BATCH_SIZE) break;
  } while (cursor);

  const materialRows = [...materials.values()]
    .filter((row) => matchesSearch(search, row.name, row.materialType))
    .sort((left, right) => right.totalCost.comparedTo(left.totalCost))
    .map((row) => ({
      key: row.key,
      materialId: row.materialId,
      name: row.name,
      materialType: row.materialType,
      costingModel: row.costingModels.size === 1 ? [...row.costingModels][0] : row.costingModels.size > 1 ? "mixed" : null,
      purchaseUnits: tenthsString(row.purchaseUnits),
      portionUses: decimalString(row.portionUses),
      rawQuantity: decimalString(row.rawQuantity),
      totalCost: currencyString(row.totalCost),
      incompleteQuantity: row.incompleteQuantity,
      historical: row.materialId === null,
      orderCount: row.orderIds.size,
    }));

  const equipmentRows = [...equipment.values()]
    .filter((row) =>
      matchesSearch(search, row.name, ...[...row.consumables.values()].map((consumable) => consumable.name)),
    )
    .sort((left, right) => right.totalCost.comparedTo(left.totalCost))
    .map((row) => ({
      key: row.key,
      equipmentId: row.equipmentId,
      name: row.name,
      hours: tenthsString(row.minutes.div(60)),
      uses: decimalString(row.uses),
      totalCost: currencyString(row.totalCost),
      consumablesCost: currencyString(row.consumablesCost),
      electricityCost: currencyString(row.electricityCost),
      depreciationCost: currencyString(row.depreciationCost),
      maintenanceCost: currencyString(row.maintenanceCost),
      manualOverrideCost: currencyString(row.manualOverrideCost),
      incompleteUsage: row.incompleteUsage,
      historical: row.equipmentId === null,
      orderCount: row.orderIds.size,
      consumables: [...row.consumables.values()]
        .sort((left, right) => right.totalCost.comparedTo(left.totalCost))
        .map((consumable) => ({
          key: consumable.key,
          consumableId: consumable.consumableId,
          name: consumable.name,
          lifespanUnit: consumable.lifespanUnits.size === 1
            ? [...consumable.lifespanUnits][0]
            : "mixed",
          totalCost: currencyString(consumable.totalCost),
          historical: consumable.consumableId === null,
        })),
    }));

  const packageRows = [...packages.values()]
    .filter((row) => matchesSearch(search, row.name))
    .sort((left, right) => right.materialCost.comparedTo(left.materialCost))
    .map((row) => ({
      key: row.key,
      name: row.name,
      quantity: decimalString(row.quantity),
      materialCost: currencyString(row.materialCost),
      orderCount: row.orderIds.size,
    }));

  const totalMaterialCost = [...materials.values()].reduce((sum, row) => sum.add(row.totalCost), ZERO);
  const totalEquipmentCost = [...equipment.values()].reduce((sum, row) => sum.add(row.totalCost), ZERO);
  const totalEquipmentMinutes = [...equipment.values()].reduce((sum, row) => sum.add(row.minutes), ZERO);
  const totalConsumablesCost = [...equipment.values()].reduce((sum, row) => sum.add(row.consumablesCost), ZERO);

  return {
    filters: {
      startDate: filters.startDate?.toISOString() ?? null,
      endDateExclusive: filters.endDateExclusive?.toISOString() ?? null,
      origin: filters.origin ?? "all",
      search: filters.search?.trim() ?? "",
    },
    summary: {
      includedOrderCount,
      excludedOrderCount,
      reviewRequiredOrderCount,
      materialCost: currencyString(totalMaterialCost),
      equipmentCost: currencyString(totalEquipmentCost),
      equipmentHours: tenthsString(totalEquipmentMinutes.div(60)),
      consumablesCost: currencyString(totalConsumablesCost),
      mistakeBuffer: currencyString(mistakeBuffer),
      packagingCost: currencyString(totalPackagingCost),
    },
    materials: materialRows,
    equipment: equipmentRows,
    packages: packageRows,
  };
}

export type ProductionUsageReport = Awaited<ReturnType<typeof buildProductionUsageReport>>;

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function buildProductionUsageCsv(report: ProductionUsageReport): string {
  const headers = [
    "section",
    "name",
    "typeOrBasis",
    "purchaseUnits",
    "portionUses",
    "hours",
    "uses",
    "quantity",
    "totalCost",
    "consumablesCost",
    "electricityCost",
    "depreciationCost",
    "maintenanceCost",
    "manualOverrideCost",
    "orderCount",
    "notes",
  ];
  const rows: string[][] = [];
  for (const material of report.materials) {
    rows.push([
      "material",
      material.name,
      material.materialType,
      material.purchaseUnits,
      material.portionUses,
      "",
      "",
      material.rawQuantity,
      material.totalCost,
      "",
      "",
      "",
      "",
      "",
      material.orderCount.toString(),
      [material.historical ? "Historical item" : "", material.incompleteQuantity ? "Incomplete quantity" : ""]
        .filter(Boolean)
        .join("; "),
    ]);
  }
  for (const item of report.equipment) {
    rows.push([
      "equipment",
      item.name,
      "equipment",
      "",
      "",
      item.hours,
      item.uses,
      "",
      item.totalCost,
      item.consumablesCost,
      item.electricityCost,
      item.depreciationCost,
      item.maintenanceCost,
      item.manualOverrideCost,
      item.orderCount.toString(),
      [item.historical ? "Historical item" : "", item.incompleteUsage ? "Incomplete usage" : ""]
        .filter(Boolean)
        .join("; "),
    ]);
    for (const consumable of item.consumables) {
      rows.push([
        "consumable",
        `${item.name}: ${consumable.name}`,
        consumable.lifespanUnit,
        "",
        "",
        "",
        "",
        "",
        consumable.totalCost,
        consumable.totalCost,
        "",
        "",
        "",
        "",
        item.orderCount.toString(),
        consumable.historical ? "Historical item" : "",
      ]);
    }
  }
  for (const item of report.packages) {
    rows.push([
      "package",
      item.name,
      "cartonized packaging",
      "",
      "",
      "",
      "",
      item.quantity,
      item.materialCost,
      "",
      "",
      "",
      "",
      "",
      item.orderCount.toString(),
      "Package-level detail",
    ]);
  }

  return [headers, ...rows]
    .map((row) => row.map((value) => csvEscape(value)).join(","))
    .join("\n");
}
