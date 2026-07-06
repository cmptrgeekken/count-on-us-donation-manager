import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.server";
import {
  parseOptionalNonNegativeDecimal,
  parseOptionalNonNegativeMoney,
  parseOptionalPositiveDecimal,
  parseRequiredPositiveDecimal,
  parseRequiredPositiveMoney,
} from "../utils/money-parsing";

const materialFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  type: z.enum(["production", "shipping"]),
  costingModel: z.enum(["counted", "yield", "uses"]),
  purchaseLink: z.union([z.literal(""), z.url({ message: "Purchase link must be a valid URL." })]),
  purchasePrice: z.string(),
  purchaseQty: z.string(),
  totalUsesPerUnit: z.string().optional(),
  weightGrams: z.string().optional(),
  unitDescription: z.string().optional(),
  notes: z.string().optional(),
});

const equipmentFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  purchaseLink: z.union([z.literal(""), z.url({ message: "Equipment purchase link must be a valid URL." })]),
  hourlyRateMode: z.enum(["manual", "calculated"]).optional(),
  hourlyRate: z.string().optional(),
  perUseCostMode: z.enum(["manual", "calculated"]).optional(),
  perUseCost: z.string().optional(),
  usageBasis: z.enum(["time", "unit", "time_and_unit"]).optional(),
  equipmentCost: z.string().optional(),
  acquisitionCost: z.string().optional(),
  expectedLifespanHours: z.string().optional(),
  expectedLifespanUnit: z.enum(["hours", "uses"]).optional(),
  salvageValue: z.string().optional(),
  wattsPerOperatingHour: z.string().optional(),
  electricityCostPerKwhOverride: z.string().optional(),
  consumables: z.string().optional(),
  notes: z.string().optional(),
});

const equipmentConsumableSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Consumable name is required."),
  replacementCost: z.string(),
  lifespanQuantity: z.string(),
  lifespanUnit: z.enum(["hours", "uses"]),
  sku: z.string().optional(),
  purchaseLink: z.union([z.literal(""), z.url({ message: "Consumable purchase link must be a valid URL." })]),
  notes: z.string().optional(),
});

export type MaterialCreateInput = z.input<typeof materialFormSchema>;
export type EquipmentCreateInput = z.input<typeof equipmentFormSchema>;

function normalizeLookupName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function materialPayload(material: {
  id: string;
  name: string;
  type: string;
  costingModel: string | null;
  purchasePrice: Prisma.Decimal;
  purchaseQty: Prisma.Decimal;
  perUnitCost: Prisma.Decimal;
  totalUsesPerUnit: Prisma.Decimal | null;
  purchaseLink: string | null;
  weightGrams: Prisma.Decimal | null;
  unitDescription: string | null;
  status: string;
  notes: string | null;
}) {
  return {
    id: material.id,
    name: material.name,
    type: material.type,
    costingModel: material.costingModel,
    purchasePrice: material.purchasePrice.toString(),
    purchaseQty: material.purchaseQty.toString(),
    perUnitCost: material.perUnitCost.toString(),
    totalUsesPerUnit: material.totalUsesPerUnit?.toString() ?? null,
    purchaseLink: material.purchaseLink ?? "",
    weightGrams: material.weightGrams?.toString() ?? "",
    unitDescription: material.unitDescription ?? "",
    status: material.status,
    notes: material.notes ?? "",
  };
}

