import { jsonResponse } from "~/utils/json-response.server";
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator, useRouteError } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import {
  Autocomplete,
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  Modal,
  Page,
  Select,
  Text,
  TextField,
  TitleBar,
} from "../components/polaris-shim";
import { z } from "zod";
import { AppSaveBar } from "../components/AppSaveBar";
import { prisma } from "../db.server";
import { resolveEquipmentEffectiveRates, type EquipmentForCosting } from "../services/costEngine.server";
import { createEquipmentLibraryItem, createMaterialLibraryItem } from "../services/libraryCreate.server";
import { buildAdminVariantEstimate, type VariantEstimatePayload } from "../services/variantEstimate.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { normalizeFixedDecimalInput } from "../utils/input-formatting";
import {
  defaultUsageModeForBasis,
  usageModeAllowedForBasis,
  usageModeOptionsForBasis,
} from "../utils/equipment-usage";
import {
  parseOptionalNonNegativeMoney,
  parseOptionalPercentInputToRate,
} from "../utils/money-parsing";
import {
  parseOptionalNonNegativeNumber,
  parseOptionalNonNegativeWholeNumber,
  parseOptionalPositiveNumber,
  parseOptionalPositiveWholeNumber,
  parseOptionalPercent,
  parseRequiredNonNegativeWholeNumber,
} from "../utils/number-parsing";
import { useAppLocalization } from "../utils/use-app-localization";
import { useUnsavedChangesGuard } from "../utils/use-unsaved-changes-guard";
import { resolveEffectiveTemplateSelection } from "../utils/effective-template-selection";
import {
  applyShippingTemplateSelectionToVariantDraft,
  applyTemplateSelectionToVariantDraft,
  cloneDraft,
  createClientId,
  normalizeVariantDraft,
  type TemplateCatalogEntry,
  type TemplateCatalogMaterialLine,
  type VariantDraft,
  type VariantTemplateEquipmentDraftLine,
  type VariantTemplateMaterialDraftLine,
} from "../utils/staged-editor";

type SerializedMaterialLine = {
  id: string;
  materialId: string;
  materialName: string;
  materialType: string;
  costingModel: string | null;
  perUnitCost: string;
  yield: string | null;
  quantity: string;
  usesPerVariant: string | null;
};

type SerializedEquipmentLine = {
  id: string;
  equipmentId: string;
  equipmentName: string;
  usageBasis: string;
  hourlyRate: string | null;
  perUseCost: string | null;
  usageMode: string;
  minutes: string | null;
  uses: string | null;
  yieldDurationMinutes: string | null;
  yieldUses: string | null;
  yieldQuantity: string | null;
};

type TemplateMaterialOverrideLine = {
  templateLineId: string;
  materialId: string;
  materialName: string;
  materialType: string;
  costingModel: string | null;
  quantity: string;
  yield: string | null;
  usesPerVariant: string | null;
  overrideLineId: string | null;
  overrideQuantity: string | null;
  overrideYield: string | null;
  overrideUsesPerVariant: string | null;
  hasOverride: boolean;
};

type TemplateEquipmentOverrideLine = {
  templateLineId: string;
  equipmentId: string;
  equipmentName: string;
  usageBasis: string;
  usageMode: string;
  minutes: string | null;
  uses: string | null;
  yieldDurationMinutes: string | null;
  yieldUses: string | null;
  yieldQuantity: string | null;
  overrideLineId: string | null;
  overrideUsageMode: string | null;
  overrideMinutes: string | null;
  overrideUses: string | null;
  overrideYieldDurationMinutes: string | null;
  overrideYieldUses: string | null;
  overrideYieldQuantity: string | null;
  hasOverride: boolean;
};

type SerializedProviderCostLine = {
  costLineType: string;
  description: string | null;
  amount: string;
  currency: string;
  syncedAt: string;
};

type SerializedProviderMapping = {
  id: string;
  provider: string;
  status: string;
  matchMethod: string | null;
  providerProductTitle: string | null;
  providerVariantTitle: string | null;
  providerSku: string | null;
  connectionStatus: string;
  lastCostSyncedAt: string | null;
  latestCostLines: SerializedProviderCostLine[];
};

function buildCountMap<T extends string>(values: T[]) {
  const counts = new Map<T, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function serializeVariantMaterialLine(
  line: {
    id: string;
    materialId: string;
    material: { name: string; type: string; costingModel: string | null; perUnitCost: { toString(): string } };
    yield: { toString(): string } | null;
    quantity: { toString(): string };
    usesPerVariant: { toString(): string } | null;
  },
): SerializedMaterialLine {
  return {
    id: line.id,
    materialId: line.materialId,
    materialName: line.material.name,
    materialType: line.material.type,
    costingModel: line.material.costingModel,
    perUnitCost: line.material.perUnitCost.toString(),
    yield: line.yield?.toString() ?? null,
    quantity: line.quantity.toString(),
    usesPerVariant: line.usesPerVariant?.toString() ?? null,
  };
}

function serializeVariantEquipmentLine(
  line: {
    id: string;
    equipmentId: string;
    equipment: EquipmentForCosting & { name: string; usageBasis: string };
    usageMode: string;
    minutes: { toString(): string } | null;
    uses: { toString(): string } | null;
    yieldDurationMinutes: { toString(): string } | null;
    yieldUses: { toString(): string } | null;
    yieldQuantity: { toString(): string } | null;
  },
  defaultElectricityCostPerKwh?: Prisma.Decimal | null,
): SerializedEquipmentLine {
  const rates = resolveEquipmentEffectiveRates(line.equipment, defaultElectricityCostPerKwh);
  return {
    id: line.id,
    equipmentId: line.equipmentId,
    equipmentName: line.equipment.name,
    usageBasis: line.equipment.usageBasis ?? "time_and_unit",
    hourlyRate: rates.hourlyRate?.toString() ?? null,
    perUseCost: rates.perUseCost?.toString() ?? null,
    usageMode: line.usageMode ?? "direct",
    minutes: line.minutes?.toString() ?? null,
    uses: line.uses?.toString() ?? null,
    yieldDurationMinutes: line.yieldDurationMinutes?.toString() ?? null,
    yieldUses: line.yieldUses?.toString() ?? null,
    yieldQuantity: line.yieldQuantity?.toString() ?? null,
  };
}

function sortSerializedMaterialLines(lines: SerializedMaterialLine[]) {
  return [...lines].sort((a, b) => a.materialName.localeCompare(b.materialName));
}

function sortSerializedEquipmentLines(lines: SerializedEquipmentLine[]) {
  return [...lines].sort((a, b) => a.equipmentName.localeCompare(b.equipmentName));
}

function sortAvailableMaterials(lines: AvailableMaterial[]) {
  return [...lines].sort((a, b) => a.name.localeCompare(b.name));
}

function sortAvailableEquipment(lines: AvailableEquipment[]) {
  return [...lines].sort((a, b) => a.name.localeCompare(b.name));
}

function formatProviderName(provider: string) {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

const variantDraftSchema = z.object({
  productionTemplateId: z.string().nullable().optional(),
  shippingTemplateId: z.string().nullable().optional(),
  preferredPackageId: z.string().nullable().optional(),
  packedLength: z.string(),
  packedWidth: z.string(),
  packedHeight: z.string(),
  packedWeightGrams: z.string(),
  canSharePackage: z.boolean(),
  laborMinutes: z.string(),
  laborRate: z.string(),
  mistakeBuffer: z.string(),
  templateMaterialLines: z.array(z.object({
    templateLineId: z.string(),
    materialId: z.string(),
    hasOverride: z.boolean(),
    overrideQuantity: z.string().nullable(),
    overrideYield: z.string().nullable(),
    overrideUsesPerVariant: z.string().nullable(),
  })),
  templateEquipmentLines: z.array(z.object({
    templateLineId: z.string(),
    equipmentId: z.string(),
    hasOverride: z.boolean(),
    overrideUsageMode: z.string().nullable().optional(),
    overrideMinutes: z.string().nullable(),
    overrideUses: z.string().nullable(),
    overrideYieldDurationMinutes: z.string().nullable().optional(),
    overrideYieldUses: z.string().nullable().optional(),
    overrideYieldQuantity: z.string().nullable().optional(),
  })),
  materialLines: z.array(z.object({
    materialId: z.string(),
    quantity: z.string(),
    yield: z.string().nullable(),
    usesPerVariant: z.string().nullable(),
  })),
  equipmentLines: z.array(z.object({
    equipmentId: z.string(),
    usageMode: z.string().nullable().optional(),
    minutes: z.string().nullable(),
    uses: z.string().nullable(),
    yieldDurationMinutes: z.string().nullable().optional(),
    yieldUses: z.string().nullable().optional(),
    yieldQuantity: z.string().nullable().optional(),
  })),
});

const copyVariantConfigSchema = z.object({
  sourceVariantId: z.string().min(1),
});

const promoteTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required."),
  description: z.string().trim().optional(),
  includeMaterials: z.boolean(),
  includeEquipment: z.boolean(),
  includeLabor: z.boolean(),
  freezeShopLaborRate: z.boolean(),
  includeDefaultShippingTemplate: z.boolean(),
  assignBack: z.boolean(),
  materialLineKeys: z.array(z.string()),
  equipmentLineKeys: z.array(z.string()),
});

const promoteShippingTemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required."),
  description: z.string().trim().optional(),
  assignBack: z.boolean(),
  setAsProductionDefault: z.boolean(),
  materialLineKeys: z.array(z.string()).min(1, "Choose at least one shipping material line to include."),
});

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const { variantId } = params;

  const shop = await prisma.shop.findUnique({
    where: { shopId },
    select: { mistakeBuffer: true, defaultLaborRate: true, defaultElectricityCostPerKwh: true },
  });
  const defaultElectricityCostPerKwh = shop?.defaultElectricityCostPerKwh ?? null;

  const variant = await prisma.variant.findFirst({
    where: { id: variantId, shopId },
    include: {
      product: { select: { title: true } },
      providerMappings: {
        orderBy: [{ updatedAt: "desc" }],
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
      },
      costConfig: {
        include: {
          productionTemplate: {
            include: {
              materialLines: { include: { material: true }, orderBy: { material: { name: "asc" } } },
              equipmentLines: { include: { equipment: { include: { consumables: true } } }, orderBy: { equipment: { name: "asc" } } },
            },
          },
          materialLines: { include: { material: true, templateLine: true }, orderBy: { material: { name: "asc" } } },
          equipmentLines: { include: { equipment: { include: { consumables: true } }, templateLine: true }, orderBy: { equipment: { name: "asc" } } },
        },
      },
    },
  });

  if (!variant || variant.shopId !== shopId) {
    throw new Response("Not found", { status: 404 });
  }

  const [templates, materials, equipment, packages, copySourceVariants] = await Promise.all([
    prisma.costTemplate.findMany({
      where: { shopId, status: "active" },
      orderBy: { name: "asc" },
      include: {
        materialLines: { include: { material: true }, orderBy: { material: { name: "asc" } } },
        equipmentLines: { include: { equipment: { include: { consumables: true } } }, orderBy: { equipment: { name: "asc" } } },
      },
    }),
    prisma.materialLibraryItem.findMany({
      where: { shopId, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, costingModel: true, perUnitCost: true, totalUsesPerUnit: true },
    }),
    prisma.equipmentLibraryItem.findMany({
      where: { shopId, status: "active" },
      orderBy: { name: "asc" },
      include: { consumables: true },
    }),
    prisma.shippingPackage.findMany({
      where: { shopId, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, length: true, width: true, height: true },
    }),
    prisma.variant.findMany({
      where: {
        shopId,
        id: { not: variant.id },
        costConfig: { isNot: null },
      },
      orderBy: [{ product: { title: "asc" } }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        sku: true,
        product: { select: { title: true } },
        costConfig: {
          select: {
            lineItemCount: true,
            productionTemplate: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const config = variant.costConfig;

  let templateMaterialLines: TemplateMaterialOverrideLine[] = [];
  let templateEquipmentLines: TemplateEquipmentOverrideLine[] = [];
  let additionalMaterialLines: SerializedMaterialLine[] = [];
  let additionalEquipmentLines: SerializedEquipmentLine[] = [];

  if (config) {
    const templateMaterialSource = config.productionTemplate?.materialLines ?? [];
    const explicitMaterialOverrides = new Map(
      config.materialLines
        .filter((line) => line.templateLineId)
        .map((line) => [line.templateLineId as string, line]),
    );
    const materialIdTemplateCounts = buildCountMap(templateMaterialSource.map((line) => line.materialId));

    const legacyMaterialOverrides = new Map(
      config.materialLines
        .filter(
          (line) =>
            !line.templateLineId &&
            (materialIdTemplateCounts.get(line.materialId) ?? 0) === 1,
        )
        .map((line) => [line.materialId, line]),
    );
    const consumedMaterialLineIds = new Set<string>();

    templateMaterialLines = templateMaterialSource.map((line) => {
      const explicitOverride = explicitMaterialOverrides.get(line.id);
      const legacyOverride = explicitOverride ? null : legacyMaterialOverrides.get(line.materialId);
      const legacyDuplicate = explicitOverride ? legacyMaterialOverrides.get(line.materialId) : null;
      const override = explicitOverride ?? legacyOverride;

      if (override) consumedMaterialLineIds.add(override.id);
      if (legacyDuplicate) consumedMaterialLineIds.add(legacyDuplicate.id);

      return {
        templateLineId: line.id,
        materialId: line.materialId,
        materialName: line.material.name,
        materialType: line.material.type,
        costingModel: line.material.costingModel,
        quantity: line.quantity.toString(),
        yield: line.yield?.toString() ?? null,
        usesPerVariant: line.usesPerVariant?.toString() ?? null,
        overrideLineId: override?.id ?? null,
        overrideQuantity: override?.quantity.toString() ?? null,
        overrideYield: override?.yield?.toString() ?? null,
        overrideUsesPerVariant: override?.usesPerVariant?.toString() ?? null,
        hasOverride: Boolean(override),
      };
    });

    additionalMaterialLines = config.materialLines
      .filter((line) => !line.templateLineId && !consumedMaterialLineIds.has(line.id))
      .map(serializeVariantMaterialLine);
    additionalMaterialLines = sortSerializedMaterialLines(additionalMaterialLines);

    const templateEquipmentSource = config.productionTemplate?.equipmentLines ?? [];
    const explicitEquipmentOverrides = new Map(
      config.equipmentLines
        .filter((line) => line.templateLineId)
        .map((line) => [line.templateLineId as string, line]),
    );
    const equipmentIdTemplateCounts = buildCountMap(templateEquipmentSource.map((line) => line.equipmentId));

    const legacyEquipmentOverrides = new Map(
      config.equipmentLines
        .filter(
          (line) =>
            !line.templateLineId &&
            (equipmentIdTemplateCounts.get(line.equipmentId) ?? 0) === 1,
        )
        .map((line) => [line.equipmentId, line]),
    );
    const consumedEquipmentLineIds = new Set<string>();

    templateEquipmentLines = templateEquipmentSource.map((line) => {
      const explicitOverride = explicitEquipmentOverrides.get(line.id);
      const legacyOverride = explicitOverride ? null : legacyEquipmentOverrides.get(line.equipmentId);
      const legacyDuplicate = explicitOverride ? legacyEquipmentOverrides.get(line.equipmentId) : null;
      const override = explicitOverride ?? legacyOverride;

      if (override) consumedEquipmentLineIds.add(override.id);
      if (legacyDuplicate) consumedEquipmentLineIds.add(legacyDuplicate.id);

      return {
        templateLineId: line.id,
        equipmentId: line.equipmentId,
        equipmentName: line.equipment.name,
        usageBasis: line.equipment.usageBasis ?? "time_and_unit",
        usageMode: line.usageMode ?? "direct",
        minutes: line.minutes?.toString() ?? null,
        uses: line.uses?.toString() ?? null,
        yieldDurationMinutes: line.yieldDurationMinutes?.toString() ?? null,
        yieldUses: line.yieldUses?.toString() ?? null,
        yieldQuantity: line.yieldQuantity?.toString() ?? null,
        overrideLineId: override?.id ?? null,
        overrideUsageMode: override?.usageMode ?? null,
        overrideMinutes: override?.minutes?.toString() ?? null,
        overrideUses: override?.uses?.toString() ?? null,
        overrideYieldDurationMinutes: override?.yieldDurationMinutes?.toString() ?? null,
        overrideYieldUses: override?.yieldUses?.toString() ?? null,
        overrideYieldQuantity: override?.yieldQuantity?.toString() ?? null,
        hasOverride: Boolean(override),
      };
    });

    additionalEquipmentLines = config.equipmentLines
      .filter((line) => !line.templateLineId && !consumedEquipmentLineIds.has(line.id))
      .map((line) => serializeVariantEquipmentLine(line, defaultElectricityCostPerKwh));
    additionalEquipmentLines = sortSerializedEquipmentLines(additionalEquipmentLines);
  }

  const serializedProviderMappings: SerializedProviderMapping[] = variant.providerMappings.map((mapping) => {
    const latestSyncedAt = mapping.costLines[0]?.syncedAt ?? null;
    const latestCostLines = latestSyncedAt
      ? mapping.costLines
          .filter((line) => line.syncedAt.getTime() === latestSyncedAt.getTime())
          .map((line) => ({
            costLineType: line.costLineType,
            description: line.description ?? null,
            amount: line.amount.toString(),
            currency: line.currency,
            syncedAt: line.syncedAt.toISOString(),
          }))
      : [];

    return {
      id: mapping.id,
      provider: mapping.provider,
      status: mapping.status,
      matchMethod: mapping.matchMethod ?? null,
      providerProductTitle: mapping.providerProductTitle ?? null,
      providerVariantTitle: mapping.providerVariantTitle ?? null,
      providerSku: mapping.providerSku ?? null,
      connectionStatus: mapping.connection.status,
      lastCostSyncedAt: mapping.lastCostSyncedAt?.toISOString() ?? null,
      latestCostLines,
    };
  });

  return jsonResponse({
    variant: {
      id: variant.id,
      productTitle: variant.product.title,
      title: variant.title,
      sku: variant.sku ?? "",
      price: variant.price.toString(),
      providerMappings: serializedProviderMappings,
    },
    shopDefaults: {
      defaultLaborRate: shop?.defaultLaborRate?.toString() ?? "",
      mistakeBuffer: shop?.mistakeBuffer ? (Number(shop.mistakeBuffer) * 100).toFixed(2) : "",
    },
    config: config
      ? {
          id: config.id,
          productionTemplateId: config.productionTemplateId,
          shippingTemplateId: config.shippingTemplateId,
          preferredPackageId: config.preferredPackageId,
          packedLength: config.packedLength?.toString() ?? "",
          packedWidth: config.packedWidth?.toString() ?? "",
          packedHeight: config.packedHeight?.toString() ?? "",
          packedWeightGrams: config.packedWeightGrams?.toString() ?? "",
          canSharePackage: config.canSharePackage,
          templateName: config.productionTemplate?.name ?? null,
          laborMinutes: config.laborMinutes?.toString() ?? "",
          laborRate: config.laborRate?.toString() ?? "",
          mistakeBuffer: config.mistakeBuffer ? (Number(config.mistakeBuffer) * 100).toFixed(2) : "",
          lineItemCount: config.lineItemCount,
          templateMaterialLines,
          templateEquipmentLines,
          materialLines: additionalMaterialLines,
          equipmentLines: additionalEquipmentLines,
        }
      : null,
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      type: template.type,
      defaultShippingTemplateId: template.defaultShippingTemplateId,
      defaultLaborMinutes: template.defaultLaborMinutes?.toString() ?? null,
      defaultLaborRate: template.defaultLaborRate?.toString() ?? null,
      materialLines: template.materialLines.map((line) => ({
        templateLineId: line.id,
        materialId: line.materialId,
        materialName: line.material.name,
        materialType: line.material.type,
        costingModel: line.material.costingModel,
        quantity: line.quantity.toString(),
        yield: line.yield?.toString() ?? null,
        usesPerVariant: line.usesPerVariant?.toString() ?? null,
      })),
      equipmentLines: template.equipmentLines.map((line) => ({
        templateLineId: line.id,
        equipmentId: line.equipmentId,
        equipmentName: line.equipment.name,
        usageBasis: line.equipment.usageBasis ?? "time_and_unit",
        usageMode: line.usageMode ?? "direct",
        minutes: line.minutes?.toString() ?? null,
        uses: line.uses?.toString() ?? null,
        yieldDurationMinutes: line.yieldDurationMinutes?.toString() ?? null,
        yieldUses: line.yieldUses?.toString() ?? null,
        yieldQuantity: line.yieldQuantity?.toString() ?? null,
      })),
    })),
    availableMaterials: materials.map((material) => ({
      id: material.id,
      name: material.name,
      type: material.type,
      costingModel: material.costingModel,
      perUnitCost: material.perUnitCost.toString(),
      totalUsesPerUnit: material.totalUsesPerUnit?.toString() ?? null,
    })),
    availableEquipment: equipment.map((item) => {
      const rates = resolveEquipmentEffectiveRates(item, defaultElectricityCostPerKwh);
      return {
        id: item.id,
        name: item.name,
        usageBasis: item.usageBasis,
        hourlyRate: rates.hourlyRate?.toString() ?? null,
        perUseCost: rates.perUseCost?.toString() ?? null,
      };
    }),
    packages: packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      dimensions: `${pkg.length} x ${pkg.width} x ${pkg.height}`,
    })),
    copySourceVariants: copySourceVariants.map((sourceVariant) => ({
      id: sourceVariant.id,
      title: sourceVariant.title,
      sku: sourceVariant.sku ?? "",
      productTitle: sourceVariant.product.title,
      templateName: sourceVariant.costConfig?.productionTemplate?.name ?? null,
      lineItemCount: sourceVariant.costConfig?.lineItemCount ?? 0,
    })),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const variantId = params.variantId ?? "";

  const variant = await prisma.variant.findFirst({
    where: { id: variantId, shopId },
    select: { shopId: true },
  });
  if (!variant) {
    return jsonResponse({ ok: false, message: "Not found." }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "quick-create-material") {
    let material: Awaited<ReturnType<typeof createMaterialLibraryItem>>;
    try {
      const materialType = formData.get("type")?.toString();
      const costingModel = formData.get("costingModel")?.toString();
      const normalizedType = materialType === "shipping" ? "shipping" : "production";
      const normalizedCostingModel =
        costingModel === "yield" || costingModel === "uses" || costingModel === "counted"
          ? costingModel
          : "counted";
      material = await createMaterialLibraryItem({
        shopId,
        input: {
          name: formData.get("name")?.toString() ?? "",
          type: normalizedType,
          costingModel: normalizedCostingModel,
          purchasePrice: formData.get("purchasePrice")?.toString() ?? "",
          purchaseQty: formData.get("purchaseQty")?.toString() ?? "",
          totalUsesPerUnit: formData.get("totalUsesPerUnit")?.toString() ?? "",
          purchaseLink: formData.get("purchaseLink")?.toString() ?? "",
          weightGrams: formData.get("weightGrams")?.toString() ?? "",
          unitDescription: formData.get("unitDescription")?.toString() ?? "",
          notes: formData.get("notes")?.toString() ?? "",
        },
      });
    } catch (error) {
      if (error instanceof Response) {
        return jsonResponse({ ok: false, message: await error.text(), actionKind: "quick-create-material" }, { status: error.status });
      }
      throw error;
    }

    return jsonResponse({ ok: true, message: "Material created.", actionKind: "quick-create-material", material });
  }

  if (intent === "quick-create-equipment") {
    let equipment: Awaited<ReturnType<typeof createEquipmentLibraryItem>>;
    try {
      equipment = await createEquipmentLibraryItem({
        shopId,
        input: {
          name: formData.get("name")?.toString() ?? "",
          hourlyRate: formData.get("hourlyRate")?.toString() ?? "",
          perUseCost: formData.get("perUseCost")?.toString() ?? "",
          equipmentCost: formData.get("equipmentCost")?.toString() ?? "",
          purchaseLink: formData.get("purchaseLink")?.toString() ?? "",
          notes: formData.get("notes")?.toString() ?? "",
        },
      });
    } catch (error) {
      if (error instanceof Response) {
        return jsonResponse({ ok: false, message: await error.text(), actionKind: "quick-create-equipment" }, { status: error.status });
      }
      throw error;
    }

    return jsonResponse({ ok: true, message: "Equipment created.", actionKind: "quick-create-equipment", equipment });
  }

  async function ensureConfig() {
    const existing = await prisma.variantCostConfig.findFirst({ where: { variantId, shopId } });
    if (existing) return existing;
    return prisma.variantCostConfig.create({ data: { shopId, variantId } });
  }

  async function requireTemplate(templateId: string) {
    const template = await prisma.costTemplate.findFirst({
      where: { id: templateId, shopId },
      select: { id: true },
    });
    if (!template) {
      throw new Response("Not found", { status: 404 });
    }
    return template;
  }

  async function requireMaterial(materialId: string) {
    const material = await prisma.materialLibraryItem.findFirst({
      where: { id: materialId, shopId },
      select: { id: true },
    });
    if (!material) {
      throw new Response("Not found", { status: 404 });
    }
    return material;
  }

  async function requireEquipment(equipmentId: string) {
    const equipment = await prisma.equipmentLibraryItem.findFirst({
      where: { id: equipmentId, shopId },
      select: { id: true },
    });
    if (!equipment) {
      throw new Response("Not found", { status: 404 });
    }
    return equipment;
  }

  async function requireTemplateMaterialLine(configId: string, templateLineId: string) {
    const line = await prisma.costTemplateMaterialLine.findFirst({
      where: {
        id: templateLineId,
        template: {
          productionVariantConfigs: {
            some: { id: configId, shopId },
          },
        },
      },
      select: {
        id: true,
        materialId: true,
        template: {
          select: {
            materialLines: {
              select: { materialId: true },
            },
          },
        },
      },
    });
    if (!line) {
      throw new Response("Not found", { status: 404 });
    }
    return {
      id: line.id,
      materialId: line.materialId,
      isUniqueMaterial: (buildCountMap(line.template.materialLines.map((item) => item.materialId)).get(line.materialId) ?? 0) === 1,
    };
  }

  async function requireTemplateEquipmentLine(configId: string, templateLineId: string) {
    const line = await prisma.costTemplateEquipmentLine.findFirst({
      where: {
        id: templateLineId,
        template: {
          productionVariantConfigs: {
            some: { id: configId, shopId },
          },
        },
      },
      select: {
        id: true,
        equipmentId: true,
        template: {
          select: {
            equipmentLines: {
              select: { equipmentId: true },
            },
          },
        },
      },
    });
    if (!line) {
      throw new Response("Not found", { status: 404 });
    }
    return {
      id: line.id,
      equipmentId: line.equipmentId,
      isUniqueEquipment: (buildCountMap(line.template.equipmentLines.map((item) => item.equipmentId)).get(line.equipmentId) ?? 0) === 1,
    };
  }

  function getLegacyOverrideIds(template: {
    materialLines: Array<{ materialId: string }>;
    equipmentLines: Array<{ equipmentId: string }>;
  } | null | undefined) {
    const materialCounts = new Map<string, number>();
    const equipmentCounts = new Map<string, number>();

    for (const line of template?.materialLines ?? []) {
      materialCounts.set(line.materialId, (materialCounts.get(line.materialId) ?? 0) + 1);
    }

    for (const line of template?.equipmentLines ?? []) {
      equipmentCounts.set(line.equipmentId, (equipmentCounts.get(line.equipmentId) ?? 0) + 1);
    }

    return {
      materialIds: [...materialCounts.entries()]
        .filter(([, count]) => count === 1)
        .map(([materialId]) => materialId),
      equipmentIds: [...equipmentCounts.entries()]
        .filter(([, count]) => count === 1)
        .map(([equipmentId]) => equipmentId),
    };
  }

  if (intent === "save-variant-draft") {
    const rawDraft = formData.get("draft")?.toString();
    if (!rawDraft) {
      return jsonResponse({ ok: false, message: "Draft data is required." }, { status: 400 });
    }

    const parsedDraft = variantDraftSchema.safeParse(JSON.parse(rawDraft));
    if (!parsedDraft.success) {
      return jsonResponse(
        { ok: false, message: parsedDraft.error.issues[0]?.message ?? "Invalid variant data." },
        { status: 400 },
      );
    }

    const draft = parsedDraft.data;
    const normalizedProductionTemplateId = draft.productionTemplateId?.trim() || null;
    const normalizedShippingTemplateId = draft.shippingTemplateId?.trim() || null;
    const normalizedPreferredPackageId = draft.preferredPackageId?.trim() || null;
    const selectedTemplate = normalizedProductionTemplateId
      ? await prisma.costTemplate.findFirst({
          where: { id: normalizedProductionTemplateId, shopId },
          include: {
            materialLines: { select: { id: true, materialId: true } },
            equipmentLines: { select: { id: true, equipmentId: true, equipment: { select: { usageBasis: true } } } },
          },
        })
      : null;

    const selectedShippingTemplate = normalizedShippingTemplateId
      ? await prisma.costTemplate.findFirst({
          where: { id: normalizedShippingTemplateId, shopId },
          select: { id: true, type: true },
        })
      : null;

    if (normalizedProductionTemplateId && !selectedTemplate) {
      return jsonResponse({ ok: false, message: "Production template not found." }, { status: 404 });
    }

    if (selectedTemplate && selectedTemplate.type === "shipping") {
      return jsonResponse({ ok: false, message: "Production template must be a production template." }, { status: 400 });
    }

    if (normalizedShippingTemplateId && !selectedShippingTemplate) {
      return jsonResponse({ ok: false, message: "Shipping template not found." }, { status: 404 });
    }

    if (selectedShippingTemplate && selectedShippingTemplate.type !== "shipping") {
      return jsonResponse({ ok: false, message: "Shipping override must reference a shipping template." }, { status: 400 });
    }

    if (normalizedPreferredPackageId) {
      const preferredPackage = await prisma.shippingPackage.findFirst({
        where: { id: normalizedPreferredPackageId, shopId, status: "active" },
        select: { id: true },
      });
      if (!preferredPackage) {
        return jsonResponse({ ok: false, message: "Preferred package not found." }, { status: 404 });
      }
    }

    const materialMap = new Map((selectedTemplate?.materialLines ?? []).map((line) => [line.id, line.materialId]));
    const equipmentMap = new Map((selectedTemplate?.equipmentLines ?? []).map((line) => [line.id, line.equipmentId]));
    const equipmentUsageBasisById = new Map(
      (selectedTemplate?.equipmentLines ?? []).map((line) => [line.equipmentId, line.equipment.usageBasis ?? "time_and_unit"]),
    );

    for (const line of draft.templateMaterialLines) {
      if (!materialMap.has(line.templateLineId) || materialMap.get(line.templateLineId) !== line.materialId) {
        return jsonResponse({ ok: false, message: "One or more material overrides are invalid." }, { status: 400 });
      }
    }

    for (const line of draft.templateEquipmentLines) {
      if (!equipmentMap.has(line.templateLineId) || equipmentMap.get(line.templateLineId) !== line.equipmentId) {
        return jsonResponse({ ok: false, message: "One or more equipment overrides are invalid." }, { status: 400 });
      }
    }

    const additionalMaterialIds = [...new Set(draft.materialLines.map((line) => line.materialId))];
    const additionalEquipmentIds = [...new Set(draft.equipmentLines.map((line) => line.equipmentId))];

    if (additionalMaterialIds.length !== draft.materialLines.length) {
      return jsonResponse({ ok: false, message: "Each additional material can only appear once on a variant." }, { status: 400 });
    }

    if (additionalEquipmentIds.length !== draft.equipmentLines.length) {
      return jsonResponse({ ok: false, message: "Each additional equipment item can only appear once on a variant." }, { status: 400 });
    }

    const [materialsFound, equipmentFound, existingConfig] = await Promise.all([
      prisma.materialLibraryItem.findMany({ where: { id: { in: additionalMaterialIds }, shopId }, select: { id: true } }),
      prisma.equipmentLibraryItem.findMany({ where: { id: { in: additionalEquipmentIds }, shopId }, select: { id: true, usageBasis: true } }),
      prisma.variantCostConfig.findFirst({ where: { variantId, shopId }, select: { id: true } }),
    ]);

    if (materialsFound.length !== additionalMaterialIds.length) {
      return jsonResponse({ ok: false, message: "One or more additional materials could not be found." }, { status: 404 });
    }

    if (equipmentFound.length !== additionalEquipmentIds.length) {
      return jsonResponse({ ok: false, message: "One or more additional equipment items could not be found." }, { status: 404 });
    }
    for (const equipment of equipmentFound) {
      equipmentUsageBasisById.set(equipment.id, equipment.usageBasis);
    }

    const hasMeaningfulDraft = Boolean(
      normalizedProductionTemplateId ||
        normalizedShippingTemplateId ||
        draft.laborMinutes ||
        draft.laborRate ||
        draft.mistakeBuffer ||
        normalizedPreferredPackageId ||
        draft.packedLength ||
        draft.packedWidth ||
        draft.packedHeight ||
        draft.packedWeightGrams ||
        draft.canSharePackage === false ||
        draft.materialLines.length ||
        draft.equipmentLines.length ||
        draft.templateMaterialLines.some((line) => line.hasOverride) ||
        draft.templateEquipmentLines.some((line) => line.hasOverride),
    );

    if (!hasMeaningfulDraft) {
      if (existingConfig) {
        await prisma.variantCostConfig.deleteMany({ where: { id: existingConfig.id, shopId } });
        await prisma.auditLog.create({
          data: {
            shopId,
            entity: "VariantCostConfig",
            entityId: existingConfig.id,
            action: "VARIANT_CONFIG_UPDATED",
            actor: "merchant",
          },
        });
      }

      return jsonResponse({
        ok: true,
        message: "Variant configuration saved.",
        savedAt: new Date().toISOString(),
      });
    }

    const materialOverrideLines = draft.templateMaterialLines
      .filter((line) => line.hasOverride)
      .map((line) => ({
        shopId,
        templateLineId: line.templateLineId,
        materialId: line.materialId,
        quantity: parseOptionalNonNegativeWholeNumber(line.overrideQuantity, "Material quantity") ?? 0,
        yield: parseOptionalNonNegativeWholeNumber(line.overrideYield, "Items made from one purchased unit"),
        usesPerVariant: parseOptionalNonNegativeWholeNumber(line.overrideUsesPerVariant, "Portions used per item"),
      }));

    const equipmentOverrideLines = draft.templateEquipmentLines
      .filter((line) => line.hasOverride)
      .map((line) => {
        const usageMode = line.overrideUsageMode || "direct";
        const usageBasis = equipmentUsageBasisById.get(line.equipmentId);
        if (!usageModeAllowedForBasis(usageMode, usageBasis)) {
          throw new Response("Selected equipment usage mode is not allowed for this equipment's usage basis.", { status: 400 });
        }
        const data = {
          shopId,
          templateLineId: line.templateLineId,
          equipmentId: line.equipmentId,
          usageMode,
          minutes: usageMode === "direct" && usageBasis !== "unit" ? parseOptionalNonNegativeNumber(line.overrideMinutes, "Equipment minutes") : null,
          uses: usageMode === "direct" && usageBasis !== "time" ? parseOptionalNonNegativeWholeNumber(line.overrideUses, "Equipment uses") : null,
          yieldDurationMinutes: usageMode === "duration_yield" ? parseOptionalPositiveNumber(line.overrideYieldDurationMinutes, "Equipment yield duration") : null,
          yieldUses: usageMode === "use_yield" ? parseOptionalPositiveWholeNumber(line.overrideYieldUses, "Equipment yield uses") : null,
          yieldQuantity: usageMode !== "direct" ? parseOptionalPositiveWholeNumber(line.overrideYieldQuantity, "Products yielded") : null,
        };

        if (usageMode === "duration_yield" && data.yieldDurationMinutes === null) {
          throw new Response("Equipment yield duration must be greater than 0.", { status: 400 });
        }
        if (usageMode === "use_yield" && data.yieldUses === null) {
          throw new Response("Equipment yield uses must be a positive whole number.", { status: 400 });
        }
        if (usageMode !== "direct" && data.yieldQuantity === null) {
          throw new Response("Products yielded must be a positive whole number.", { status: 400 });
        }

        return data;
      });

    const additionalMaterialLines = draft.materialLines.map((line) => ({
      shopId,
      materialId: line.materialId,
      quantity: parseOptionalNonNegativeWholeNumber(line.quantity, "Material quantity") ?? 0,
      yield: parseOptionalNonNegativeWholeNumber(line.yield, "Items made from one purchased unit"),
      usesPerVariant: parseOptionalNonNegativeWholeNumber(line.usesPerVariant, "Portions used per item"),
    }));

    const additionalEquipmentLines = draft.equipmentLines.map((line) => {
      const usageMode = line.usageMode || "direct";
      const usageBasis = equipmentUsageBasisById.get(line.equipmentId);
      if (!usageModeAllowedForBasis(usageMode, usageBasis)) {
        throw new Response("Selected equipment usage mode is not allowed for this equipment's usage basis.", { status: 400 });
      }
      const data = {
        shopId,
        equipmentId: line.equipmentId,
        usageMode,
        minutes: usageMode === "direct" && usageBasis !== "unit" ? parseOptionalNonNegativeNumber(line.minutes, "Equipment minutes") : null,
        uses: usageMode === "direct" && usageBasis !== "time" ? parseOptionalNonNegativeWholeNumber(line.uses, "Equipment uses") : null,
        yieldDurationMinutes: usageMode === "duration_yield" ? parseOptionalPositiveNumber(line.yieldDurationMinutes, "Equipment yield duration") : null,
        yieldUses: usageMode === "use_yield" ? parseOptionalPositiveWholeNumber(line.yieldUses, "Equipment yield uses") : null,
        yieldQuantity: usageMode !== "direct" ? parseOptionalPositiveWholeNumber(line.yieldQuantity, "Products yielded") : null,
      };

      if (usageMode === "duration_yield" && data.yieldDurationMinutes === null) {
        throw new Response("Equipment yield duration must be greater than 0.", { status: 400 });
      }
      if (usageMode === "use_yield" && data.yieldUses === null) {
        throw new Response("Equipment yield uses must be a positive whole number.", { status: 400 });
      }
      if (usageMode !== "direct" && data.yieldQuantity === null) {
        throw new Response("Products yielded must be a positive whole number.", { status: 400 });
      }

      return data;
    });

    await prisma.$transaction(async (tx) => {
      let configId = existingConfig?.id;

      if (configId) {
        await tx.variantCostConfig.updateMany({
          where: { id: configId, shopId },
          data: {
            productionTemplateId: normalizedProductionTemplateId,
            shippingTemplateId: normalizedShippingTemplateId,
            preferredPackageId: normalizedPreferredPackageId,
            packedLength: parseOptionalNonNegativeNumber(draft.packedLength, "Packed length"),
            packedWidth: parseOptionalNonNegativeNumber(draft.packedWidth, "Packed width"),
            packedHeight: parseOptionalNonNegativeNumber(draft.packedHeight, "Packed height"),
            packedWeightGrams: parseOptionalNonNegativeNumber(draft.packedWeightGrams, "Packed weight"),
            canSharePackage: draft.canSharePackage,
            laborMinutes: parseOptionalNonNegativeNumber(draft.laborMinutes, "Labor minutes"),
            laborRate: parseOptionalNonNegativeNumber(draft.laborRate, "Labor rate"),
            mistakeBuffer: parseOptionalPercent(draft.mistakeBuffer, "Mistake buffer"),
            lineItemCount: draft.materialLines.length + draft.equipmentLines.length,
          },
        });
      } else {
        const createdConfig = await tx.variantCostConfig.create({
          data: {
            shopId,
            variantId,
            productionTemplateId: normalizedProductionTemplateId,
            shippingTemplateId: normalizedShippingTemplateId,
            preferredPackageId: normalizedPreferredPackageId,
            packedLength: parseOptionalNonNegativeNumber(draft.packedLength, "Packed length"),
            packedWidth: parseOptionalNonNegativeNumber(draft.packedWidth, "Packed width"),
            packedHeight: parseOptionalNonNegativeNumber(draft.packedHeight, "Packed height"),
            packedWeightGrams: parseOptionalNonNegativeNumber(draft.packedWeightGrams, "Packed weight"),
            canSharePackage: draft.canSharePackage,
            laborMinutes: parseOptionalNonNegativeNumber(draft.laborMinutes, "Labor minutes"),
            laborRate: parseOptionalNonNegativeNumber(draft.laborRate, "Labor rate"),
            mistakeBuffer: parseOptionalPercent(draft.mistakeBuffer, "Mistake buffer"),
            lineItemCount: draft.materialLines.length + draft.equipmentLines.length,
          },
        });
        configId = createdConfig.id;
      }

      await tx.variantMaterialLine.deleteMany({ where: { configId, shopId } });
      await tx.variantEquipmentLine.deleteMany({ where: { configId, shopId } });

      if (materialOverrideLines.length + additionalMaterialLines.length > 0) {
        await tx.variantMaterialLine.createMany({
          data: [
            ...materialOverrideLines.map((line) => ({ ...line, configId })),
            ...additionalMaterialLines.map((line) => ({ ...line, configId })),
          ],
        });
      }

      if (equipmentOverrideLines.length + additionalEquipmentLines.length > 0) {
        await tx.variantEquipmentLine.createMany({
          data: [
            ...equipmentOverrideLines.map((line) => ({ ...line, configId })),
            ...additionalEquipmentLines.map((line) => ({ ...line, configId })),
          ],
        });
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "VariantCostConfig",
          entityId: configId,
          action: "VARIANT_CONFIG_UPDATED",
          actor: "merchant",
        },
      });
    });

    return jsonResponse({
      ok: true,
      message: "Variant configuration saved.",
      savedAt: new Date().toISOString(),
    });
  }

  if (intent === "copy-variant-config") {
    const parsed = copyVariantConfigSchema.safeParse({
      sourceVariantId: formData.get("sourceVariantId")?.toString() ?? "",
    });

    if (!parsed.success) {
      return jsonResponse({ ok: false, message: "Select a source variant." }, { status: 400 });
    }

    const { sourceVariantId } = parsed.data;
    if (sourceVariantId === variantId) {
      return jsonResponse({ ok: false, message: "Choose a different source variant." }, { status: 400 });
    }

    const sourceConfig = await prisma.variantCostConfig.findFirst({
      where: {
        shopId,
        variant: { id: sourceVariantId, shopId },
      },
      include: {
        materialLines: true,
        equipmentLines: true,
      },
    });

    if (!sourceConfig) {
      return jsonResponse({ ok: false, message: "Source variant configuration not found." }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      const copiedConfigData = {
        productionTemplateId: sourceConfig.productionTemplateId,
        shippingTemplateId: sourceConfig.shippingTemplateId,
        preferredPackageId: sourceConfig.preferredPackageId,
        packedLength: sourceConfig.packedLength,
        packedWidth: sourceConfig.packedWidth,
        packedHeight: sourceConfig.packedHeight,
        packedWeightGrams: sourceConfig.packedWeightGrams,
        canSharePackage: sourceConfig.canSharePackage,
        laborMinutes: sourceConfig.laborMinutes,
        laborRate: sourceConfig.laborRate,
        mistakeBuffer: sourceConfig.mistakeBuffer,
        lineItemCount: sourceConfig.materialLines.length + sourceConfig.equipmentLines.length,
      };

      const existingTargetConfig = await tx.variantCostConfig.findFirst({
        where: { variantId, shopId },
        select: { id: true },
      });

      const targetConfig = existingTargetConfig
        ? existingTargetConfig
        : await tx.variantCostConfig.create({
            data: {
              shopId,
              variantId,
              ...copiedConfigData,
            },
          });

      if (existingTargetConfig) {
        await tx.variantCostConfig.updateMany({
          where: { id: existingTargetConfig.id, shopId },
          data: copiedConfigData,
        });
      }

      await tx.variantMaterialLine.deleteMany({ where: { configId: targetConfig.id, shopId } });
      await tx.variantEquipmentLine.deleteMany({ where: { configId: targetConfig.id, shopId } });

      if (sourceConfig.materialLines.length > 0) {
        await tx.variantMaterialLine.createMany({
          data: sourceConfig.materialLines.map((line) => ({
            shopId,
            configId: targetConfig.id,
            materialId: line.materialId,
            templateLineId: line.templateLineId,
            quantity: line.quantity,
            yield: line.yield,
            usesPerVariant: line.usesPerVariant,
          })),
        });
      }

      if (sourceConfig.equipmentLines.length > 0) {
        await tx.variantEquipmentLine.createMany({
          data: sourceConfig.equipmentLines.map((line) => ({
            shopId,
            configId: targetConfig.id,
            equipmentId: line.equipmentId,
            templateLineId: line.templateLineId,
            usageMode: line.usageMode,
            minutes: line.minutes,
            uses: line.uses,
            yieldDurationMinutes: line.yieldDurationMinutes,
            yieldUses: line.yieldUses,
            yieldQuantity: line.yieldQuantity,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "VariantCostConfig",
          entityId: targetConfig.id,
          action: "VARIANT_CONFIG_COPIED",
          actor: "merchant",
          payload: {
            sourceVariantId,
            materialLineCount: sourceConfig.materialLines.length,
            equipmentLineCount: sourceConfig.equipmentLines.length,
          },
        },
      });
    });

    return jsonResponse({
      ok: true,
      message: "Variant configuration copied.",
      savedAt: new Date().toISOString(),
    });
  }

  if (intent === "promote-template") {
    const parsed = promoteTemplateSchema.safeParse({
      name: formData.get("name")?.toString() ?? "",
      description: formData.get("description")?.toString() ?? "",
      includeMaterials: formData.get("includeMaterials") === "on",
      includeEquipment: formData.get("includeEquipment") === "on",
      includeLabor: formData.get("includeLabor") === "on",
      freezeShopLaborRate: formData.get("freezeShopLaborRate") === "on",
      includeDefaultShippingTemplate: formData.get("includeDefaultShippingTemplate") === "on",
      assignBack: formData.get("assignBack") === "on",
      materialLineKeys: formData.getAll("materialLineKey").map((value) => value.toString()),
      equipmentLineKeys: formData.getAll("equipmentLineKey").map((value) => value.toString()),
    });

    if (!parsed.success) {
      return jsonResponse({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid template." }, { status: 400 });
    }

    const promotion = parsed.data;
    const selectedMaterialLineKeys = new Set(promotion.materialLineKeys);
    const selectedEquipmentLineKeys = new Set(promotion.equipmentLineKeys);
    if (!promotion.includeMaterials && !promotion.includeEquipment && !promotion.includeLabor) {
      return jsonResponse(
        { ok: false, message: "Choose at least one cost area to include in the template." },
        { status: 400 },
      );
    }

    const [sourceConfig, shop] = await Promise.all([
      prisma.variantCostConfig.findFirst({
        where: { variantId, shopId },
        include: {
          productionTemplate: {
            include: {
              materialLines: { include: { material: true }, orderBy: { material: { name: "asc" } } },
              equipmentLines: { include: { equipment: true }, orderBy: { equipment: { name: "asc" } } },
            },
          },
          shippingTemplate: { select: { id: true, type: true } },
          materialLines: { include: { material: true }, orderBy: { material: { name: "asc" } } },
          equipmentLines: { include: { equipment: true }, orderBy: { equipment: { name: "asc" } } },
        },
      }),
      prisma.shop.findUnique({
        where: { shopId },
        select: { defaultLaborRate: true },
      }),
    ]);

    if (!sourceConfig) {
      return jsonResponse({ ok: false, message: "Save a variant configuration before creating a template from it." }, { status: 400 });
    }

    const promotedMaterialLines: Array<{
      materialId: string;
      materialName: string;
      quantity: Prisma.Decimal;
      yield: Prisma.Decimal | null;
      usesPerVariant: Prisma.Decimal | null;
    }> = [];
    const retainedTemplateMaterialLines: Array<{
      materialId: string;
      quantity: Prisma.Decimal;
      yield: Prisma.Decimal | null;
      usesPerVariant: Prisma.Decimal | null;
    }> = [];
    const promotedEquipmentLines: Array<{
      equipmentId: string;
      equipmentName: string;
      usageMode: string;
      minutes: Prisma.Decimal | null;
      uses: Prisma.Decimal | null;
      yieldDurationMinutes: Prisma.Decimal | null;
      yieldUses: Prisma.Decimal | null;
      yieldQuantity: Prisma.Decimal | null;
    }> = [];
    const retainedTemplateEquipmentLines: Array<{
      equipmentId: string;
      usageMode: string;
      minutes: Prisma.Decimal | null;
      uses: Prisma.Decimal | null;
      yieldDurationMinutes: Prisma.Decimal | null;
      yieldUses: Prisma.Decimal | null;
      yieldQuantity: Prisma.Decimal | null;
    }> = [];

    if (promotion.includeMaterials || promotion.assignBack) {
      if (promotion.includeMaterials && selectedMaterialLineKeys.size === 0) {
        return jsonResponse({ ok: false, message: "Choose at least one material line to include." }, { status: 400 });
      }

      const templateMaterialSource = sourceConfig.productionTemplate?.materialLines ?? [];
      const explicitMaterialOverrides = new Map(
        sourceConfig.materialLines
          .filter((line) => line.templateLineId)
          .map((line) => [line.templateLineId as string, line]),
      );
      const materialIdTemplateCounts = buildCountMap(templateMaterialSource.map((line) => line.materialId));
      const legacyMaterialOverrides = new Map(
        sourceConfig.materialLines
          .filter(
            (line) =>
              !line.templateLineId &&
              line.material.type === "production" &&
              (materialIdTemplateCounts.get(line.materialId) ?? 0) === 1,
          )
          .map((line) => [line.materialId, line]),
      );
      const consumedMaterialLineIds = new Set<string>();

      for (const line of templateMaterialSource) {
        const override = explicitMaterialOverrides.get(line.id) ?? legacyMaterialOverrides.get(line.materialId) ?? null;
        if (override) consumedMaterialLineIds.add(override.id);
        const effectiveLine = {
          materialId: line.materialId,
          quantity: override?.quantity ?? line.quantity,
          yield: override?.yield ?? line.yield,
          usesPerVariant: override?.usesPerVariant ?? line.usesPerVariant,
        };
        if (promotion.includeMaterials && selectedMaterialLineKeys.has(`template:${line.id}`)) {
          promotedMaterialLines.push({
            ...effectiveLine,
            materialName: line.material.name,
          });
        } else {
          retainedTemplateMaterialLines.push(effectiveLine);
        }
      }

      if (promotion.includeMaterials) {
        for (const line of sourceConfig.materialLines) {
          if (
            line.templateLineId ||
            consumedMaterialLineIds.has(line.id) ||
            line.material.type !== "production" ||
            !selectedMaterialLineKeys.has(`variant:${line.id}`)
          ) continue;
          promotedMaterialLines.push({
            materialId: line.materialId,
            materialName: line.material.name,
            quantity: line.quantity,
            yield: line.yield,
            usesPerVariant: line.usesPerVariant,
          });
        }
      }

      if (promotion.includeMaterials) {
        const duplicateMaterialNames = promotedMaterialLines
          .filter((line, index, lines) => lines.findIndex((candidate) => candidate.materialId === line.materialId) !== index)
          .map((line) => line.materialName);
        if (duplicateMaterialNames.length > 0) {
          return jsonResponse(
            {
              ok: false,
              message: `Cannot create a template from duplicate production materials yet: ${[...new Set(duplicateMaterialNames)].join(", ")}.`,
            },
            { status: 400 },
          );
        }
      }
    }

    if (promotion.includeEquipment || promotion.assignBack) {
      if (promotion.includeEquipment && selectedEquipmentLineKeys.size === 0) {
        return jsonResponse({ ok: false, message: "Choose at least one equipment line to include." }, { status: 400 });
      }

      const templateEquipmentSource = sourceConfig.productionTemplate?.equipmentLines ?? [];
      const explicitEquipmentOverrides = new Map(
        sourceConfig.equipmentLines
          .filter((line) => line.templateLineId)
          .map((line) => [line.templateLineId as string, line]),
      );
      const equipmentIdTemplateCounts = buildCountMap(templateEquipmentSource.map((line) => line.equipmentId));
      const legacyEquipmentOverrides = new Map(
        sourceConfig.equipmentLines
          .filter(
            (line) =>
              !line.templateLineId &&
              (equipmentIdTemplateCounts.get(line.equipmentId) ?? 0) === 1,
          )
          .map((line) => [line.equipmentId, line]),
      );
      const consumedEquipmentLineIds = new Set<string>();

      for (const line of templateEquipmentSource) {
        const override = explicitEquipmentOverrides.get(line.id) ?? legacyEquipmentOverrides.get(line.equipmentId) ?? null;
        if (override) consumedEquipmentLineIds.add(override.id);
        const effectiveLine = {
          equipmentId: line.equipmentId,
          usageMode: override?.usageMode ?? line.usageMode ?? "direct",
          minutes: override?.minutes ?? line.minutes,
          uses: override?.uses ?? line.uses,
          yieldDurationMinutes: override?.yieldDurationMinutes ?? line.yieldDurationMinutes,
          yieldUses: override?.yieldUses ?? line.yieldUses,
          yieldQuantity: override?.yieldQuantity ?? line.yieldQuantity,
        };
        if (promotion.includeEquipment && selectedEquipmentLineKeys.has(`template:${line.id}`)) {
          promotedEquipmentLines.push({
            ...effectiveLine,
            equipmentName: line.equipment.name,
          });
        } else {
          retainedTemplateEquipmentLines.push(effectiveLine);
        }
      }

      if (promotion.includeEquipment) {
        for (const line of sourceConfig.equipmentLines) {
          if (line.templateLineId || consumedEquipmentLineIds.has(line.id) || !selectedEquipmentLineKeys.has(`variant:${line.id}`)) continue;
          promotedEquipmentLines.push({
            equipmentId: line.equipmentId,
            equipmentName: line.equipment.name,
            usageMode: line.usageMode ?? "direct",
            minutes: line.minutes,
            uses: line.uses,
            yieldDurationMinutes: line.yieldDurationMinutes,
            yieldUses: line.yieldUses,
            yieldQuantity: line.yieldQuantity,
          });
        }
      }

      if (promotion.includeEquipment) {
        const duplicateEquipmentNames = promotedEquipmentLines
          .filter((line, index, lines) => lines.findIndex((candidate) => candidate.equipmentId === line.equipmentId) !== index)
          .map((line) => line.equipmentName);
        if (duplicateEquipmentNames.length > 0) {
          return jsonResponse(
            {
              ok: false,
              message: `Cannot create a template from duplicate equipment items yet: ${[...new Set(duplicateEquipmentNames)].join(", ")}.`,
            },
            { status: 400 },
          );
        }
      }
    }

    const defaultLaborMinutes = promotion.includeLabor
      ? sourceConfig.laborMinutes ?? sourceConfig.productionTemplate?.defaultLaborMinutes ?? null
      : null;
    const defaultLaborRate = promotion.includeLabor
      ? sourceConfig.laborRate ?? sourceConfig.productionTemplate?.defaultLaborRate ?? (promotion.freezeShopLaborRate ? shop?.defaultLaborRate ?? null : null)
      : null;

    const exactPromotedVariantMaterialLineIds = sourceConfig.materialLines
      .filter((line) => promotion.includeMaterials && !line.templateLineId && line.material.type === "production" && selectedMaterialLineKeys.has(`variant:${line.id}`))
      .map((line) => line.id);
    const exactPromotedVariantEquipmentLineIds = sourceConfig.equipmentLines
      .filter((line) => promotion.includeEquipment && !line.templateLineId && selectedEquipmentLineKeys.has(`variant:${line.id}`))
      .map((line) => line.id);
    const staleMaterialOverrideCount = sourceConfig.materialLines.filter((line) => line.templateLineId).length;
    const staleEquipmentOverrideCount = sourceConfig.equipmentLines.filter((line) => line.templateLineId).length;
    const retainedMaterialLineCount = promotion.assignBack
      ? sourceConfig.materialLines.filter((line) => !line.templateLineId && !exactPromotedVariantMaterialLineIds.includes(line.id)).length +
        retainedTemplateMaterialLines.length
      : sourceConfig.materialLines.filter((line) => !line.templateLineId).length;
    const retainedEquipmentLineCount = promotion.assignBack
      ? sourceConfig.equipmentLines.filter((line) => !line.templateLineId && !exactPromotedVariantEquipmentLineIds.includes(line.id)).length +
        retainedTemplateEquipmentLines.length
      : sourceConfig.equipmentLines.filter((line) => !line.templateLineId).length;

    const template = await prisma.$transaction(async (tx) => {
      const createdTemplate = await tx.costTemplate.create({
        data: {
          shopId,
          name: promotion.name,
          type: "production",
          description: promotion.description || null,
          defaultLaborMinutes,
          defaultLaborRate,
          defaultShippingTemplateId:
            promotion.includeDefaultShippingTemplate && sourceConfig.shippingTemplate?.type === "shipping"
              ? sourceConfig.shippingTemplate.id
              : null,
        },
      });

      if (promotedMaterialLines.length > 0) {
        await tx.costTemplateMaterialLine.createMany({
          data: promotedMaterialLines.map((line) => ({
            templateId: createdTemplate.id,
            materialId: line.materialId,
            quantity: line.quantity,
            yield: line.yield,
            usesPerVariant: line.usesPerVariant,
          })),
        });
      }

      if (promotedEquipmentLines.length > 0) {
        await tx.costTemplateEquipmentLine.createMany({
          data: promotedEquipmentLines.map((line) => ({
            templateId: createdTemplate.id,
            equipmentId: line.equipmentId,
            usageMode: line.usageMode,
            minutes: line.minutes,
            uses: line.uses,
            yieldDurationMinutes: line.yieldDurationMinutes,
            yieldUses: line.yieldUses,
            yieldQuantity: line.yieldQuantity,
          })),
        });
      }

      if (promotion.assignBack) {
        await tx.variantCostConfig.updateMany({
          where: { id: sourceConfig.id, shopId },
          data: {
            productionTemplateId: createdTemplate.id,
            lineItemCount: retainedMaterialLineCount + retainedEquipmentLineCount,
          },
        });

        await tx.variantMaterialLine.deleteMany({
          where: {
            configId: sourceConfig.id,
            shopId,
            OR: [
              { templateLineId: { not: null } },
              { id: { in: exactPromotedVariantMaterialLineIds } },
            ],
          },
        });
        await tx.variantEquipmentLine.deleteMany({
          where: {
            configId: sourceConfig.id,
            shopId,
            OR: [
              { templateLineId: { not: null } },
              { id: { in: exactPromotedVariantEquipmentLineIds } },
            ],
          },
        });

        if (retainedTemplateMaterialLines.length > 0) {
          await tx.variantMaterialLine.createMany({
            data: retainedTemplateMaterialLines.map((line) => ({
              shopId,
              configId: sourceConfig.id,
              materialId: line.materialId,
              quantity: line.quantity,
              yield: line.yield,
              usesPerVariant: line.usesPerVariant,
            })),
          });
        }

        if (retainedTemplateEquipmentLines.length > 0) {
          await tx.variantEquipmentLine.createMany({
            data: retainedTemplateEquipmentLines.map((line) => ({
              shopId,
              configId: sourceConfig.id,
              equipmentId: line.equipmentId,
              usageMode: line.usageMode,
              minutes: line.minutes,
              uses: line.uses,
              yieldDurationMinutes: line.yieldDurationMinutes,
              yieldUses: line.yieldUses,
              yieldQuantity: line.yieldQuantity,
            })),
          });
        }
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "CostTemplate",
          entityId: createdTemplate.id,
          action: "TEMPLATE_CREATED_FROM_VARIANT",
          actor: "merchant",
          payload: {
            variantId,
            materialLineCount: promotedMaterialLines.length,
            equipmentLineCount: promotedEquipmentLines.length,
            assignedBack: promotion.assignBack,
          },
        },
      });

      if (promotion.assignBack) {
        await tx.auditLog.create({
          data: {
            shopId,
            entity: "VariantCostConfig",
            entityId: sourceConfig.id,
            action: "TEMPLATE_ASSIGNED_FROM_VARIANT_PROMOTION",
            actor: "merchant",
            payload: {
              templateId: createdTemplate.id,
              removedMaterialLineCount: exactPromotedVariantMaterialLineIds.length + staleMaterialOverrideCount,
              removedEquipmentLineCount: exactPromotedVariantEquipmentLineIds.length + staleEquipmentOverrideCount,
            },
          },
        });
      }

      return createdTemplate;
    });

    const cleanupMessage = promotion.assignBack
      ? ` Assigned to this variant and cleaned up ${exactPromotedVariantMaterialLineIds.length + staleMaterialOverrideCount} material row(s) and ${exactPromotedVariantEquipmentLineIds.length + staleEquipmentOverrideCount} equipment row(s).`
      : "";
    const retainedMessage =
      promotion.assignBack && retainedMaterialLineCount + retainedEquipmentLineCount > 0
        ? ` ${retainedMaterialLineCount + retainedEquipmentLineCount} variant-specific row(s) remain for review.`
        : "";

    return jsonResponse({
      ok: true,
      message: `Template "${template.name}" created.${cleanupMessage}${retainedMessage}`,
      savedAt: new Date().toISOString(),
      templateId: template.id,
    });
  }

  if (intent === "promote-shipping-template") {
    const parsed = promoteShippingTemplateSchema.safeParse({
      name: formData.get("name")?.toString() ?? "",
      description: formData.get("description")?.toString() ?? "",
      assignBack: formData.get("assignBack") === "on",
      setAsProductionDefault: formData.get("setAsProductionDefault") === "on",
      materialLineKeys: formData.getAll("materialLineKey").map((value) => value.toString()),
    });

    if (!parsed.success) {
      return jsonResponse({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid shipping template." }, { status: 400 });
    }

    const promotion = parsed.data;
    const selectedMaterialLineKeys = new Set(promotion.materialLineKeys);
    const sourceConfig = await prisma.variantCostConfig.findFirst({
      where: { variantId, shopId },
      include: {
        productionTemplate: { select: { id: true, type: true } },
        shippingTemplate: {
          include: {
            materialLines: { include: { material: true }, orderBy: { material: { name: "asc" } } },
          },
        },
        materialLines: { include: { material: true }, orderBy: { material: { name: "asc" } } },
        equipmentLines: { select: { id: true } },
      },
    });

    if (!sourceConfig) {
      return jsonResponse({ ok: false, message: "Save a variant configuration before creating a shipping template from it." }, { status: 400 });
    }

    const promotedShippingLines: Array<{
      materialId: string;
      materialName: string;
      quantity: Prisma.Decimal;
      yield: Prisma.Decimal | null;
      usesPerVariant: Prisma.Decimal | null;
    }> = [];
    const retainedTemplateShippingLines: Array<{
      materialId: string;
      quantity: Prisma.Decimal;
      yield: Prisma.Decimal | null;
      usesPerVariant: Prisma.Decimal | null;
    }> = [];

    for (const line of sourceConfig.shippingTemplate?.materialLines ?? []) {
      const effectiveLine = {
        materialId: line.materialId,
        quantity: line.quantity,
        yield: line.yield,
        usesPerVariant: line.usesPerVariant,
      };
      if (selectedMaterialLineKeys.has(`template:${line.id}`)) {
        promotedShippingLines.push({
          ...effectiveLine,
          materialName: line.material.name,
        });
      } else {
        retainedTemplateShippingLines.push(effectiveLine);
      }
    }

    for (const line of sourceConfig.materialLines) {
      if (line.templateLineId || line.material.type !== "shipping" || !selectedMaterialLineKeys.has(`variant:${line.id}`)) continue;
      promotedShippingLines.push({
        materialId: line.materialId,
        materialName: line.material.name,
        quantity: line.quantity,
        yield: line.yield,
        usesPerVariant: line.usesPerVariant,
      });
    }

    const duplicateMaterialNames = promotedShippingLines
      .filter((line, index, lines) => lines.findIndex((candidate) => candidate.materialId === line.materialId) !== index)
      .map((line) => line.materialName);
    if (duplicateMaterialNames.length > 0) {
      return jsonResponse(
        {
          ok: false,
          message: `Cannot create a shipping template from duplicate shipping materials yet: ${[...new Set(duplicateMaterialNames)].join(", ")}.`,
        },
        { status: 400 },
      );
    }

    const promotedVariantShippingLineIds = sourceConfig.materialLines
      .filter((line) => !line.templateLineId && line.material.type === "shipping" && selectedMaterialLineKeys.has(`variant:${line.id}`))
      .map((line) => line.id);
    const retainedMaterialLineCount = promotion.assignBack
      ? sourceConfig.materialLines.filter((line) => !promotedVariantShippingLineIds.includes(line.id)).length +
        retainedTemplateShippingLines.length
      : sourceConfig.materialLines.length;
    const retainedEquipmentLineCount = sourceConfig.equipmentLines.length;

    const template = await prisma.$transaction(async (tx) => {
      const createdTemplate = await tx.costTemplate.create({
        data: {
          shopId,
          name: promotion.name,
          type: "shipping",
          description: promotion.description || null,
        },
      });

      await tx.costTemplateMaterialLine.createMany({
        data: promotedShippingLines.map((line) => ({
          templateId: createdTemplate.id,
          materialId: line.materialId,
          quantity: line.quantity,
          yield: line.yield,
          usesPerVariant: line.usesPerVariant,
        })),
      });

      if (promotion.assignBack) {
        await tx.variantCostConfig.updateMany({
          where: { id: sourceConfig.id, shopId },
          data: {
            shippingTemplateId: createdTemplate.id,
            lineItemCount: retainedMaterialLineCount + retainedEquipmentLineCount,
          },
        });

        await tx.variantMaterialLine.deleteMany({
          where: {
            configId: sourceConfig.id,
            shopId,
            id: { in: promotedVariantShippingLineIds },
          },
        });

        if (retainedTemplateShippingLines.length > 0) {
          await tx.variantMaterialLine.createMany({
            data: retainedTemplateShippingLines.map((line) => ({
              shopId,
              configId: sourceConfig.id,
              materialId: line.materialId,
              quantity: line.quantity,
              yield: line.yield,
              usesPerVariant: line.usesPerVariant,
            })),
          });
        }
      }

      if (promotion.setAsProductionDefault && sourceConfig.productionTemplateId) {
        await tx.costTemplate.updateMany({
          where: { id: sourceConfig.productionTemplateId, shopId, type: { not: "shipping" } },
          data: { defaultShippingTemplateId: createdTemplate.id },
        });
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "CostTemplate",
          entityId: createdTemplate.id,
          action: "SHIPPING_TEMPLATE_CREATED_FROM_VARIANT",
          actor: "merchant",
          payload: {
            variantId,
            materialLineCount: promotedShippingLines.length,
            assignedBack: promotion.assignBack,
            setAsProductionDefault: promotion.setAsProductionDefault,
          },
        },
      });

      if (promotion.assignBack || promotion.setAsProductionDefault) {
        await tx.auditLog.create({
          data: {
            shopId,
            entity: "VariantCostConfig",
            entityId: sourceConfig.id,
            action: "SHIPPING_TEMPLATE_PROMOTION_APPLIED",
            actor: "merchant",
            payload: {
              templateId: createdTemplate.id,
              assignedBack: promotion.assignBack,
              setAsProductionDefault: promotion.setAsProductionDefault,
              removedMaterialLineCount: promotedVariantShippingLineIds.length,
            },
          },
        });
      }

      return createdTemplate;
    });

    const cleanupMessage = promotion.assignBack
      ? ` Assigned to this variant and cleaned up ${promotedVariantShippingLineIds.length} shipping material row(s).`
      : "";
    const defaultMessage = promotion.setAsProductionDefault ? " Set as the current production template's default shipping template." : "";
    const retainedMessage =
      promotion.assignBack && retainedMaterialLineCount + retainedEquipmentLineCount > 0
        ? ` ${retainedMaterialLineCount + retainedEquipmentLineCount} variant-specific row(s) remain for review.`
        : "";

    return jsonResponse({
      ok: true,
      message: `Shipping template "${template.name}" created.${cleanupMessage}${defaultMessage}${retainedMessage}`,
      savedAt: new Date().toISOString(),
      templateId: template.id,
    });
  }

  if (intent === "assign-template") {
    const templateId = formData.get("templateId")?.toString() ?? "";
    await requireTemplate(templateId);
    const config = await ensureConfig();
    const currentConfig = await prisma.variantCostConfig.findFirst({
      where: { id: config.id, shopId },
      include: {
        productionTemplate: {
          select: {
            materialLines: { select: { materialId: true } },
            equipmentLines: { select: { equipmentId: true } },
          },
        },
      },
    });
    const legacyOverrideIds = getLegacyOverrideIds(currentConfig?.productionTemplate);

    await prisma.$transaction([
      prisma.variantCostConfig.updateMany({
        where: { id: config.id, shopId },
        data: { productionTemplateId: templateId },
      }),
      prisma.variantMaterialLine.deleteMany({
        where: {
          configId: config.id,
          shopId,
          OR: [
            { templateLineId: { not: null } },
            { templateLineId: null, materialId: { in: legacyOverrideIds.materialIds } },
          ],
        },
      }),
      prisma.variantEquipmentLine.deleteMany({
        where: {
          configId: config.id,
          shopId,
          OR: [
            { templateLineId: { not: null } },
            { templateLineId: null, equipmentId: { in: legacyOverrideIds.equipmentIds } },
          ],
        },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "VariantCostConfig",
        entityId: config.id,
        action: "TEMPLATE_ASSIGNED",
        actor: "merchant",
        payload: { templateId },
      },
    });
    return jsonResponse({ ok: true, message: "Template assigned." });
  }

  if (intent === "remove-template") {
    const config = await prisma.variantCostConfig.findFirst({
      where: { variantId, shopId },
      include: {
        productionTemplate: {
          select: {
            materialLines: { select: { materialId: true } },
            equipmentLines: { select: { equipmentId: true } },
          },
        },
      },
    });
    if (config) {
      const legacyOverrideIds = getLegacyOverrideIds(config.productionTemplate);
      await prisma.$transaction([
        prisma.variantCostConfig.updateMany({
          where: { id: config.id, shopId },
          data: { productionTemplateId: null },
        }),
        prisma.variantMaterialLine.deleteMany({
          where: {
            configId: config.id,
            shopId,
            OR: [
              { templateLineId: { not: null } },
              { templateLineId: null, materialId: { in: legacyOverrideIds.materialIds } },
            ],
          },
        }),
        prisma.variantEquipmentLine.deleteMany({
          where: {
            configId: config.id,
            shopId,
            OR: [
              { templateLineId: { not: null } },
              { templateLineId: null, equipmentId: { in: legacyOverrideIds.equipmentIds } },
            ],
          },
        }),
      ]);
      await prisma.auditLog.create({
        data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "TEMPLATE_REMOVED", actor: "merchant" },
      });
    }
    return jsonResponse({ ok: true, message: "Template removed." });
  }

  if (intent === "update-labor") {
    const laborMinutes = formData.get("laborMinutes")?.toString();
    const laborRate = formData.get("laborRate")?.toString();
    const config = await ensureConfig();
    let parsedLaborMinutes: number | null;
    let parsedLaborRate: Prisma.Decimal | null;

    try {
      parsedLaborMinutes = parseOptionalNonNegativeNumber(laborMinutes, "Labor minutes");
      parsedLaborRate = parseOptionalNonNegativeMoney(laborRate, "Labor rate");
    } catch (error) {
      if (error instanceof Response) {
        return jsonResponse({ ok: false, message: await error.text() }, { status: error.status });
      }
      throw error;
    }

    await prisma.variantCostConfig.updateMany({
      where: { id: config.id, shopId },
      data: {
        laborMinutes: parsedLaborMinutes,
        laborRate: parsedLaborRate,
      },
    });
    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "LABOR_UPDATED", actor: "merchant" },
    });
    return jsonResponse({ ok: true, message: "Labor updated." });
  }

  if (intent === "update-mistake-buffer") {
    const bufferStr = formData.get("mistakeBuffer")?.toString() ?? "";
    let buffer: Prisma.Decimal | null;

    try {
      buffer = parseOptionalPercentInputToRate(bufferStr, "Mistake buffer");
    } catch (error) {
      if (error instanceof Response) {
        return jsonResponse({ ok: false, message: await error.text() }, { status: error.status });
      }
      throw error;
    }

    const config = await ensureConfig();
    await prisma.variantCostConfig.updateMany({
      where: { id: config.id, shopId },
      data: { mistakeBuffer: buffer },
    });
    return jsonResponse({ ok: true, message: "Mistake buffer updated." });
  }

  if (intent === "save-material-override") {
    const templateLineId = formData.get("templateLineId")?.toString() ?? "";
    const materialId = formData.get("materialId")?.toString() ?? "";
    const quantity = parseRequiredNonNegativeWholeNumber(formData.get("quantity")?.toString(), "Material quantity");
    const yieldVal = formData.get("yield")?.toString();
    const usesPerVariant = formData.get("usesPerVariant")?.toString();
    const parsedYield = parseOptionalNonNegativeWholeNumber(yieldVal, "Items made from one purchased unit");
    const parsedUsesPerVariant = parseOptionalNonNegativeWholeNumber(usesPerVariant, "Portions used per item");
    const config = await ensureConfig();
    const templateLine = await requireTemplateMaterialLine(config.id, templateLineId);
    await requireMaterial(materialId);

    const existing = await prisma.variantMaterialLine.findFirst({
      where: { configId: config.id, shopId, templateLineId },
      select: { id: true },
    });
    const legacy = !existing && templateLine.isUniqueMaterial
      ? await prisma.variantMaterialLine.findFirst({
          where: { configId: config.id, shopId, templateLineId: null, materialId: templateLine.materialId },
          select: { id: true },
        })
      : null;

    if (existing) {
      await prisma.variantMaterialLine.updateMany({
        where: { id: existing.id, shopId },
        data: {
          materialId,
          quantity,
          yield: parsedYield,
          usesPerVariant: parsedUsesPerVariant,
        },
      });
    } else if (legacy) {
      await prisma.variantMaterialLine.updateMany({
        where: { id: legacy.id, shopId },
        data: {
          templateLineId,
          materialId,
          quantity,
          yield: parsedYield,
          usesPerVariant: parsedUsesPerVariant,
        },
      });
    } else {
      await prisma.variantMaterialLine.create({
        data: {
          shopId,
          configId: config.id,
          templateLineId,
          materialId,
          quantity,
          yield: parsedYield,
          usesPerVariant: parsedUsesPerVariant,
        },
      });
    }

    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "MATERIAL_OVERRIDE_SAVED", actor: "merchant" },
    });
    return jsonResponse({ ok: true, message: "Material override saved." });
  }

  if (intent === "reset-material-override") {
    const templateLineId = formData.get("templateLineId")?.toString() ?? "";
    const config = await prisma.variantCostConfig.findFirst({ where: { variantId, shopId }, select: { id: true } });
    if (!config) return jsonResponse({ ok: false, message: "Configuration not found." }, { status: 404 });
    const templateLine = await requireTemplateMaterialLine(config.id, templateLineId);

    await prisma.variantMaterialLine.deleteMany({
      where: {
        configId: config.id,
        shopId,
        OR: [
          { templateLineId },
          ...(templateLine.isUniqueMaterial ? [{ templateLineId: null, materialId: templateLine.materialId }] : []),
        ],
      },
    });
    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "MATERIAL_OVERRIDE_RESET", actor: "merchant" },
    });
    return jsonResponse({ ok: true, message: "Material override reset." });
  }

  if (intent === "add-material-line") {
    const materialId = formData.get("materialId")?.toString() ?? "";
    const quantity = parseRequiredNonNegativeWholeNumber(formData.get("quantity")?.toString(), "Material quantity");
    const yieldVal = formData.get("yield")?.toString();
    const usesPerVariant = formData.get("usesPerVariant")?.toString();
    const parsedYield = parseOptionalNonNegativeWholeNumber(yieldVal, "Items made from one purchased unit");
    const parsedUsesPerVariant = parseOptionalNonNegativeWholeNumber(usesPerVariant, "Portions used per item");
    const config = await ensureConfig();

    await prisma.$transaction([
      prisma.variantMaterialLine.create({
        data: {
          shopId,
          configId: config.id,
          materialId,
          quantity,
          yield: parsedYield,
          usesPerVariant: parsedUsesPerVariant,
        },
      }),
      prisma.variantCostConfig.updateMany({
        where: { id: config.id, shopId },
        data: { lineItemCount: { increment: 1 } },
      }),
    ]);

    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "MATERIAL_LINE_ADDED", actor: "merchant" },
    });
    return jsonResponse({ ok: true, message: "Material line added." });
  }

  if (intent === "remove-material-line") {
    const lineId = formData.get("lineId")?.toString() ?? "";
    const line = await prisma.variantMaterialLine.findFirst({
      where: { id: lineId, shopId, templateLineId: null },
      select: { configId: true },
    });
    if (!line) return jsonResponse({ ok: false, message: "Line not found." }, { status: 404 });

    await prisma.$transaction([
      prisma.variantMaterialLine.deleteMany({ where: { id: lineId, shopId } }),
      prisma.variantCostConfig.updateMany({
        where: { id: line.configId, shopId },
        data: { lineItemCount: { decrement: 1 } },
      }),
    ]);

    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: line.configId, action: "MATERIAL_LINE_REMOVED", actor: "merchant" },
    });
    return jsonResponse({ ok: true, message: "Material line removed." });
  }

  if (intent === "save-equipment-override") {
    const templateLineId = formData.get("templateLineId")?.toString() ?? "";
    const equipmentId = formData.get("equipmentId")?.toString() ?? "";
    const minutes = formData.get("minutes")?.toString();
    const uses = formData.get("uses")?.toString();
    const config = await ensureConfig();
    const templateLine = await requireTemplateEquipmentLine(config.id, templateLineId);
    await requireEquipment(equipmentId);

    const existing = await prisma.variantEquipmentLine.findFirst({
      where: { configId: config.id, shopId, templateLineId },
      select: { id: true },
    });
    const legacy = !existing && templateLine.isUniqueEquipment
      ? await prisma.variantEquipmentLine.findFirst({
          where: { configId: config.id, shopId, templateLineId: null, equipmentId: templateLine.equipmentId },
          select: { id: true },
        })
      : null;

    if (existing) {
      await prisma.variantEquipmentLine.updateMany({
        where: { id: existing.id, shopId },
        data: {
          equipmentId,
          minutes: minutes ? parseFloat(minutes) : null,
          uses: uses ? parseFloat(uses) : null,
        },
      });
    } else if (legacy) {
      await prisma.variantEquipmentLine.updateMany({
        where: { id: legacy.id, shopId },
        data: {
          templateLineId,
          equipmentId,
          minutes: minutes ? parseFloat(minutes) : null,
          uses: uses ? parseFloat(uses) : null,
        },
      });
    } else {
      await prisma.variantEquipmentLine.create({
        data: {
          shopId,
          configId: config.id,
          templateLineId,
          equipmentId,
          minutes: minutes ? parseFloat(minutes) : null,
          uses: uses ? parseFloat(uses) : null,
        },
      });
    }

    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "EQUIPMENT_OVERRIDE_SAVED", actor: "merchant" },
    });
    return jsonResponse({ ok: true, message: "Equipment override saved." });
  }

  if (intent === "reset-equipment-override") {
    const templateLineId = formData.get("templateLineId")?.toString() ?? "";
    const config = await prisma.variantCostConfig.findFirst({ where: { variantId, shopId }, select: { id: true } });
    if (!config) return jsonResponse({ ok: false, message: "Configuration not found." }, { status: 404 });
    const templateLine = await requireTemplateEquipmentLine(config.id, templateLineId);

    await prisma.variantEquipmentLine.deleteMany({
      where: {
        configId: config.id,
        shopId,
        OR: [
          { templateLineId },
          ...(templateLine.isUniqueEquipment ? [{ templateLineId: null, equipmentId: templateLine.equipmentId }] : []),
        ],
      },
    });
    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "EQUIPMENT_OVERRIDE_RESET", actor: "merchant" },
    });
    return jsonResponse({ ok: true, message: "Equipment override reset." });
  }

  if (intent === "add-equipment-line") {
    const equipmentId = formData.get("equipmentId")?.toString() ?? "";
    const minutes = formData.get("minutes")?.toString();
    const uses = formData.get("uses")?.toString();
    const config = await ensureConfig();

    await prisma.$transaction([
      prisma.variantEquipmentLine.create({
        data: {
          shopId,
          configId: config.id,
          equipmentId,
          minutes: minutes ? parseFloat(minutes) : null,
          uses: uses ? parseFloat(uses) : null,
        },
      }),
      prisma.variantCostConfig.updateMany({
        where: { id: config.id, shopId },
        data: { lineItemCount: { increment: 1 } },
      }),
    ]);

    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "EQUIPMENT_LINE_ADDED", actor: "merchant" },
    });
    return jsonResponse({ ok: true, message: "Equipment line added." });
  }

  if (intent === "remove-equipment-line") {
    const lineId = formData.get("lineId")?.toString() ?? "";
    const line = await prisma.variantEquipmentLine.findFirst({
      where: { id: lineId, shopId, templateLineId: null },
      select: { configId: true },
    });
    if (!line) return jsonResponse({ ok: false, message: "Line not found." }, { status: 404 });

    await prisma.$transaction([
      prisma.variantEquipmentLine.deleteMany({ where: { id: lineId, shopId } }),
      prisma.variantCostConfig.updateMany({
        where: { id: line.configId, shopId },
        data: { lineItemCount: { decrement: 1 } },
      }),
    ]);

    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: line.configId, action: "EQUIPMENT_LINE_REMOVED", actor: "merchant" },
    });
    return jsonResponse({ ok: true, message: "Equipment line removed." });
  }

  if (intent === "preview-cost") {
    const estimate = await buildAdminVariantEstimate(shopId, variantId);
    if (!estimate) {
      return jsonResponse({ ok: false, message: "Not found." }, { status: 404 });
    }
    return jsonResponse({
      ok: true,
      preview: estimate,
    });
  }

  return jsonResponse({ ok: false, message: "Unknown action." }, { status: 400 });
};

