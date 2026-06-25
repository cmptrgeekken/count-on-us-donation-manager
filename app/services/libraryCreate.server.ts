import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.server";
import {
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
  hourlyRate: z.string().optional(),
  perUseCost: z.string().optional(),
  equipmentCost: z.string().optional(),
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
  perUseCost: Prisma.Decimal | null;
  purchaseLink: string | null;
  equipmentCost: Prisma.Decimal | null;
  status: string;
  notes: string | null;
}) {
  return {
    id: item.id,
    name: item.name,
    hourlyRate: item.hourlyRate?.toString() ?? null,
    perUseCost: item.perUseCost?.toString() ?? null,
    purchaseLink: item.purchaseLink ?? "",
    equipmentCost: item.equipmentCost?.toString() ?? "",
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
  const hourlyRate = parseOptionalNonNegativeMoney(parsed.data.hourlyRate, "Hourly rate");
  const perUseCost = parseOptionalNonNegativeMoney(parsed.data.perUseCost, "Per-use cost");
  const equipmentCost = parseOptionalNonNegativeMoney(parsed.data.equipmentCost, "Equipment cost");

  if (hourlyRate === null && perUseCost === null) {
    throw new Response("At least one of hourly rate or per-use cost must be set.", { status: 400 });
  }

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
        perUseCost,
        purchaseLink: parsed.data.purchaseLink.trim() || null,
        equipmentCost,
        notes: parsed.data.notes?.trim() || null,
        status: "active",
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