function equipmentPayload(item: {
  id: string;
  name: string;
  hourlyRate: Prisma.Decimal | null;
  hourlyRateMode: string;
  perUseCost: Prisma.Decimal | null;
  perUseCostMode: string;
  usageBasis: string;
  purchaseLink: string | null;
  equipmentCost: Prisma.Decimal | null;
  acquisitionCost: Prisma.Decimal | null;
  expectedLifespanHours: Prisma.Decimal | null;
  expectedLifespanUnit: string;
  salvageValue: Prisma.Decimal | null;
  wattsPerOperatingHour: Prisma.Decimal | null;
  electricityCostPerKwhOverride: Prisma.Decimal | null;
  status: string;
  notes: string | null;
}) {
  return {
    id: item.id,
    name: item.name,
    hourlyRate: item.hourlyRate?.toString() ?? null,
    hourlyRateMode: item.hourlyRateMode,
    perUseCost: item.perUseCost?.toString() ?? null,
    perUseCostMode: item.perUseCostMode,
    usageBasis: item.usageBasis,
    purchaseLink: item.purchaseLink ?? "",
    equipmentCost: item.equipmentCost?.toString() ?? "",
    acquisitionCost: item.acquisitionCost?.toString() ?? "",
    expectedLifespanHours: item.expectedLifespanHours?.toString() ?? "",
    expectedLifespanUnit: item.expectedLifespanUnit,
    salvageValue: item.salvageValue?.toString() ?? "",
    wattsPerOperatingHour: item.wattsPerOperatingHour?.toString() ?? "",
    electricityCostPerKwhOverride: item.electricityCostPerKwhOverride?.toString() ?? "",
    status: item.status,
    notes: item.notes ?? "",
  };
}

export async function createMaterialLibraryItem(params: {
  shopId: string;
  input: MaterialCreateInput;
}) {
  const parsed = materialFormSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new Response(parsed.error.issues[0]?.message ?? "Invalid material.", { status: 400 });
  }

  const { name, type, costingModel } = parsed.data;
  const normalizedName = normalizeLookupName(name);
  const purchasePrice = parseRequiredPositiveMoney(parsed.data.purchasePrice, "Purchase price");
  const purchaseQty = parseRequiredPositiveDecimal(parsed.data.purchaseQty, "Purchase quantity");
  const totalUsesPerUnit =
    costingModel === "uses"
      ? parseRequiredPositiveDecimal(parsed.data.totalUsesPerUnit, "Portions per purchased unit")
      : null;
  const weightGrams = parseOptionalPositiveDecimal(parsed.data.weightGrams, "Material weight", 3);
  const perUnitCost = purchasePrice.div(purchaseQty).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);

  return prisma.$transaction(async (tx) => {
    const materialCandidates = await tx.materialLibraryItem.findMany({
      where: { shopId: params.shopId, type, status: "active" },
      select: { id: true, name: true },
    });
    const duplicate = materialCandidates.find((candidate) => normalizeLookupName(candidate.name) === normalizedName) ?? null;

    if (duplicate) {
      throw new Response(`An active ${type} material named "${duplicate.name}" already exists. Use that material instead.`, { status: 400 });
    }

    const material = await tx.materialLibraryItem.create({
      data: {
        shopId: params.shopId,
        name: name.trim(),
        type,
        costingModel,
        purchasePrice,
        purchaseQty,
        perUnitCost,
        totalUsesPerUnit,
        purchaseLink: parsed.data.purchaseLink.trim() || null,
        weightGrams,
        unitDescription: parsed.data.unitDescription?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        status: "active",
      },
    });

    await tx.auditLog.create({
      data: {
        shopId: params.shopId,
        entity: "MaterialLibraryItem",
        entityId: material.id,
        action: "MATERIAL_CREATED",
        actor: "merchant",
      },
    });

    return materialPayload(material);
  });
}