type AvailableMaterial = {
  id: string;
  name: string;
  type: string;
  costingModel: string | null;
  perUnitCost: string;
  totalUsesPerUnit: string | null;
};

type AvailableEquipment = {
  id: string;
  name: string;
  usageBasis: string;
  hourlyRate: string | null;
  perUseCost: string | null;
};

type CopySourceVariant = {
  id: string;
  title: string;
  sku: string;
  productTitle: string;
  templateName: string | null;
  lineItemCount: number;
};

function describeMaterialLine(line: {
  costingModel: string | null;
  quantity: string | null;
  yield: string | null;
  usesPerVariant: string | null;
}) {
  if (line.costingModel === "counted") {
    return `Counted parts: ${line.quantity ?? "0"} per item`;
  }

  if (line.costingModel === "uses") {
    return `Portioned use: ${line.usesPerVariant ?? "0"} portion(s) per item`;
  }

  return `Variable yield: ${line.quantity ?? "0"} purchased unit(s), ${line.yield ?? "0"} items per purchased unit`;
}

function describeEquipmentLine(line: {
  usageMode?: string | null;
  minutes: string | null;
  uses: string | null;
  yieldDurationMinutes?: string | null;
  yieldUses?: string | null;
  yieldQuantity?: string | null;
}) {
  if (line.usageMode === "duration_yield") {
    return `${line.yieldDurationMinutes ?? "-"} min yields ${line.yieldQuantity ?? "-"} products`;
  }
  if (line.usageMode === "use_yield") {
    return `${line.yieldUses ?? "-"} uses yields ${line.yieldQuantity ?? "-"} products`;
  }
  return [line.minutes ? `${line.minutes} min` : null, line.uses ? `${line.uses} uses` : null]
    .filter(Boolean)
    .join(" · ");
}