export async function createEquipmentLibraryItem(params: {
  shopId: string;
  input: EquipmentCreateInput;
}) {
  const parsed = equipmentFormSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new Response(parsed.error.issues[0]?.message ?? "Invalid equipment.", { status: 400 });
  }

  const normalizedName = normalizeLookupName(parsed.data.name);
  const hourlyRateInput = parsed.data.hourlyRate?.trim() ?? "";
  const perUseCostInput = parsed.data.perUseCost?.trim() ?? "";
  const hourlyRateMode = parsed.data.hourlyRateMode ?? (hourlyRateInput ? "manual" : "calculated");
  const perUseCostMode = parsed.data.perUseCostMode ?? (perUseCostInput ? "manual" : "calculated");
  const usageBasis = parsed.data.usageBasis ?? "time_and_unit";
  const expectedLifespanUnit = parsed.data.expectedLifespanUnit ?? "hours";
  const hourlyRate = parseOptionalNonNegativeMoney(parsed.data.hourlyRate, "Hourly rate");
  const perUseCost = parseOptionalNonNegativeMoney(parsed.data.perUseCost, "Per-use cost");
  const acquisitionCost = parseOptionalNonNegativeMoney(parsed.data.acquisitionCost ?? parsed.data.equipmentCost, "Acquisition cost");
  const equipmentCost = acquisitionCost;
  const expectedLifespanHours = parseOptionalPositiveDecimal(parsed.data.expectedLifespanHours, "Expected lifespan", 4);
  const salvageValue = parseOptionalNonNegativeMoney(parsed.data.salvageValue, "Salvage value");
  const wattsPerOperatingHour = parseOptionalNonNegativeDecimal(
    parsed.data.wattsPerOperatingHour,
    "Watts per operating hour",
    4,
  );
  const electricityCostPerKwhOverride = parseOptionalNonNegativeDecimal(
    parsed.data.electricityCostPerKwhOverride,
    "Electricity cost per kWh override",
    6,
  );
  let consumablesInput: unknown = [];
  if (parsed.data.consumables?.trim()) {
    try {
      consumablesInput = JSON.parse(parsed.data.consumables) as unknown;
    } catch {
      throw new Response("Consumables must be valid JSON.", { status: 400 });
    }
  }
  const consumablesParsed = z.array(equipmentConsumableSchema).safeParse(consumablesInput);
  if (!consumablesParsed.success) {
    throw new Response(consumablesParsed.error.issues[0]?.message ?? "Invalid consumables.", { status: 400 });
  }

  if (hourlyRateMode === "manual" && hourlyRate === null) {
    throw new Response("Hourly override rate is required when hourly override is enabled.", { status: 400 });
  }
  if (perUseCostMode === "manual" && perUseCost === null) {
    throw new Response("Per-use override cost is required when per-use override is enabled.", { status: 400 });
  }

  const hasManualOverride = hourlyRateMode === "manual" || perUseCostMode === "manual";
  const hasCalculatedComponent = acquisitionCost !== null || consumablesParsed.data.length > 0 || wattsPerOperatingHour !== null;
  if (!hasManualOverride && !hasCalculatedComponent) {
    throw new Response("Add at least one equipment cost component or enable a manual override.", { status: 400 });
  }

  const consumables = consumablesParsed.data.map((consumable, index) => ({
    shopId: params.shopId,
    name: consumable.name.trim(),
    replacementCost: parseRequiredPositiveMoney(consumable.replacementCost, "Consumable replacement cost"),
    lifespanQuantity: parseRequiredPositiveDecimal(consumable.lifespanQuantity, "Consumable lifespan"),
    lifespanUnit: consumable.lifespanUnit,
    sku: consumable.sku?.trim() || null,
    purchaseLink: consumable.purchaseLink.trim() || null,
    notes: consumable.notes?.trim() || null,
    sortOrder: index,
    status: "active",
  }));

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.equipmentLibraryItem.findMany({
      where: { shopId: params.shopId, status: "active" },
      select: { id: true, name: true },
    });
    const duplicate = candidates.find((candidate) => normalizeLookupName(candidate.name) === normalizedName) ?? null;

    if (duplicate) {
      throw new Response(`An active equipment item named "${duplicate.name}" already exists. Use that equipment item instead.`, { status: 400 });
    }

    const item = await tx.equipmentLibraryItem.create({
      data: {
        shopId: params.shopId,
        name: parsed.data.name.trim(),
        hourlyRate,
        hourlyRateMode,
        perUseCost,
        perUseCostMode,
        usageBasis,
        purchaseLink: parsed.data.purchaseLink.trim() || null,
        equipmentCost,
        acquisitionCost,
        expectedLifespanHours,
        expectedLifespanUnit,
        salvageValue,
        wattsPerOperatingHour,
        electricityCostPerKwhOverride,
        notes: parsed.data.notes?.trim() || null,
        status: "active",
        consumables: consumables.length > 0 ? { create: consumables } : undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        shopId: params.shopId,
        entity: "EquipmentLibraryItem",
        entityId: item.id,
        action: "EQUIPMENT_CREATED",
        actor: "merchant",
      },
    });

    return equipmentPayload(item);
  });
}