function buildVariantDraft(config: {
  productionTemplateId?: string | null;
  shippingTemplateId?: string | null;
  preferredPackageId?: string | null;
  packedLength: string;
  packedWidth: string;
  packedHeight: string;
  packedWeightGrams: string;
  canSharePackage: boolean;
  laborMinutes: string;
  laborRate: string;
  mistakeBuffer: string;
  templateMaterialLines: TemplateMaterialOverrideLine[];
  templateEquipmentLines: TemplateEquipmentOverrideLine[];
  materialLines: SerializedMaterialLine[];
  equipmentLines: SerializedEquipmentLine[];
} | null): VariantDraft {
  return {
    productionTemplateId: config?.productionTemplateId ?? null,
    shippingTemplateId: config?.shippingTemplateId ?? null,
    preferredPackageId: config?.preferredPackageId ?? null,
    packedLength: config?.packedLength ?? "",
    packedWidth: config?.packedWidth ?? "",
    packedHeight: config?.packedHeight ?? "",
    packedWeightGrams: config?.packedWeightGrams ?? "",
    canSharePackage: config?.canSharePackage ?? true,
    laborMinutes: config?.laborMinutes ?? "",
    laborRate: config?.laborRate ?? "",
    mistakeBuffer: config?.mistakeBuffer ?? "",
    templateMaterialLines: cloneDraft(config?.templateMaterialLines ?? []),
    templateEquipmentLines: cloneDraft(config?.templateEquipmentLines ?? []),
    materialLines: cloneDraft(config?.materialLines ?? []),
    equipmentLines: cloneDraft(config?.equipmentLines ?? []),
  };
}

function serializeVariantDraftState(draft: VariantDraft) {
  return JSON.stringify(normalizeVariantDraft(draft));
}

export default function VariantDetailPage() {
	  const {
	    variant,
	    config,
	    shopDefaults,
	    templates,
	    availableMaterials: loadedMaterials,
	    availableEquipment: loadedEquipment,
	    copySourceVariants,
	  } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<{ ok: boolean; message: string; savedAt?: string }>();
  const copyFetcher = useFetcher<{ ok: boolean; message: string; savedAt?: string }>();
  const promoteFetcher = useFetcher<{ ok: boolean; message: string; savedAt?: string; templateId?: string }>();
  const quickCreateFetcher = useFetcher<{
    ok: boolean;
    message: string;
    actionKind?: "quick-create-material" | "quick-create-equipment";
    material?: AvailableMaterial;
    equipment?: AvailableEquipment;
  }>();
  const previewFetcher = useFetcher<{
    ok: boolean;
    message: string;
    preview?: VariantEstimatePayload;
  }>();
  const revalidator = useRevalidator();

  const { formatMoney, formatPct, getCurrencySymbol } = useAppLocalization();

  const [assignTemplateOpen, setAssignTemplateOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    config?.productionTemplateId ??
      templates.find((template: TemplateCatalogEntry) => template.type !== "shipping")?.id ??
      "",
  );
  const [assignShippingTemplateOpen, setAssignShippingTemplateOpen] = useState(false);
  const [selectedShippingTemplateId, setSelectedShippingTemplateId] = useState(
    config?.shippingTemplateId ??
      templates.find((template: TemplateCatalogEntry) => template.type === "shipping")?.id ??
      "",
  );

  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [materialSearchValue, setMaterialSearchValue] = useState("");
  const [matQty, setMatQty] = useState("1");
  const [matYield, setMatYield] = useState("1");
  const [matUses, setMatUses] = useState("");
  const [quickMaterialOpen, setQuickMaterialOpen] = useState(false);
  const [quickMaterialForm, setQuickMaterialForm] = useState({
    name: "",
    type: "production",
    costingModel: "counted",
    purchasePrice: "",
    purchaseQty: "1",
    totalUsesPerUnit: "",
    purchaseLink: "",
  });

  const [materialOverrideTargetId, setMaterialOverrideTargetId] = useState<string | null>(null);
  const [overrideMatQty, setOverrideMatQty] = useState("1");
  const [overrideMatYield, setOverrideMatYield] = useState("");
  const [overrideMatUses, setOverrideMatUses] = useState("");

  const [addEquipmentOpen, setAddEquipmentOpen] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [equipmentSearchValue, setEquipmentSearchValue] = useState("");
  const [eqUsageMode, setEqUsageMode] = useState("direct");
  const [eqMinutes, setEqMinutes] = useState("");
  const [eqUses, setEqUses] = useState("");
  const [eqYieldDurationMinutes, setEqYieldDurationMinutes] = useState("");
  const [eqYieldUses, setEqYieldUses] = useState("");
  const [eqYieldQuantity, setEqYieldQuantity] = useState("");
  const [quickEquipmentOpen, setQuickEquipmentOpen] = useState(false);
  const [quickEquipmentForm, setQuickEquipmentForm] = useState({
    name: "",
    hourlyRate: "",
    perUseCost: "",
    equipmentCost: "",
    purchaseLink: "",
  });

  const [equipmentOverrideTargetId, setEquipmentOverrideTargetId] = useState<string | null>(null);
  const [overrideEqUsageMode, setOverrideEqUsageMode] = useState("direct");
  const [overrideEqMinutes, setOverrideEqMinutes] = useState("");
  const [overrideEqUses, setOverrideEqUses] = useState("");
  const [overrideEqYieldDurationMinutes, setOverrideEqYieldDurationMinutes] = useState("");
  const [overrideEqYieldUses, setOverrideEqYieldUses] = useState("");
  const [overrideEqYieldQuantity, setOverrideEqYieldQuantity] = useState("");

  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [selectedCopySourceId, setSelectedCopySourceId] = useState("");
  const [copySourceSearchValue, setCopySourceSearchValue] = useState("");
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [promoteForm, setPromoteForm] = useState({
    name: `${variant.productTitle} - ${variant.title}`,
    description: "",
    includeMaterials: true,
    includeEquipment: true,
    includeLabor: true,
    freezeShopLaborRate: false,
    includeDefaultShippingTemplate: true,
    assignBack: false,
    materialLineKeys: [] as string[],
    equipmentLineKeys: [] as string[],
  });
  const [promoteShippingDialogOpen, setPromoteShippingDialogOpen] = useState(false);
  const [promoteShippingForm, setPromoteShippingForm] = useState({
    name: `${variant.productTitle} - ${variant.title} Shipping`,
    description: "",
    assignBack: false,
    setAsProductionDefault: false,
    materialLineKeys: [] as string[],
  });

  const [baseDraft, setBaseDraft] = useState(() => buildVariantDraft(config));
  const [draft, setDraft] = useState(() => buildVariantDraft(config));
  const [availableMaterials, setAvailableMaterials] = useState<AvailableMaterial[]>(() => loadedMaterials);
  const [availableEquipment, setAvailableEquipment] = useState<AvailableEquipment[]>(() => loadedEquipment);
  const handledSaveRef = useRef<string | null>(null);
  const handledCopyRef = useRef<string | null>(null);
  const handledPromoteRef = useRef<string | null>(null);
  const preCopyDraftStateRef = useRef<string | null>(null);

	  const isSaving = saveFetcher.state !== "idle";
	  const isCopying = copyFetcher.state !== "idle";
	  const productionTemplates = templates.filter((template: TemplateCatalogEntry) => template.type !== "shipping");
	  const shippingTemplates = templates.filter((template: TemplateCatalogEntry) => template.type === "shipping");
  const effectiveTemplateSelection = resolveEffectiveTemplateSelection(
    {
      productionTemplateId: draft.productionTemplateId ?? null,
      shippingTemplateId: draft.shippingTemplateId ?? null,
    },
    templates,
  );
  const assignedProductionTemplate =
    templates.find((template: TemplateCatalogEntry) => template.id === effectiveTemplateSelection.productionTemplateId) ?? null;
  const effectiveShippingTemplate =
    templates.find((template: TemplateCatalogEntry) => template.id === effectiveTemplateSelection.shippingTemplateId) ?? null;
  const shippingTemplateMaterialLines = effectiveShippingTemplate?.materialLines ?? [];
  const preview = previewFetcher.data?.preview;
  const selectedMaterial = availableMaterials.find((material: AvailableMaterial) => material.id === selectedMaterialId);
  const selectedEquipment = availableEquipment.find((equipment: AvailableEquipment) => equipment.id === selectedEquipmentId);
  const selectedEquipmentUsageBasis = selectedEquipment?.usageBasis ?? "time_and_unit";
  const equipmentUsageModeOptions = usageModeOptionsForBasis(selectedEquipmentUsageBasis);
  const equipmentOverrideTarget =
    draft.templateEquipmentLines.find((line: VariantTemplateEquipmentDraftLine) => line.templateLineId === equipmentOverrideTargetId) ?? null;
  const equipmentOverrideUsageBasis = equipmentOverrideTarget?.usageBasis ?? "time_and_unit";
  const equipmentOverrideUsageModeOptions = usageModeOptionsForBasis(equipmentOverrideUsageBasis);
  const unavailableMaterialIds = new Set(draft.materialLines.map((line: SerializedMaterialLine) => line.materialId));
  const unavailableEquipmentIds = new Set(draft.equipmentLines.map((line: SerializedEquipmentLine) => line.equipmentId));
  const filteredMaterialOptions = availableMaterials
    .filter((material: AvailableMaterial) => !unavailableMaterialIds.has(material.id))
    .filter((material: AvailableMaterial) =>
      material.name.toLowerCase().includes(materialSearchValue.trim().toLowerCase()),
    )
    .map((material: AvailableMaterial) => ({ label: material.name, value: material.id }));
  const filteredEquipmentOptions = availableEquipment
    .filter((equipment: AvailableEquipment) => !unavailableEquipmentIds.has(equipment.id))
    .filter((equipment: AvailableEquipment) =>
      equipment.name.toLowerCase().includes(equipmentSearchValue.trim().toLowerCase()),
    )
    .map((equipment: AvailableEquipment) => ({ label: equipment.name, value: equipment.id }));
  const filteredCopySourceOptions = copySourceVariants
    .filter((sourceVariant: CopySourceVariant) => {
      const query = copySourceSearchValue.trim().toLowerCase();
      if (!query) return true;
      return [
        sourceVariant.productTitle,
        sourceVariant.title,
        sourceVariant.sku,
        sourceVariant.templateName ?? "",
      ].some((value) => value.toLowerCase().includes(query));
    })
    .map((sourceVariant: CopySourceVariant) => ({
      value: sourceVariant.id,
      label: `${sourceVariant.productTitle} - ${sourceVariant.title}${
        sourceVariant.sku ? ` (${sourceVariant.sku})` : ""
      }`,
    }));
  const additionalProductionMaterialLines = draft.materialLines.filter(
    (line: SerializedMaterialLine) => line.materialType === "production",
  );
  const additionalShippingMaterialLines = draft.materialLines.filter(
    (line: SerializedMaterialLine) => line.materialType === "shipping",
  );
  const productionTemplateMaterialIds = new Set(
    draft.templateMaterialLines.map((line: VariantTemplateMaterialDraftLine) => line.materialId),
  );
  const shippingTemplateMaterialIds = new Set(
    shippingTemplateMaterialLines.map((line: TemplateCatalogMaterialLine) => line.materialId),
  );
  const productionTemplateEquipmentIds = new Set(
    draft.templateEquipmentLines.map((line: VariantTemplateEquipmentDraftLine) => line.equipmentId),
  );
  const materialOverrideTarget =
    draft.templateMaterialLines.find((line) => line.templateLineId === materialOverrideTargetId) ?? null;
  const isDirty = serializeVariantDraftState(draft) !== serializeVariantDraftState(baseDraft);
  const { confirmThenNavigate } = useUnsavedChangesGuard(isDirty);
  const shopDefaultLaborRate = shopDefaults.defaultLaborRate;
  const selectedProductionTemplate =
    templates.find((template: TemplateCatalogEntry) => template.id === draft.productionTemplateId) ?? null;
  const templateDefaultLaborMinutes = selectedProductionTemplate?.defaultLaborMinutes ?? "";
  const templateDefaultLaborRate = selectedProductionTemplate?.defaultLaborRate ?? "";
  const effectiveLaborRateLabel = draft.laborRate
    ? `${formatMoney(draft.laborRate)}/hr (Variant override)`
    : templateDefaultLaborRate
      ? `${formatMoney(templateDefaultLaborRate)}/hr (Template default)`
      : shopDefaultLaborRate
        ? `${formatMoney(shopDefaultLaborRate)}/hr (Shop default)`
        : "No labor rate set";
  const laborRateHelpText = shopDefaultLaborRate
    ? `Leave blank to use the template default rate, or the shop default of ${formatMoney(shopDefaultLaborRate)}/hr.`
    : "Leave blank to use the template default rate when one is configured.";
  const effectiveLaborMinutesLabel = draft.laborMinutes
    ? `${draft.laborMinutes} min (Variant override)`
    : templateDefaultLaborMinutes
      ? `${templateDefaultLaborMinutes} min (Template default)`
      : "No labor minutes set";
  const loadedVariantDraftState = serializeVariantDraftState(buildVariantDraft(config));
  const selectedCopySource =
    copySourceVariants.find((sourceVariant: CopySourceVariant) => sourceVariant.id === selectedCopySourceId) ?? null;
  const promotableMaterialLines = [
    ...draft.templateMaterialLines.map((line: VariantTemplateMaterialDraftLine) => ({
      key: `template:${line.templateLineId}`,
      name: line.materialName,
      source: "Template",
      description: describeMaterialLine({
        costingModel: line.costingModel,
        quantity: line.hasOverride ? line.overrideQuantity : line.quantity,
        yield: line.hasOverride ? line.overrideYield : line.yield,
        usesPerVariant: line.hasOverride ? line.overrideUsesPerVariant : line.usesPerVariant,
      }),
    })),
    ...draft.materialLines
      .filter((line: SerializedMaterialLine) => line.materialType === "production")
      .map((line: SerializedMaterialLine) => ({
        key: `variant:${line.id}`,
        name: line.materialName,
        source: "Variant",
        description: describeMaterialLine(line),
      })),
  ];
  const promotableEquipmentLines = [
    ...draft.templateEquipmentLines.map((line: VariantTemplateEquipmentDraftLine) => ({
      key: `template:${line.templateLineId}`,
      name: line.equipmentName,
      source: "Template",
      description: describeEquipmentLine({
        usageMode: line.hasOverride ? line.overrideUsageMode : line.usageMode,
        minutes: line.hasOverride ? line.overrideMinutes : line.minutes,
        uses: line.hasOverride ? line.overrideUses : line.uses,
        yieldDurationMinutes: line.hasOverride ? line.overrideYieldDurationMinutes : line.yieldDurationMinutes,
        yieldUses: line.hasOverride ? line.overrideYieldUses : line.yieldUses,
        yieldQuantity: line.hasOverride ? line.overrideYieldQuantity : line.yieldQuantity,
      }),
    })),
    ...draft.equipmentLines.map((line: SerializedEquipmentLine) => ({
      key: `variant:${line.id}`,
      name: line.equipmentName,
      source: "Variant",
      description: describeEquipmentLine(line),
    })),
  ];
  const promotableShippingMaterialLines = [
    ...shippingTemplateMaterialLines.map((line: TemplateCatalogMaterialLine) => ({
      key: `template:${line.templateLineId}`,
      name: line.materialName,
      source: "Shipping template",
      description: describeMaterialLine(line),
    })),
    ...additionalShippingMaterialLines.map((line: SerializedMaterialLine) => ({
      key: `variant:${line.id}`,
      name: line.materialName,
      source: "Variant",
      description: describeMaterialLine(line),
    })),
  ];

  useEffect(() => {
    if (!saveFetcher.data?.ok || !saveFetcher.data.savedAt || saveFetcher.data.savedAt === handledSaveRef.current) return;
    handledSaveRef.current = saveFetcher.data.savedAt;
    const committedDraft = cloneDraft(draft);
    setBaseDraft(committedDraft);
    setDraft(committedDraft);
    revalidator.revalidate();
  }, [draft, revalidator, saveFetcher.data]);

  useEffect(() => {
    if (!copyFetcher.data?.ok || !copyFetcher.data.savedAt || copyFetcher.data.savedAt === handledCopyRef.current) return;
    handledCopyRef.current = copyFetcher.data.savedAt;
    preCopyDraftStateRef.current = loadedVariantDraftState;
    setCopyDialogOpen(false);
    setPromoteDialogOpen(false);
    setPromoteShippingDialogOpen(false);
    setSelectedCopySourceId("");
    setCopySourceSearchValue("");
    revalidator.revalidate();
  }, [copyFetcher.data, loadedVariantDraftState, revalidator]);

  useEffect(() => {
    if (!promoteFetcher.data?.ok || !promoteFetcher.data.savedAt || promoteFetcher.data.savedAt === handledPromoteRef.current) return;
    handledPromoteRef.current = promoteFetcher.data.savedAt;
    preCopyDraftStateRef.current = loadedVariantDraftState;
    setPromoteDialogOpen(false);
    setPromoteShippingDialogOpen(false);
    revalidator.revalidate();
  }, [loadedVariantDraftState, promoteFetcher.data, revalidator]);

  useEffect(() => {
    setAvailableMaterials(loadedMaterials);
  }, [loadedMaterials]);

  useEffect(() => {
    setAvailableEquipment(loadedEquipment);
  }, [loadedEquipment]);

  useEffect(() => {
    if (!quickCreateFetcher.data?.ok) return;

    if (quickCreateFetcher.data.actionKind === "quick-create-material" && quickCreateFetcher.data.material) {
      const material = quickCreateFetcher.data.material;
      setAvailableMaterials((current) =>
        sortAvailableMaterials([
          ...current.filter((item) => item.id !== material.id),
          material,
        ]),
      );
      setSelectedMaterialId(material.id);
      setMaterialSearchValue(material.name);
      setMatQty("1");
      setMatYield(material.costingModel === "yield" ? "1" : "");
      setMatUses("");
      setQuickMaterialOpen(false);
    }

    if (quickCreateFetcher.data.actionKind === "quick-create-equipment" && quickCreateFetcher.data.equipment) {
      const equipment = quickCreateFetcher.data.equipment;
      setAvailableEquipment((current) =>
        sortAvailableEquipment([
          ...current.filter((item) => item.id !== equipment.id),
          equipment,
        ]),
      );
      setSelectedEquipmentId(equipment.id);
      setEquipmentSearchValue(equipment.name);
      setEqUsageMode(defaultUsageModeForBasis(equipment.usageBasis));
      setQuickEquipmentOpen(false);
    }
  }, [quickCreateFetcher.data]);

  useEffect(() => {
    if (!preCopyDraftStateRef.current || preCopyDraftStateRef.current === loadedVariantDraftState) return;
    preCopyDraftStateRef.current = null;
    const loadedDraft = buildVariantDraft(config);
    setBaseDraft(loadedDraft);
    setDraft(cloneDraft(loadedDraft));
  }, [config, loadedVariantDraftState]);

  function resetAdditionalMaterialModal() {
    setSelectedMaterialId("");
    setMaterialSearchValue("");
    setMatQty("1");
    setMatYield("1");
    setMatUses("");
  }

  function resetAdditionalEquipmentModal() {
    setSelectedEquipmentId("");
    setEquipmentSearchValue("");
    setEqUsageMode("direct");
    setEqMinutes("");
    setEqUses("");
    setEqYieldDurationMinutes("");
    setEqYieldUses("");
    setEqYieldQuantity("");
  }

  function openMaterialOverride(line: VariantTemplateMaterialDraftLine) {
    setMaterialOverrideTargetId(line.templateLineId);
    setOverrideMatQty(line.overrideQuantity ?? line.quantity);
    setOverrideMatYield(line.overrideYield ?? line.yield ?? "");
    setOverrideMatUses(line.overrideUsesPerVariant ?? line.usesPerVariant ?? "");
  }

  function closeMaterialOverride() {
    setMaterialOverrideTargetId(null);
    setOverrideMatQty("1");
    setOverrideMatYield("");
    setOverrideMatUses("");
  }

  function openEquipmentOverride(line: VariantTemplateEquipmentDraftLine) {
    const nextUsageMode = line.overrideUsageMode ?? line.usageMode ?? defaultUsageModeForBasis(line.usageBasis);
    setEquipmentOverrideTargetId(line.templateLineId);
    setOverrideEqUsageMode(usageModeAllowedForBasis(nextUsageMode, line.usageBasis) ? nextUsageMode : defaultUsageModeForBasis(line.usageBasis));
    setOverrideEqMinutes(line.overrideMinutes ?? line.minutes ?? "");
    setOverrideEqUses(line.overrideUses ?? line.uses ?? "");
    setOverrideEqYieldDurationMinutes(line.overrideYieldDurationMinutes ?? line.yieldDurationMinutes ?? "");
    setOverrideEqYieldUses(line.overrideYieldUses ?? line.yieldUses ?? "");
    setOverrideEqYieldQuantity(line.overrideYieldQuantity ?? line.yieldQuantity ?? "");
  }

  function closeEquipmentOverride() {
    setEquipmentOverrideTargetId(null);
    setOverrideEqUsageMode("direct");
    setOverrideEqMinutes("");
    setOverrideEqUses("");
    setOverrideEqYieldDurationMinutes("");
    setOverrideEqYieldUses("");
    setOverrideEqYieldQuantity("");
  }

  function discardChanges() {
    setDraft(cloneDraft(baseDraft));
    setAssignTemplateOpen(false);
    setAssignShippingTemplateOpen(false);
    setCopyDialogOpen(false);
    setPromoteDialogOpen(false);
    setPromoteShippingDialogOpen(false);
    setSelectedCopySourceId("");
    setCopySourceSearchValue("");
    setMaterialOverrideTargetId(null);
    setEquipmentOverrideTargetId(null);
    setAddMaterialOpen(false);
    setAddEquipmentOpen(false);
    setQuickMaterialOpen(false);
    setQuickEquipmentOpen(false);
    resetAdditionalMaterialModal();
    resetAdditionalEquipmentModal();
    closeMaterialOverride();
    closeEquipmentOverride();
  }

  function saveDraft() {
    const formData = new FormData();
    formData.append("intent", "save-variant-draft");
    formData.append("draft", JSON.stringify(normalizeVariantDraft(draft)));
    saveFetcher.submit(formData, { method: "post" });
  }

  function copySelectedVariantConfig() {
    if (!selectedCopySourceId || isDirty) return;
    const formData = new FormData();
    formData.append("intent", "copy-variant-config");
    formData.append("sourceVariantId", selectedCopySourceId);
    copyFetcher.submit(formData, { method: "post" });
  }

  function promoteVariantToTemplate() {
    if (isDirty) return;
    const formData = new FormData();
    formData.append("intent", "promote-template");
    formData.append("name", promoteForm.name);
    formData.append("description", promoteForm.description);
    if (promoteForm.includeMaterials) formData.append("includeMaterials", "on");
    if (promoteForm.includeEquipment) formData.append("includeEquipment", "on");
    if (promoteForm.includeLabor) formData.append("includeLabor", "on");
    if (promoteForm.freezeShopLaborRate) formData.append("freezeShopLaborRate", "on");
    if (promoteForm.includeDefaultShippingTemplate) formData.append("includeDefaultShippingTemplate", "on");
    if (promoteForm.assignBack) formData.append("assignBack", "on");
    for (const key of promoteForm.materialLineKeys) {
      formData.append("materialLineKey", key);
    }
    for (const key of promoteForm.equipmentLineKeys) {
      formData.append("equipmentLineKey", key);
    }
    promoteFetcher.submit(formData, { method: "post" });
  }

  function promoteVariantToShippingTemplate() {
    if (isDirty) return;
    const formData = new FormData();
    formData.append("intent", "promote-shipping-template");
    formData.append("name", promoteShippingForm.name);
    formData.append("description", promoteShippingForm.description);
    if (promoteShippingForm.assignBack) formData.append("assignBack", "on");
    if (promoteShippingForm.setAsProductionDefault) formData.append("setAsProductionDefault", "on");
    for (const key of promoteShippingForm.materialLineKeys) {
      formData.append("materialLineKey", key);
    }
    promoteFetcher.submit(formData, { method: "post" });
  }

  function togglePromoteMaterialLine(key: string) {
    setPromoteForm((current) => ({
      ...current,
      materialLineKeys: current.materialLineKeys.includes(key)
        ? current.materialLineKeys.filter((item) => item !== key)
        : [...current.materialLineKeys, key],
    }));
  }

  function togglePromoteEquipmentLine(key: string) {
    setPromoteForm((current) => ({
      ...current,
      equipmentLineKeys: current.equipmentLineKeys.includes(key)
        ? current.equipmentLineKeys.filter((item) => item !== key)
        : [...current.equipmentLineKeys, key],
    }));
  }

  function togglePromoteShippingMaterialLine(key: string) {
    setPromoteShippingForm((current) => ({
      ...current,
      materialLineKeys: current.materialLineKeys.includes(key)
        ? current.materialLineKeys.filter((item) => item !== key)
        : [...current.materialLineKeys, key],
    }));
  }

  function submitQuickMaterial() {
    const formData = new FormData();
    formData.append("intent", "quick-create-material");
    formData.append("name", quickMaterialForm.name);
    formData.append("type", quickMaterialForm.type);
    formData.append("costingModel", quickMaterialForm.costingModel);
    formData.append("purchasePrice", quickMaterialForm.purchasePrice);
    formData.append("purchaseQty", quickMaterialForm.purchaseQty);
    formData.append("totalUsesPerUnit", quickMaterialForm.totalUsesPerUnit);
    formData.append("purchaseLink", quickMaterialForm.purchaseLink);
    quickCreateFetcher.submit(formData, { method: "post" });
  }

  function submitQuickEquipment() {
    const formData = new FormData();
    formData.append("intent", "quick-create-equipment");
    formData.append("name", quickEquipmentForm.name);
    formData.append("hourlyRate", quickEquipmentForm.hourlyRate);
    formData.append("perUseCost", quickEquipmentForm.perUseCost);
    formData.append("equipmentCost", quickEquipmentForm.equipmentCost);
    formData.append("purchaseLink", quickEquipmentForm.purchaseLink);
    quickCreateFetcher.submit(formData, { method: "post" });
  }

  function applySelectedTemplate() {
    const nextTemplate = templates.find((template: TemplateCatalogEntry) => template.id === selectedTemplateId) ?? null;
    setDraft((current) => applyTemplateSelectionToVariantDraft(current, nextTemplate));
    setAssignTemplateOpen(false);
  }

  function applySelectedShippingTemplate() {
    const nextTemplate =
      shippingTemplates.find((template: TemplateCatalogEntry) => template.id === selectedShippingTemplateId) ?? null;
    setDraft((current) => applyShippingTemplateSelectionToVariantDraft(current, nextTemplate));
    setAssignShippingTemplateOpen(false);
  }

  function removeSelectedTemplate() {
    setDraft((current) => applyTemplateSelectionToVariantDraft(current, null));
  }

  function removeSelectedShippingTemplate() {
    setDraft((current) => applyShippingTemplateSelectionToVariantDraft(current, null));
  }

  function addAdditionalMaterialLine() {
    if (!selectedMaterial) return;

    const nextLine: SerializedMaterialLine = {
      id: createClientId("draft-material"),
      materialId: selectedMaterial.id,
      materialName: selectedMaterial.name,
      materialType: selectedMaterial.type,
      costingModel: selectedMaterial.costingModel,
      perUnitCost: selectedMaterial.perUnitCost,
      quantity: matQty,
      yield: selectedMaterial.costingModel === "yield" ? (matYield || null) : null,
      usesPerVariant: selectedMaterial.costingModel === "uses" ? (matUses || null) : null,
    };

    setDraft((current) => ({
      ...current,
      materialLines: sortSerializedMaterialLines([...current.materialLines, nextLine]),
    }));
    setAddMaterialOpen(false);
    resetAdditionalMaterialModal();
  }

  function removeAdditionalMaterialLine(lineId: string) {
    setDraft((current) => ({
      ...current,
      materialLines: current.materialLines.filter((line) => line.id !== lineId),
    }));
  }

  function addAdditionalEquipmentLine() {
    if (!selectedEquipment) return;

    const nextLine: SerializedEquipmentLine = {
      id: createClientId("draft-equipment"),
      equipmentId: selectedEquipment.id,
      equipmentName: selectedEquipment.name,
      usageBasis: selectedEquipment.usageBasis,
      hourlyRate: selectedEquipment.hourlyRate,
      perUseCost: selectedEquipment.perUseCost,
      usageMode: eqUsageMode,
      minutes: eqUsageMode === "direct" && selectedEquipment.usageBasis !== "unit" ? (eqMinutes || null) : null,
      uses: eqUsageMode === "direct" && selectedEquipment.usageBasis !== "time" ? (eqUses || null) : null,
      yieldDurationMinutes: eqUsageMode === "duration_yield" ? (eqYieldDurationMinutes || null) : null,
      yieldUses: eqUsageMode === "use_yield" ? (eqYieldUses || null) : null,
      yieldQuantity: eqUsageMode !== "direct" ? (eqYieldQuantity || null) : null,
    };

    setDraft((current) => ({
      ...current,
      equipmentLines: sortSerializedEquipmentLines([...current.equipmentLines, nextLine]),
    }));
    setAddEquipmentOpen(false);
    resetAdditionalEquipmentModal();
  }

  function removeAdditionalEquipmentLine(lineId: string) {
    setDraft((current) => ({
      ...current,
      equipmentLines: current.equipmentLines.filter((line) => line.id !== lineId),
    }));
  }

  function applyMaterialOverride() {
    if (!materialOverrideTarget) return;

    setDraft((current) => ({
      ...current,
      templateMaterialLines: current.templateMaterialLines.map((line) =>
        line.templateLineId === materialOverrideTarget.templateLineId
          ? {
              ...line,
              hasOverride: true,
              overrideQuantity: overrideMatQty,
              overrideYield: line.costingModel === "yield" ? (overrideMatYield || null) : null,
              overrideUsesPerVariant: line.costingModel === "uses" ? (overrideMatUses || null) : null,
            }
          : line,
      ),
    }));
    closeMaterialOverride();
  }

  function resetMaterialOverride(templateLineId: string) {
    setDraft((current) => ({
      ...current,
      templateMaterialLines: current.templateMaterialLines.map((line) =>
        line.templateLineId === templateLineId
          ? {
              ...line,
              hasOverride: false,
              overrideQuantity: null,
              overrideYield: null,
              overrideUsesPerVariant: null,
            }
          : line,
      ),
    }));
  }

  function applyEquipmentOverride() {
    if (!equipmentOverrideTarget) return;

    setDraft((current) => ({
      ...current,
      templateEquipmentLines: current.templateEquipmentLines.map((line) =>
        line.templateLineId === equipmentOverrideTarget.templateLineId
          ? {
              ...line,
              hasOverride: true,
              overrideUsageMode: overrideEqUsageMode,
              overrideMinutes: overrideEqUsageMode === "direct" && line.usageBasis !== "unit" ? (overrideEqMinutes || null) : null,
              overrideUses: overrideEqUsageMode === "direct" && line.usageBasis !== "time" ? (overrideEqUses || null) : null,
              overrideYieldDurationMinutes: overrideEqUsageMode === "duration_yield" ? (overrideEqYieldDurationMinutes || null) : null,
              overrideYieldUses: overrideEqUsageMode === "use_yield" ? (overrideEqYieldUses || null) : null,
              overrideYieldQuantity: overrideEqUsageMode !== "direct" ? (overrideEqYieldQuantity || null) : null,
            }
          : line,
      ),
    }));
    closeEquipmentOverride();
  }

  function resetEquipmentOverride(templateLineId: string) {
    setDraft((current) => ({
      ...current,
      templateEquipmentLines: current.templateEquipmentLines.map((line) =>
        line.templateLineId === templateLineId
          ? {
              ...line,
              hasOverride: false,
              overrideUsageMode: null,
              overrideMinutes: null,
              overrideUses: null,
              overrideYieldDurationMinutes: null,
              overrideYieldUses: null,
              overrideYieldQuantity: null,
            }
          : line,
      ),
    }));
  }

  function refreshPreview() {
    const fd = new FormData();
    fd.append("intent", "preview-cost");
    previewFetcher.submit(fd, { method: "post" });
  }

  return (
    <Page
      backAction={{ content: "Variants", onAction: () => void confirmThenNavigate("/app/variants") }}
      title={`${variant.productTitle} - ${variant.title}`}
    >
      <TitleBar title="Variant Cost Configuration" />
      <AppSaveBar open={isDirty} onSave={saveDraft} onDiscard={discardChanges} loading={isSaving} />

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {saveFetcher.data?.message ?? copyFetcher.data?.message ?? promoteFetcher.data?.message ?? previewFetcher.data?.message ?? ""}
      </div>

      <BlockStack gap="600">
        <Card>
          <BlockStack gap="200">
            <InlineStack gap="400">
              <Text as="p" variant="bodyMd" tone="subdued">SKU: {variant.sku || "-"}</Text>
              <Text as="p" variant="bodyMd" tone="subdued">Price: {formatMoney(variant.price)}</Text>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 650 }}>Actions & automation</summary>
            <div style={{ marginTop: "1rem" }}>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">Copy configuration</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Overwrite this variant with settings from another configured variant.
                    </Text>
                  </BlockStack>
                  <Button
                    onClick={() => {
                      setSelectedCopySourceId("");
                      setCopySourceSearchValue("");
                      setCopyDialogOpen(true);
                    }}
                    disabled={copySourceVariants.length === 0 || isDirty}
                  >
                    Copy from variant
                  </Button>
                </InlineStack>
                {isDirty ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Save or discard your staged changes before copying another variant configuration.
                  </Text>
                ) : null}
                {copySourceVariants.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No other configured variants are available to copy from.
                  </Text>
                ) : null}
                <Divider />
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">Create template from variant</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Save this setup as a production or shipping template.
                    </Text>
                  </BlockStack>
                  <InlineStack gap="200">
                    <Button
                      onClick={() => {
                        setPromoteForm((current) => ({
                          ...current,
                          name: `${variant.productTitle} - ${variant.title}`,
                          includeDefaultShippingTemplate: Boolean(effectiveTemplateSelection.shippingTemplateId),
                          materialLineKeys: promotableMaterialLines.map((line) => line.key),
                          equipmentLineKeys: promotableEquipmentLines.map((line) => line.key),
                        }));
                        setPromoteDialogOpen(true);
                      }}
                      disabled={!config || isDirty}
                    >
                      Production template
                    </Button>
                    <Button
                      onClick={() => {
                        setPromoteShippingForm((current) => ({
                          ...current,
                          name: `${variant.productTitle} - ${variant.title} Shipping`,
                          setAsProductionDefault: Boolean(effectiveTemplateSelection.productionTemplateId),
                          materialLineKeys: promotableShippingMaterialLines.map((line) => line.key),
                        }));
                        setPromoteShippingDialogOpen(true);
                      }}
                      disabled={!config || isDirty || promotableShippingMaterialLines.length === 0}
                    >
                      Shipping template
                    </Button>
                  </InlineStack>
                </InlineStack>
                {!config ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Save a variant configuration before creating a template from it.
                  </Text>
                ) : null}
                {isDirty ? (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Save or discard your staged changes before promoting this variant.
                  </Text>
                ) : null}
                {promoteFetcher.data ? (
                  <Banner tone={promoteFetcher.data.ok ? "success" : "critical"}>
                    <Text as="p" variant="bodyMd">{promoteFetcher.data.message}</Text>
                  </Banner>
                ) : null}
              </BlockStack>
            </div>
          </details>
        </Card>

        {variant.providerMappings.length > 0 ? (
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">Provider mappings</Text>
                {variant.providerMappings.length > 0 ? (
                  <Badge tone="info">
                    {variant.providerMappings.length} active mapping{variant.providerMappings.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                Provider mappings are optional. Automatic Printify matching only happens when a Shopify variant and a
                provider variant share a unique SKU.
              </Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="400">
              {variant.providerMappings.map((mapping: SerializedProviderMapping) => (
                <BlockStack key={mapping.id} gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{formatProviderName(mapping.provider)}</Text>
                      <Badge tone={mapping.status === "mapped" ? "success" : "warning"}>
                        {mapping.status === "mapped" ? "Mapped" : mapping.status}
                      </Badge>
                      <Badge tone={mapping.connectionStatus === "validated" ? "info" : "warning"}>
                        {mapping.connectionStatus === "validated" ? "Connection healthy" : "Connection needs review"}
                      </Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {mapping.lastCostSyncedAt
                        ? `Costs synced ${new Date(mapping.lastCostSyncedAt).toLocaleString()}`
                        : "No cached provider costs yet"}
                    </Text>
                  </InlineStack>

                  <BlockStack gap="100">
                    {mapping.providerProductTitle ? (
                      <Text as="p" variant="bodyMd">Provider product: {mapping.providerProductTitle}</Text>
                    ) : null}
                    {mapping.providerVariantTitle ? (
                      <Text as="p" variant="bodyMd">Provider variant: {mapping.providerVariantTitle}</Text>
                    ) : null}
                    {mapping.providerSku ? (
                      <Text as="p" variant="bodyMd">Provider SKU: {mapping.providerSku}</Text>
                    ) : null}
                    {mapping.matchMethod ? (
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Match method: {mapping.matchMethod === "sku" ? "Unique SKU match" : mapping.matchMethod}
                      </Text>
                    ) : null}
                  </BlockStack>

                  {mapping.latestCostLines.length > 0 ? (
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">Latest cached POD costs</Text>
                      {mapping.latestCostLines.map((line) => (
                        <InlineStack key={`${mapping.id}-${line.costLineType}-${line.description ?? "line"}`} align="space-between">
                          <Text as="p" variant="bodyMd">
                            {line.description ?? line.costLineType}
                          </Text>
                          <Text as="p" variant="bodyMd">{formatMoney(line.amount)}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  ) : (
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No cached POD costs have been stored for this mapping yet.
                    </Text>
                  )}
                </BlockStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
        ) : null}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Templates</Text>
            <Divider />
            <InlineStack gap="400" blockAlign="start">
              <div style={{ flex: 1 }}>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">Production</Text>
                    <InlineStack gap="200">
                      {assignedProductionTemplate ? (
                        <Button variant="plain" tone="critical" onClick={removeSelectedTemplate}>
                          Remove
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => {
                          setSelectedTemplateId(draft.productionTemplateId ?? productionTemplates[0]?.id ?? "");
                          setAssignTemplateOpen(true);
                        }}
                        disabled={productionTemplates.length === 0}
                      >
                        {assignedProductionTemplate ? "Change" : "Assign"}
                      </Button>
                    </InlineStack>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone={assignedProductionTemplate ? undefined : "subdued"}>
                    {assignedProductionTemplate?.name ?? "No production template assigned"}
                  </Text>
                </BlockStack>
              </div>
              <div style={{ flex: 1 }}>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingSm">Shipping</Text>
                      <Badge tone={effectiveTemplateSelection.shippingSource === "explicit" ? "attention" : "info"}>
                        {effectiveTemplateSelection.shippingSource === "explicit"
                          ? "Override"
                          : effectiveTemplateSelection.shippingSource === "production-default"
                            ? "Inherited"
                            : "Unassigned"}
                      </Badge>
                    </InlineStack>
                    <InlineStack gap="200">
                      {draft.shippingTemplateId ? (
                        <Button variant="plain" tone="critical" onClick={removeSelectedShippingTemplate}>
                          Remove
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => {
                          setSelectedShippingTemplateId(draft.shippingTemplateId ?? effectiveShippingTemplate?.id ?? shippingTemplates[0]?.id ?? "");
                          setAssignShippingTemplateOpen(true);
                        }}
                        disabled={shippingTemplates.length === 0}
                      >
                        {draft.shippingTemplateId ? "Change" : "Set override"}
                      </Button>
                    </InlineStack>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone={effectiveShippingTemplate ? undefined : "subdued"}>
                    {effectiveShippingTemplate?.name ?? "No effective shipping template"}
                  </Text>
                </BlockStack>
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Materials</Text>
                  {draft.templateMaterialLines.length + shippingTemplateMaterialLines.length + draft.materialLines.length > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {draft.templateMaterialLines.length + shippingTemplateMaterialLines.length + draft.materialLines.length}
                    </Text>
                  )}
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Template, shipping template, and variant-specific material costs in calculation order.
                </Text>
              </BlockStack>
              <Button onClick={() => setAddMaterialOpen(true)} disabled={availableMaterials.length === draft.materialLines.length}>
                Add material
              </Button>
            </InlineStack>
            <Divider />
            {draft.templateMaterialLines.length + shippingTemplateMaterialLines.length + draft.materialLines.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">No materials configured yet.</Text>
            ) : (
              <BlockStack gap="400">
                {draft.templateMaterialLines.length > 0 ? (
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Production template</Text>
                    {draft.templateMaterialLines.map((line) => (
                      <InlineStack key={line.templateLineId} align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{line.materialName}</Text>
                            <Badge tone="info">Template</Badge>
                            <Badge tone={line.materialType === "shipping" ? "info" : "success"}>
                              {line.materialType === "shipping" ? "Shipping" : "Production"}
                            </Badge>
                            {line.hasOverride ? <Badge tone="attention">Override active</Badge> : null}
                          </InlineStack>
                          <Text as="p" variant="bodyMd" tone="subdued">
                            Default: {describeMaterialLine(line)}
                          </Text>
                          {line.hasOverride ? (
                            <Text as="p" variant="bodyMd" tone="subdued">
                              Override: {describeMaterialLine({
                                costingModel: line.costingModel,
                                quantity: line.overrideQuantity,
                                yield: line.overrideYield,
                                usesPerVariant: line.overrideUsesPerVariant,
                              })}
                            </Text>
                          ) : null}
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button variant="plain" onClick={() => openMaterialOverride(line)}>
                            {line.hasOverride ? "Edit override" : "Override"}
                          </Button>
                          {line.hasOverride ? (
                            <Button variant="plain" onClick={() => resetMaterialOverride(line.templateLineId)}>
                              Reset
                            </Button>
                          ) : null}
                        </InlineStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                ) : assignedProductionTemplate ? (
                  <Text as="p" variant="bodyMd" tone="subdued">The assigned production template has no material lines.</Text>
                ) : null}

                {shippingTemplateMaterialLines.length > 0 ? (
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Shipping template</Text>
                    {shippingTemplateMaterialLines.map((line: TemplateCatalogMaterialLine) => (
                      <BlockStack key={line.templateLineId} gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{line.materialName}</Text>
                          <Badge tone="info">Shipping template</Badge>
                          <Badge tone="info">Shipping</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodyMd" tone="subdued">{describeMaterialLine(line)}</Text>
                      </BlockStack>
                    ))}
                  </BlockStack>
                ) : effectiveShippingTemplate ? (
                  <Text as="p" variant="bodyMd" tone="subdued">The effective shipping template has no material lines.</Text>
                ) : null}

                {[
                  {
                    heading: "Variant-specific production",
                    lines: additionalProductionMaterialLines,
                  },
                  {
                    heading: "Variant-specific shipping",
                    lines: additionalShippingMaterialLines,
                  },
                ].filter((section) => section.lines.length > 0).map((section) => (
                  <BlockStack key={section.heading} gap="300">
                    <Text as="h3" variant="headingSm">{section.heading}</Text>
                    {section.lines.map((line: SerializedMaterialLine) => {
                      const alsoInTemplate =
                        productionTemplateMaterialIds.has(line.materialId) || shippingTemplateMaterialIds.has(line.materialId);
                      return (
                        <InlineStack key={line.id} align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{line.materialName}</Text>
                              <Badge tone="attention">Variant-specific</Badge>
                              <Badge tone={line.materialType === "shipping" ? "info" : "success"}>
                                {line.materialType === "shipping" ? "Shipping" : "Production"}
                              </Badge>
                              {alsoInTemplate ? <Badge tone="warning">Also in template</Badge> : null}
                            </InlineStack>
                            <Text as="p" variant="bodyMd" tone="subdued">{describeMaterialLine(line)}</Text>
                          </BlockStack>
                          <Button variant="plain" tone="critical" onClick={() => removeAdditionalMaterialLine(line.id)}>
                            Remove
                          </Button>
                        </InlineStack>
                      );
                    })}
                  </BlockStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Equipment</Text>
                  {draft.templateEquipmentLines.length + draft.equipmentLines.length > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {draft.templateEquipmentLines.length + draft.equipmentLines.length}
                    </Text>
                  )}
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Template and variant-specific equipment usage in calculation order.
                </Text>
              </BlockStack>
              <Button onClick={() => setAddEquipmentOpen(true)} disabled={availableEquipment.length === draft.equipmentLines.length}>
                Add equipment
              </Button>
            </InlineStack>
            <Divider />
            {draft.templateEquipmentLines.length + draft.equipmentLines.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">No equipment configured yet.</Text>
            ) : (
              <BlockStack gap="400">
                {draft.templateEquipmentLines.length > 0 ? (
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Production template</Text>
                    {draft.templateEquipmentLines.map((line) => (
                      <InlineStack key={line.templateLineId} align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{line.equipmentName}</Text>
                            <Badge tone="info">Template</Badge>
                            {line.hasOverride ? <Badge tone="attention">Override active</Badge> : null}
                          </InlineStack>
                          <Text as="p" variant="bodyMd" tone="subdued">
                            Default: {describeEquipmentLine(line)}
                          </Text>
                          {line.hasOverride ? (
                            <Text as="p" variant="bodyMd" tone="subdued">
                              Override: {describeEquipmentLine({
                                usageMode: line.overrideUsageMode,
                                minutes: line.overrideMinutes,
                                uses: line.overrideUses,
                                yieldDurationMinutes: line.overrideYieldDurationMinutes,
                                yieldUses: line.overrideYieldUses,
                                yieldQuantity: line.overrideYieldQuantity,
                              })}
                            </Text>
                          ) : null}
                        </BlockStack>
                        <InlineStack gap="200">
                          <Button variant="plain" onClick={() => openEquipmentOverride(line)}>
                            {line.hasOverride ? "Edit override" : "Override"}
                          </Button>
                          {line.hasOverride ? (
                            <Button variant="plain" onClick={() => resetEquipmentOverride(line.templateLineId)}>
                              Reset
                            </Button>
                          ) : null}
                        </InlineStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                ) : assignedProductionTemplate ? (
                  <Text as="p" variant="bodyMd" tone="subdued">The assigned production template has no equipment lines.</Text>
                ) : null}

                {draft.equipmentLines.length > 0 ? (
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Variant-specific</Text>
                    {draft.equipmentLines.map((line: SerializedEquipmentLine) => (
                      <InlineStack key={line.id} align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{line.equipmentName}</Text>
                            <Badge tone="attention">Variant-specific</Badge>
                            {productionTemplateEquipmentIds.has(line.equipmentId) ? (
                              <Badge tone="warning">Also in template</Badge>
                            ) : null}
                          </InlineStack>
                          <Text as="p" variant="bodyMd" tone="subdued">{describeEquipmentLine(line)}</Text>
                        </BlockStack>
                        <Button variant="plain" tone="critical" onClick={() => removeAdditionalEquipmentLine(line.id)}>
                          Remove
                        </Button>
                      </InlineStack>
                    ))}
                  </BlockStack>
                ) : null}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Labor</Text>
            <Divider />
            <BlockStack gap="400">
              <TextField
                label="Minutes per variant"
                type="number"
                min={0}
                step={0.5}
                value={draft.laborMinutes}
                onChange={(value) => setDraft((current) => ({ ...current, laborMinutes: value }))}
                autoComplete="off"
                helpText="Leave blank to use the template default minutes when one is configured."
              />
              <Text as="p" variant="bodyMd" tone="subdued">
                Current effective labor: {effectiveLaborMinutesLabel}; {effectiveLaborRateLabel}
              </Text>
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 650 }}>Overrides</summary>
                <div style={{ marginTop: "1rem" }}>
                  <BlockStack gap="400">
                    <TextField
                      label={`Hourly rate (${getCurrencySymbol()})`}
                      placeholder={
                        shopDefaultLaborRate
                          ? `${formatMoney(shopDefaultLaborRate)}/hr (Shop default)`
                          : "Set a variant override or configure a shop default"
                      }
                      type="number"
                      min={0}
                      step={0.01}
                      value={draft.laborRate}
                      onChange={(value) => setDraft((current) => ({ ...current, laborRate: value }))}
                      onBlur={() => setDraft((current) => ({ ...current, laborRate: normalizeFixedDecimalInput(current.laborRate) }))}
                      autoComplete="off"
                      helpText={laborRateHelpText}
                    />
                    <TextField
                      label="Mistake buffer (%)"
                      placeholder={`${formatPct((Number(shopDefaults.mistakeBuffer ?? "0")) / 100)} (Shop Default)`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={draft.mistakeBuffer}
                      onChange={(value) => setDraft((current) => ({ ...current, mistakeBuffer: value }))}
                      autoComplete="off"
                      helpText="Leave blank to use the global default from Settings"
                    />
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Effective mistake buffer: {draft.mistakeBuffer
                        ? formatPct(Number(draft.mistakeBuffer) / 100)
                        : `${formatPct((Number(shopDefaults.mistakeBuffer ?? "0")) / 100)} (Shop Default)`}
                    </Text>
                  </BlockStack>
                </div>
              </details>
            </BlockStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Cost Preview</Text>
              <Button onClick={refreshPreview} loading={previewFetcher.state !== "idle"} disabled={isDirty}>
                Refresh
              </Button>
            </InlineStack>
            <Divider />
            {isDirty ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                Save or discard your staged changes before refreshing the cost preview.
              </Text>
            ) : !preview ? (
              <Text as="p" variant="bodyMd" tone="subdued">Click Refresh to calculate the current cost breakdown.</Text>
            ) : (
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">Estimated sale price</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{formatMoney(preview.reconciliation.estimatedTotal)}</Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Assembly / labor</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.laborCost)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Materials (production)</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.reconciliation.materials)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Packaging (shipping materials)</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.reconciliation.packaging)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Equipment / maintenance</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.reconciliation.equipment)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="p" variant="bodyMd">POD fulfillment</Text>
                    {preview.podCostEstimated ? <Badge tone="info">Cached estimate</Badge> : null}
                    {preview.podCostMissing ? <Badge tone="warning">Missing cost data</Badge> : null}
                  </InlineStack>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.podCostTotal)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Mistake buffer</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.mistakeBufferAmount)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Artist payout</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.reconciliation.artistPayout)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Approx. Shopify/payment fees</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.reconciliation.shopifyFees)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="p" variant="bodyMd">Approx. tax buffer withheld</Text>
                    {preview.taxReserve.suppressed ? <Badge tone="info">Suppressed</Badge> : null}
                  </InlineStack>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.taxReserve.estimatedAmount)}</Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">Approx. assigned donations</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{formatMoney(preview.reconciliation.allocatedDonations)}</Text>
                </InlineStack>
                {preview.causes.length > 0 ? (
                  <BlockStack gap="200">
                    {preview.causes.map((cause) => (
                      <InlineStack key={cause.causeId} align="space-between">
                        <Text as="p" variant="bodySm">{cause.name} ({cause.donationPercentage}%)</Text>
                        <Text as="p" variant="bodySm">{formatMoney(cause.estimatedDonationAmount)}</Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">No active cause assignments are configured for this product.</Text>
                )}
                <details>
                  <summary>Advanced reconciliation</summary>
                  <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm">Retained / unassigned</Text>
                      <Text as="p" variant="bodySm">{formatMoney(preview.reconciliation.retainedByShop)}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm">Rounding remainder</Text>
                      <Text as="p" variant="bodySm">{formatMoney(preview.reconciliation.remainder)}</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Processing fee estimate uses {preview.shopifyFees.processingRate}% plus {formatMoney(preview.shopifyFees.processingFlatFee)}.
                    </Text>
                  </div>
                </details>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={copyDialogOpen}
        onClose={() => setCopyDialogOpen(false)}
        title="Copy variant configuration"
        primaryAction={{
          content: "Copy configuration",
          loading: isCopying,
          disabled: !selectedCopySourceId || isDirty,
          onAction: copySelectedVariantConfig,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setCopyDialogOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd" tone="subdued">
              This will overwrite the production template, shipping override, package settings, labor, mistake buffer,
              material lines, and equipment lines on this variant.
            </Text>
            <Autocomplete
              options={filteredCopySourceOptions}
              selected={selectedCopySourceId ? [selectedCopySourceId] : []}
              onSelect={(selected) => {
                const nextId = selected[0] ?? "";
                const nextSource = copySourceVariants.find((sourceVariant: CopySourceVariant) => sourceVariant.id === nextId);
                setSelectedCopySourceId(nextId);
                setCopySourceSearchValue(
                  nextSource
                    ? `${nextSource.productTitle} - ${nextSource.title}${nextSource.sku ? ` (${nextSource.sku})` : ""}`
                    : "",
                );
              }}
              textField={
                <Autocomplete.TextField
                  label="Source variant"
                  value={copySourceSearchValue}
                  onChange={(value) => {
                    setCopySourceSearchValue(value);
                    if (selectedCopySourceId) setSelectedCopySourceId("");
                  }}
                  autoComplete="off"
                  placeholder="Search configured variants"
                />
              }
              emptyState={
                <Text as="p" variant="bodyMd" tone="subdued">
                  No matching configured variants found.
                </Text>
              }
            />
            {selectedCopySource ? (
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {selectedCopySource.productTitle} - {selectedCopySource.title}
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {selectedCopySource.templateName
                    ? `Production template: ${selectedCopySource.templateName}`
                    : "No production template assigned"}
                  {" · "}
                  {selectedCopySource.lineItemCount} saved line item{selectedCopySource.lineItemCount === 1 ? "" : "s"}
                </Text>
              </BlockStack>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={assignTemplateOpen}
        onClose={() => setAssignTemplateOpen(false)}
        title="Assign production template"
        primaryAction={{
          content: assignedProductionTemplate ? "Apply" : "Assign",
          loading: isSaving,
          onAction: applySelectedTemplate,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAssignTemplateOpen(false) }]}
      >
        <Modal.Section>
          <Select
            label="Production template"
            options={productionTemplates.map((template: { id: string; name: string }) => ({ label: template.name, value: template.id }))}
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
          />
        </Modal.Section>
      </Modal>

      <Modal
        open={assignShippingTemplateOpen}
        onClose={() => setAssignShippingTemplateOpen(false)}
        title="Assign shipping template override"
        primaryAction={{
          content: draft.shippingTemplateId ? "Apply override" : "Set override",
          loading: isSaving,
          onAction: applySelectedShippingTemplate,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAssignShippingTemplateOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd" tone="subdued">
              Leave the Shipping template unassigned to inherit the default from the Production template when one exists.
            </Text>
            <Select
              label="Shipping template"
              options={shippingTemplates.map((template: { id: string; name: string }) => ({ label: template.name, value: template.id }))}
              value={selectedShippingTemplateId}
              onChange={setSelectedShippingTemplateId}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={promoteDialogOpen}
        onClose={() => setPromoteDialogOpen(false)}
        title="Create template from variant"
        primaryAction={{
          content: "Create template",
          loading: promoteFetcher.state !== "idle",
          disabled:
            isDirty ||
            !promoteForm.name.trim() ||
            (!promoteForm.includeMaterials && !promoteForm.includeEquipment && !promoteForm.includeLabor) ||
            (promoteForm.includeMaterials && promoteForm.materialLineKeys.length === 0) ||
            (promoteForm.includeEquipment && promoteForm.equipmentLineKeys.length === 0),
          onAction: promoteVariantToTemplate,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setPromoteDialogOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {promoteFetcher.data && !promoteFetcher.data.ok ? (
              <Banner tone="critical">
                <Text as="p" variant="bodyMd">{promoteFetcher.data.message}</Text>
              </Banner>
            ) : null}
            <TextField
              label="Template name"
              value={promoteForm.name}
              onChange={(value) => setPromoteForm((current) => ({ ...current, name: value }))}
              autoComplete="off"
            />
            <TextField
              label="Description"
              value={promoteForm.description}
              onChange={(value) => setPromoteForm((current) => ({ ...current, description: value }))}
              autoComplete="off"
            />
            <BlockStack gap="200">
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={promoteForm.includeMaterials}
                  onChange={() => setPromoteForm((current) => ({ ...current, includeMaterials: !current.includeMaterials }))}
                />
                <span>Include effective production materials</span>
              </label>
              {promoteForm.includeMaterials ? (
                <BlockStack gap="150">
                  {promotableMaterialLines.length === 0 ? (
                    <Text as="p" variant="bodyMd" tone="subdued">No production material lines are available to include.</Text>
                  ) : (
                    promotableMaterialLines.map((line) => (
                      <label key={line.key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", paddingLeft: "1.5rem" }}>
                        <input
                          type="checkbox"
                          checked={promoteForm.materialLineKeys.includes(line.key)}
                          onChange={() => togglePromoteMaterialLine(line.key)}
                        />
                        <span>
                          <span>{line.name}</span>
                          <span style={{ color: "#616161" }}> ({line.source}: {line.description})</span>
                        </span>
                      </label>
                    ))
                  )}
                </BlockStack>
              ) : null}
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={promoteForm.includeEquipment}
                  onChange={() => setPromoteForm((current) => ({ ...current, includeEquipment: !current.includeEquipment }))}
                />
                <span>Include effective equipment</span>
              </label>
              {promoteForm.includeEquipment ? (
                <BlockStack gap="150">
                  {promotableEquipmentLines.length === 0 ? (
                    <Text as="p" variant="bodyMd" tone="subdued">No equipment lines are available to include.</Text>
                  ) : (
                    promotableEquipmentLines.map((line) => (
                      <label key={line.key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", paddingLeft: "1.5rem" }}>
                        <input
                          type="checkbox"
                          checked={promoteForm.equipmentLineKeys.includes(line.key)}
                          onChange={() => togglePromoteEquipmentLine(line.key)}
                        />
                        <span>
                          <span>{line.name}</span>
                          <span style={{ color: "#616161" }}> ({line.source}: {line.description || "No usage set"})</span>
                        </span>
                      </label>
                    ))
                  )}
                </BlockStack>
              ) : null}
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={promoteForm.includeLabor}
                  onChange={() => setPromoteForm((current) => ({ ...current, includeLabor: !current.includeLabor }))}
                />
                <span>Include labor defaults</span>
              </label>
              {promoteForm.includeLabor && !draft.laborRate && !selectedProductionTemplate?.defaultLaborRate && shopDefaultLaborRate ? (
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={promoteForm.freezeShopLaborRate}
                    onChange={() => setPromoteForm((current) => ({ ...current, freezeShopLaborRate: !current.freezeShopLaborRate }))}
                  />
                  <span>Copy current shop default labor rate into the template</span>
                </label>
              ) : null}
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={promoteForm.includeDefaultShippingTemplate && Boolean(effectiveTemplateSelection.shippingTemplateId)}
                  disabled={!effectiveTemplateSelection.shippingTemplateId}
                  onChange={() =>
                    setPromoteForm((current) => ({
                      ...current,
                      includeDefaultShippingTemplate: !current.includeDefaultShippingTemplate,
                    }))
                  }
                />
                <span>Set this production template&apos;s default shipping template to the current shipping template</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={promoteForm.assignBack}
                  onChange={() => setPromoteForm((current) => ({ ...current, assignBack: !current.assignBack }))}
                />
                <span>Assign the new template back to this variant</span>
              </label>
            </BlockStack>
            {promoteForm.assignBack ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                Exact promoted variant-only rows and stale previous-template overrides will be removed; any remaining
                variant-specific rows will be reported for review.
              </Text>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={promoteShippingDialogOpen}
        onClose={() => setPromoteShippingDialogOpen(false)}
        title="Create shipping template from variant"
        primaryAction={{
          content: "Create shipping template",
          loading: promoteFetcher.state !== "idle",
          disabled: isDirty || !promoteShippingForm.name.trim() || promoteShippingForm.materialLineKeys.length === 0,
          onAction: promoteVariantToShippingTemplate,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setPromoteShippingDialogOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {promoteFetcher.data && !promoteFetcher.data.ok ? (
              <Banner tone="critical">
                <Text as="p" variant="bodyMd">{promoteFetcher.data.message}</Text>
              </Banner>
            ) : null}
            <TextField
              label="Template name"
              value={promoteShippingForm.name}
              onChange={(value) => setPromoteShippingForm((current) => ({ ...current, name: value }))}
              autoComplete="off"
            />
            <TextField
              label="Description"
              value={promoteShippingForm.description}
              onChange={(value) => setPromoteShippingForm((current) => ({ ...current, description: value }))}
              autoComplete="off"
            />
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">
                Select the effective shipping material lines to include in the new shipping template.
              </Text>
              {promotableShippingMaterialLines.map((line) => (
                <label key={line.key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={promoteShippingForm.materialLineKeys.includes(line.key)}
                    onChange={() => togglePromoteShippingMaterialLine(line.key)}
                  />
                  <span>
                    <span>{line.name}</span>
                    <span style={{ color: "#616161" }}> ({line.source}: {line.description})</span>
                  </span>
                </label>
              ))}
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={promoteShippingForm.assignBack}
                  onChange={() => setPromoteShippingForm((current) => ({ ...current, assignBack: !current.assignBack }))}
                />
                <span>Assign the new shipping template back to this variant</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={promoteShippingForm.setAsProductionDefault && Boolean(effectiveTemplateSelection.productionTemplateId)}
                  disabled={!effectiveTemplateSelection.productionTemplateId}
                  onChange={() =>
                    setPromoteShippingForm((current) => ({
                      ...current,
                      setAsProductionDefault: !current.setAsProductionDefault,
                    }))
                  }
                />
                <span>Set as the current production template&apos;s default shipping template</span>
              </label>
            </BlockStack>
            {promoteShippingForm.assignBack ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                Selected variant-only shipping rows will be removed after promotion; excluded inherited rows will be
                preserved as variant-specific rows.
              </Text>
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(materialOverrideTarget)}
        onClose={closeMaterialOverride}
        title={materialOverrideTarget ? `Override ${materialOverrideTarget.materialName}` : "Override material"}
        primaryAction={{
          content: materialOverrideTarget?.hasOverride ? "Save override" : "Apply override",
          loading: isSaving,
          onAction: applyMaterialOverride,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeMaterialOverride }]}
      >
        <Modal.Section>
          {materialOverrideTarget && (
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd" tone="subdued">
                Default: {describeMaterialLine(materialOverrideTarget)}
              </Text>
              {materialOverrideTarget.costingModel === "counted" && (
                <TextField
                  label="Quantity used per item"
                  type="number"
                  min={0}
                  step={1}
                  value={overrideMatQty}
                  onChange={setOverrideMatQty}
                  autoComplete="off"
                />
              )}
              {materialOverrideTarget.costingModel === "yield" && (
                <>
                  <TextField
                    label="Purchased units used"
                    type="number"
                    min={0}
                    step={1}
                    value={overrideMatQty}
                    onChange={setOverrideMatQty}
                    autoComplete="off"
                  />
                  <TextField
                    label="Items made from one purchased unit"
                    type="number"
                    min={0}
                    step={1}
                    value={overrideMatYield}
                    onChange={setOverrideMatYield}
                    autoComplete="off"
                  />
                </>
              )}
              {materialOverrideTarget.costingModel === "uses" && (
                <TextField
                  label="Portions used per item"
                  type="number"
                  min={0}
                  step={1}
                  value={overrideMatUses}
                  onChange={setOverrideMatUses}
                  autoComplete="off"
                />
              )}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>

      <Modal
        open={addMaterialOpen}
        onClose={() => {
          setAddMaterialOpen(false);
          resetAdditionalMaterialModal();
        }}
        title="Add material line"
        primaryAction={{
          content: "Add",
          loading: isSaving,
          disabled: !selectedMaterialId,
          onAction: addAdditionalMaterialLine,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => {
            setAddMaterialOpen(false);
            resetAdditionalMaterialModal();
          },
        }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Autocomplete
              options={filteredMaterialOptions}
              selected={selectedMaterialId ? [selectedMaterialId] : []}
              onSelect={(selected) => {
                const nextId = selected[0] ?? "";
                const nextMaterial = availableMaterials.find((material: AvailableMaterial) => material.id === nextId);
                setSelectedMaterialId(nextId);
                setMaterialSearchValue(nextMaterial?.name ?? "");
                setMatYield(nextMaterial?.costingModel === "yield" ? "1" : "");
                setMatUses("");
              }}
              textField={
                <Autocomplete.TextField
                  label="Material"
                  value={materialSearchValue}
                  onChange={setMaterialSearchValue}
                  autoComplete="off"
                  placeholder="Search materials"
                />
              }
              emptyState={
                <Text as="p" variant="bodyMd" tone="subdued">
                  No matching materials found.
                </Text>
              }
            />
            <Button
              onClick={() => {
                setQuickMaterialForm((current) => ({
                  ...current,
                  name: materialSearchValue,
                }));
                setQuickMaterialOpen(true);
              }}
            >
              Create material
            </Button>
            {selectedMaterial?.costingModel === "counted" && (
              <TextField
                label="Quantity used per item"
                type="number"
                min={0}
                step={1}
                value={matQty}
                onChange={setMatQty}
                autoComplete="off"
                helpText="Number of discrete pieces from the purchased batch needed for this variant."
              />
            )}
            {selectedMaterial?.costingModel === "yield" && (
              <>
                <TextField
                  label="Purchased units used"
                  type="number"
                  min={0}
                  step={1}
                  value={matQty}
                  onChange={setMatQty}
                  autoComplete="off"
                  helpText="Usually 1, unless this variant needs multiple purchased units."
                />
                <TextField
                  label="Items made from one purchased unit"
                  type="number"
                  min={0}
                  step={1}
                  value={matYield}
                  onChange={setMatYield}
                  autoComplete="off"
                  helpText="How many finished items this material unit can make for this specific variant."
                />
              </>
            )}
            {selectedMaterial?.costingModel === "uses" && (
              <TextField
                label="Portions used per item"
                type="number"
                min={0}
                step={1}
                value={matUses}
                onChange={setMatUses}
                autoComplete="off"
                helpText="Estimated number of portions, such as glue dollops, required for this variant."
              />
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(equipmentOverrideTarget)}
        onClose={closeEquipmentOverride}
        title={equipmentOverrideTarget ? `Override ${equipmentOverrideTarget.equipmentName}` : "Override equipment"}
        primaryAction={{
          content: equipmentOverrideTarget?.hasOverride ? "Save override" : "Apply override",
          loading: isSaving,
          onAction: applyEquipmentOverride,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeEquipmentOverride }]}
      >
        <Modal.Section>
          {equipmentOverrideTarget && (
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd" tone="subdued">
                Default: {describeEquipmentLine(equipmentOverrideTarget)}
              </Text>
              <Select
                label="How usage is measured"
                value={overrideEqUsageMode}
                onChange={setOverrideEqUsageMode}
                options={equipmentOverrideUsageModeOptions}
              />
              {overrideEqUsageMode === "direct" && (
                <InlineStack gap="400" wrap={false}>
                  {equipmentOverrideUsageBasis !== "unit" && (
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Minutes"
                        type="number"
                        min={0}
                        step={0.5}
                        value={overrideEqMinutes}
                        onChange={setOverrideEqMinutes}
                        autoComplete="off"
                      />
                    </div>
                  )}
                  {equipmentOverrideUsageBasis !== "time" && (
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Uses"
                        type="number"
                        min={0}
                        step={1}
                        value={overrideEqUses}
                        onChange={setOverrideEqUses}
                        autoComplete="off"
                      />
                    </div>
                  )}
                </InlineStack>
              )}
              {overrideEqUsageMode === "duration_yield" && (
                <InlineStack gap="400" wrap={false}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Run duration minutes"
                      type="number"
                      min={0}
                      step={0.5}
                      value={overrideEqYieldDurationMinutes}
                      onChange={setOverrideEqYieldDurationMinutes}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Products yielded"
                      type="number"
                      min={0}
                      step={1}
                      value={overrideEqYieldQuantity}
                      onChange={setOverrideEqYieldQuantity}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
              )}
              {overrideEqUsageMode === "use_yield" && (
                <InlineStack gap="400" wrap={false}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Run uses"
                      type="number"
                      min={0}
                      step={1}
                      value={overrideEqYieldUses}
                      onChange={setOverrideEqYieldUses}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Products yielded"
                      type="number"
                      min={0}
                      step={1}
                      value={overrideEqYieldQuantity}
                      onChange={setOverrideEqYieldQuantity}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
              )}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>

      <Modal
        open={addEquipmentOpen}
        onClose={() => {
          setAddEquipmentOpen(false);
          resetAdditionalEquipmentModal();
        }}
        title="Add equipment line"
        primaryAction={{
          content: "Add",
          loading: isSaving,
          disabled: !selectedEquipmentId,
          onAction: addAdditionalEquipmentLine,
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => {
            setAddEquipmentOpen(false);
            resetAdditionalEquipmentModal();
          },
        }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Autocomplete
              options={filteredEquipmentOptions}
              selected={selectedEquipmentId ? [selectedEquipmentId] : []}
              onSelect={(selected) => {
                const nextId = selected[0] ?? "";
                const nextEquipment = availableEquipment.find((equipment: AvailableEquipment) => equipment.id === nextId);
                setSelectedEquipmentId(nextId);
                setEquipmentSearchValue(nextEquipment?.name ?? "");
                setEqUsageMode(defaultUsageModeForBasis(nextEquipment?.usageBasis));
                setEqMinutes("");
                setEqUses("");
                setEqYieldDurationMinutes("");
                setEqYieldUses("");
                setEqYieldQuantity("");
              }}
              textField={
                <Autocomplete.TextField
                  label="Equipment"
                  value={equipmentSearchValue}
                  onChange={setEquipmentSearchValue}
                  autoComplete="off"
                  placeholder="Search equipment"
                />
              }
              emptyState={
                <Text as="p" variant="bodyMd" tone="subdued">
                  No matching equipment found.
                </Text>
              }
            />
            <Button
              onClick={() => {
                setQuickEquipmentForm((current) => ({
                  ...current,
                  name: equipmentSearchValue,
                }));
                setQuickEquipmentOpen(true);
              }}
            >
              Create equipment
            </Button>
            <Select
              label="How usage is measured"
              value={eqUsageMode}
              onChange={setEqUsageMode}
              options={equipmentUsageModeOptions}
            />
            {eqUsageMode === "direct" && (
              <InlineStack gap="400" wrap={false}>
                {selectedEquipmentUsageBasis !== "unit" && (
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Minutes"
                      type="number"
                      min={0}
                      step={0.5}
                      value={eqMinutes}
                      onChange={setEqMinutes}
                      autoComplete="off"
                    />
                  </div>
                )}
                {selectedEquipmentUsageBasis !== "time" && (
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Uses"
                      type="number"
                      min={0}
                      step={1}
                      value={eqUses}
                      onChange={setEqUses}
                      autoComplete="off"
                    />
                  </div>
                )}
              </InlineStack>
            )}
            {eqUsageMode === "duration_yield" && (
              <InlineStack gap="400" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Run duration minutes"
                    type="number"
                    min={0}
                    step={0.5}
                    value={eqYieldDurationMinutes}
                    onChange={setEqYieldDurationMinutes}
                    autoComplete="off"
                    helpText="Total equipment time for the run or batch."
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Products yielded"
                    type="number"
                    min={0}
                    step={1}
                    value={eqYieldQuantity}
                    onChange={setEqYieldQuantity}
                    autoComplete="off"
                  />
                </div>
              </InlineStack>
            )}
            {eqUsageMode === "use_yield" && (
              <InlineStack gap="400" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Run uses"
                    type="number"
                    min={0}
                    step={1}
                    value={eqYieldUses}
                    onChange={setEqYieldUses}
                    autoComplete="off"
                    helpText="Total equipment uses for the run or batch."
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Products yielded"
                    type="number"
                    min={0}
                    step={1}
                    value={eqYieldQuantity}
                    onChange={setEqYieldQuantity}
                    autoComplete="off"
                  />
                </div>
              </InlineStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={quickMaterialOpen}
        onClose={() => setQuickMaterialOpen(false)}
        title="Create material"
        primaryAction={{
          content: "Create material",
          loading: quickCreateFetcher.state !== "idle" && quickCreateFetcher.formData?.get("intent") === "quick-create-material",
          onAction: submitQuickMaterial,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setQuickMaterialOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {quickCreateFetcher.data?.actionKind === "quick-create-material" && !quickCreateFetcher.data.ok ? (
              <Banner tone="critical">
                <Text as="p" variant="bodyMd">{quickCreateFetcher.data.message}</Text>
              </Banner>
            ) : null}
            <TextField
              label="Name"
              value={quickMaterialForm.name}
              onChange={(value) => setQuickMaterialForm((current) => ({ ...current, name: value }))}
              autoComplete="off"
            />
            <Select
              label="Material type"
              value={quickMaterialForm.type}
              onChange={(value) => setQuickMaterialForm((current) => ({ ...current, type: value }))}
              options={[
                { label: "Production", value: "production" },
                { label: "Shipping", value: "shipping" },
              ]}
            />
            <Select
              label="Costing method"
              value={quickMaterialForm.costingModel}
              onChange={(value) => setQuickMaterialForm((current) => ({ ...current, costingModel: value }))}
              options={[
                { label: "Counted parts", value: "counted" },
                { label: "Variable yield", value: "yield" },
                { label: "Portioned use", value: "uses" },
              ]}
            />
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Purchase price"
                  type="number"
                  min={0}
                  step={0.01}
                  value={quickMaterialForm.purchasePrice}
                  onChange={(value) => setQuickMaterialForm((current) => ({ ...current, purchasePrice: value }))}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Purchase quantity"
                  type="number"
                  min={0}
                  step={0.01}
                  value={quickMaterialForm.purchaseQty}
                  onChange={(value) => setQuickMaterialForm((current) => ({ ...current, purchaseQty: value }))}
                  autoComplete="off"
                />
              </div>
            </InlineStack>
            {quickMaterialForm.costingModel === "uses" ? (
              <TextField
                label="Portions per purchased unit"
                type="number"
                min={0}
                step={0.01}
                value={quickMaterialForm.totalUsesPerUnit}
                onChange={(value) => setQuickMaterialForm((current) => ({ ...current, totalUsesPerUnit: value }))}
                autoComplete="off"
              />
            ) : null}
            <TextField
              label="Purchase link"
              value={quickMaterialForm.purchaseLink}
              onChange={(value) => setQuickMaterialForm((current) => ({ ...current, purchaseLink: value }))}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={quickEquipmentOpen}
        onClose={() => setQuickEquipmentOpen(false)}
        title="Create equipment"
        primaryAction={{
          content: "Create equipment",
          loading: quickCreateFetcher.state !== "idle" && quickCreateFetcher.formData?.get("intent") === "quick-create-equipment",
          onAction: submitQuickEquipment,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setQuickEquipmentOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {quickCreateFetcher.data?.actionKind === "quick-create-equipment" && !quickCreateFetcher.data.ok ? (
              <Banner tone="critical">
                <Text as="p" variant="bodyMd">{quickCreateFetcher.data.message}</Text>
              </Banner>
            ) : null}
            <TextField
              label="Name"
              value={quickEquipmentForm.name}
              onChange={(value) => setQuickEquipmentForm((current) => ({ ...current, name: value }))}
              autoComplete="off"
            />
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Hourly rate"
                  type="number"
                  min={0}
                  step={0.01}
                  value={quickEquipmentForm.hourlyRate}
                  onChange={(value) => setQuickEquipmentForm((current) => ({ ...current, hourlyRate: value }))}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Per-use cost"
                  type="number"
                  min={0}
                  step={0.01}
                  value={quickEquipmentForm.perUseCost}
                  onChange={(value) => setQuickEquipmentForm((current) => ({ ...current, perUseCost: value }))}
                  autoComplete="off"
                />
              </div>
            </InlineStack>
            <TextField
              label="Equipment cost"
              type="number"
              min={0}
              step={0.01}
              value={quickEquipmentForm.equipmentCost}
              onChange={(value) => setQuickEquipmentForm((current) => ({ ...current, equipmentCost: value }))}
              autoComplete="off"
            />
            <TextField
              label="Purchase link"
              value={quickEquipmentForm.purchaseLink}
              onChange={(value) => setQuickEquipmentForm((current) => ({ ...current, purchaseLink: value }))}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[VariantDetail] ErrorBoundary caught:", error);
  return (
    <Page>
      <TitleBar title="Variant Cost Configuration" />
      <Banner tone="critical">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="bold">Something went wrong loading this variant.</Text>
          <Text as="p" variant="bodyMd">Please refresh the page. If the problem persists, contact support.</Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
