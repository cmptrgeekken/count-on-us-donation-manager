import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator, useRouteError } from "@remix-run/react";
import {
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { z } from "zod";
import { AppSaveBar } from "../components/AppSaveBar";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { resolveCosts } from "../services/costEngine.server";
import { useAppLocalization } from "../utils/use-app-localization";
import {
  applyTemplateSelectionToVariantDraft,
  cloneDraft,
  createClientId,
  normalizeVariantDraft,
  type TemplateCatalogEntry,
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
  hourlyRate: string | null;
  perUseCost: string | null;
  minutes: string | null;
  uses: string | null;
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
  minutes: string | null;
  uses: string | null;
  overrideLineId: string | null;
  overrideMinutes: string | null;
  overrideUses: string | null;
  hasOverride: boolean;
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
    equipment: { name: string; hourlyRate: { toString(): string } | null; perUseCost: { toString(): string } | null };
    minutes: { toString(): string } | null;
    uses: { toString(): string } | null;
  },
): SerializedEquipmentLine {
  return {
    id: line.id,
    equipmentId: line.equipmentId,
    equipmentName: line.equipment.name,
    hourlyRate: line.equipment.hourlyRate?.toString() ?? null,
    perUseCost: line.equipment.perUseCost?.toString() ?? null,
    minutes: line.minutes?.toString() ?? null,
    uses: line.uses?.toString() ?? null,
  };
}

const variantDraftSchema = z.object({
  templateId: z.string().nullable(),
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
    overrideMinutes: z.string().nullable(),
    overrideUses: z.string().nullable(),
  })),
  materialLines: z.array(z.object({
    materialId: z.string(),
    quantity: z.string(),
    yield: z.string().nullable(),
    usesPerVariant: z.string().nullable(),
  })),
  equipmentLines: z.array(z.object({
    equipmentId: z.string(),
    minutes: z.string().nullable(),
    uses: z.string().nullable(),
  })),
});

function parseNullableNumber(value: string | null | undefined, field: string) {
  if (!value || !value.trim()) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Response(`${field} must be a non-negative number.`, { status: 400 });
  }
  return parsed;
}

function parseOptionalPercent(value: string | null | undefined) {
  if (!value || !value.trim()) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
    throw new Response("Mistake buffer must be between 0 and 100.", { status: 400 });
  }
  return parsed / 100;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const { variantId } = params;

  const shop = await prisma.shop.findUnique({
    where: { shopId },
    select: { mistakeBuffer: true, defaultLaborRate: true },
  });

  const variant = await prisma.variant.findFirst({
    where: { id: variantId, shopId },
    include: {
      product: { select: { title: true } },
      costConfig: {
        include: {
          template: {
            include: {
              materialLines: { include: { material: true } },
              equipmentLines: { include: { equipment: true } },
            },
          },
          materialLines: { include: { material: true, templateLine: true } },
          equipmentLines: { include: { equipment: true, templateLine: true } },
        },
      },
    },
  });

  if (!variant || variant.shopId !== shopId) {
    throw new Response("Not found", { status: 404 });
  }

  const [templates, materials, equipment] = await Promise.all([
    prisma.costTemplate.findMany({
      where: { shopId, status: "active" },
      orderBy: { name: "asc" },
      include: {
        materialLines: { include: { material: true }, orderBy: { id: "asc" } },
        equipmentLines: { include: { equipment: true }, orderBy: { id: "asc" } },
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
      select: { id: true, name: true, hourlyRate: true, perUseCost: true },
    }),
  ]);

  const config = variant.costConfig;

  let templateMaterialLines: TemplateMaterialOverrideLine[] = [];
  let templateEquipmentLines: TemplateEquipmentOverrideLine[] = [];
  let additionalMaterialLines: SerializedMaterialLine[] = [];
  let additionalEquipmentLines: SerializedEquipmentLine[] = [];

  if (config) {
    const templateMaterialSource = config.template?.materialLines ?? [];
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

    const templateEquipmentSource = config.template?.equipmentLines ?? [];
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
        minutes: line.minutes?.toString() ?? null,
        uses: line.uses?.toString() ?? null,
        overrideLineId: override?.id ?? null,
        overrideMinutes: override?.minutes?.toString() ?? null,
        overrideUses: override?.uses?.toString() ?? null,
        hasOverride: Boolean(override),
      };
    });

    additionalEquipmentLines = config.equipmentLines
      .filter((line) => !line.templateLineId && !consumedEquipmentLineIds.has(line.id))
      .map(serializeVariantEquipmentLine);
  }

  return Response.json({
    variant: {
      id: variant.id,
      productTitle: variant.product.title,
      title: variant.title,
      sku: variant.sku ?? "",
      price: variant.price.toString(),
    },
    shopDefaults: {
      defaultLaborRate: shop?.defaultLaborRate?.toString() ?? "",
      mistakeBuffer: shop?.mistakeBuffer ? (Number(shop.mistakeBuffer) * 100).toFixed(2) : "",
    },
    config: config
      ? {
          id: config.id,
          templateId: config.templateId,
          templateName: config.template?.name ?? null,
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
        minutes: line.minutes?.toString() ?? null,
        uses: line.uses?.toString() ?? null,
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
    availableEquipment: equipment.map((item) => ({
      id: item.id,
      name: item.name,
      hourlyRate: item.hourlyRate?.toString() ?? null,
      perUseCost: item.perUseCost?.toString() ?? null,
    })),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const variantId = params.variantId ?? "";

  const variant = await prisma.variant.findFirst({
    where: { id: variantId, shopId },
    select: { shopId: true, price: true },
  });
  if (!variant) {
    return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

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
          variantConfigs: {
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
          variantConfigs: {
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
      return Response.json({ ok: false, message: "Draft data is required." }, { status: 400 });
    }

    const parsedDraft = variantDraftSchema.safeParse(JSON.parse(rawDraft));
    if (!parsedDraft.success) {
      return Response.json(
        { ok: false, message: parsedDraft.error.issues[0]?.message ?? "Invalid variant data." },
        { status: 400 },
      );
    }

    const draft = parsedDraft.data;
    const selectedTemplate = draft.templateId
      ? await prisma.costTemplate.findFirst({
          where: { id: draft.templateId, shopId },
          include: {
            materialLines: { select: { id: true, materialId: true } },
            equipmentLines: { select: { id: true, equipmentId: true } },
          },
        })
      : null;

    if (draft.templateId && !selectedTemplate) {
      return Response.json({ ok: false, message: "Template not found." }, { status: 404 });
    }

    const materialMap = new Map((selectedTemplate?.materialLines ?? []).map((line) => [line.id, line.materialId]));
    const equipmentMap = new Map((selectedTemplate?.equipmentLines ?? []).map((line) => [line.id, line.equipmentId]));

    for (const line of draft.templateMaterialLines) {
      if (!materialMap.has(line.templateLineId) || materialMap.get(line.templateLineId) !== line.materialId) {
        return Response.json({ ok: false, message: "One or more material overrides are invalid." }, { status: 400 });
      }
    }

    for (const line of draft.templateEquipmentLines) {
      if (!equipmentMap.has(line.templateLineId) || equipmentMap.get(line.templateLineId) !== line.equipmentId) {
        return Response.json({ ok: false, message: "One or more equipment overrides are invalid." }, { status: 400 });
      }
    }

    const additionalMaterialIds = [...new Set(draft.materialLines.map((line) => line.materialId))];
    const additionalEquipmentIds = [...new Set(draft.equipmentLines.map((line) => line.equipmentId))];

    const [materialsFound, equipmentFound, existingConfig] = await Promise.all([
      prisma.materialLibraryItem.findMany({ where: { id: { in: additionalMaterialIds }, shopId }, select: { id: true } }),
      prisma.equipmentLibraryItem.findMany({ where: { id: { in: additionalEquipmentIds }, shopId }, select: { id: true } }),
      prisma.variantCostConfig.findFirst({ where: { variantId, shopId }, select: { id: true } }),
    ]);

    if (materialsFound.length !== additionalMaterialIds.length) {
      return Response.json({ ok: false, message: "One or more additional materials could not be found." }, { status: 404 });
    }

    if (equipmentFound.length !== additionalEquipmentIds.length) {
      return Response.json({ ok: false, message: "One or more additional equipment items could not be found." }, { status: 404 });
    }

    const hasMeaningfulDraft = Boolean(
      draft.templateId ||
        draft.laborMinutes ||
        draft.laborRate ||
        draft.mistakeBuffer ||
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

      return Response.json({
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
        quantity: parseNullableNumber(line.overrideQuantity, "Material quantity") ?? 0,
        yield: parseNullableNumber(line.overrideYield, "Material yield"),
        usesPerVariant: parseNullableNumber(line.overrideUsesPerVariant, "Material uses per variant"),
      }));

    const equipmentOverrideLines = draft.templateEquipmentLines
      .filter((line) => line.hasOverride)
      .map((line) => ({
        shopId,
        templateLineId: line.templateLineId,
        equipmentId: line.equipmentId,
        minutes: parseNullableNumber(line.overrideMinutes, "Equipment minutes"),
        uses: parseNullableNumber(line.overrideUses, "Equipment uses"),
      }));

    const additionalMaterialLines = draft.materialLines.map((line) => ({
      shopId,
      materialId: line.materialId,
      quantity: parseNullableNumber(line.quantity, "Material quantity") ?? 0,
      yield: parseNullableNumber(line.yield, "Material yield"),
      usesPerVariant: parseNullableNumber(line.usesPerVariant, "Material uses per variant"),
    }));

    const additionalEquipmentLines = draft.equipmentLines.map((line) => ({
      shopId,
      equipmentId: line.equipmentId,
      minutes: parseNullableNumber(line.minutes, "Equipment minutes"),
      uses: parseNullableNumber(line.uses, "Equipment uses"),
    }));

    await prisma.$transaction(async (tx) => {
      let configId = existingConfig?.id;

      if (configId) {
        await tx.variantCostConfig.updateMany({
          where: { id: configId, shopId },
          data: {
            templateId: draft.templateId,
            laborMinutes: parseNullableNumber(draft.laborMinutes, "Labor minutes"),
            laborRate: parseNullableNumber(draft.laborRate, "Labor rate"),
            mistakeBuffer: parseOptionalPercent(draft.mistakeBuffer),
            lineItemCount: draft.materialLines.length + draft.equipmentLines.length,
          },
        });
      } else {
        const createdConfig = await tx.variantCostConfig.create({
          data: {
            shopId,
            variantId,
            templateId: draft.templateId,
            laborMinutes: parseNullableNumber(draft.laborMinutes, "Labor minutes"),
            laborRate: parseNullableNumber(draft.laborRate, "Labor rate"),
            mistakeBuffer: parseOptionalPercent(draft.mistakeBuffer),
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

    return Response.json({
      ok: true,
      message: "Variant configuration saved.",
      savedAt: new Date().toISOString(),
    });
  }

  if (intent === "assign-template") {
    const templateId = formData.get("templateId")?.toString() ?? "";
    await requireTemplate(templateId);
    const config = await ensureConfig();
    const currentConfig = await prisma.variantCostConfig.findFirst({
      where: { id: config.id, shopId },
      include: {
        template: {
          select: {
            materialLines: { select: { materialId: true } },
            equipmentLines: { select: { equipmentId: true } },
          },
        },
      },
    });
    const legacyOverrideIds = getLegacyOverrideIds(currentConfig?.template);

    await prisma.$transaction([
      prisma.variantCostConfig.updateMany({ where: { id: config.id, shopId }, data: { templateId } }),
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
    return Response.json({ ok: true, message: "Template assigned." });
  }

  if (intent === "remove-template") {
    const config = await prisma.variantCostConfig.findFirst({
      where: { variantId, shopId },
      include: {
        template: {
          select: {
            materialLines: { select: { materialId: true } },
            equipmentLines: { select: { equipmentId: true } },
          },
        },
      },
    });
    if (config) {
      const legacyOverrideIds = getLegacyOverrideIds(config.template);
      await prisma.$transaction([
        prisma.variantCostConfig.updateMany({ where: { id: config.id, shopId }, data: { templateId: null } }),
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
    return Response.json({ ok: true, message: "Template removed." });
  }

  if (intent === "update-labor") {
    const laborMinutes = formData.get("laborMinutes")?.toString();
    const laborRate = formData.get("laborRate")?.toString();
    const config = await ensureConfig();

    await prisma.variantCostConfig.updateMany({
      where: { id: config.id, shopId },
      data: {
        laborMinutes: laborMinutes ? parseFloat(laborMinutes) : null,
        laborRate: laborRate ? parseFloat(laborRate) : null,
      },
    });
    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "LABOR_UPDATED", actor: "merchant" },
    });
    return Response.json({ ok: true, message: "Labor updated." });
  }

  if (intent === "update-mistake-buffer") {
    const bufferStr = formData.get("mistakeBuffer")?.toString() ?? "";
    const buffer = bufferStr ? parseFloat(bufferStr) : null;
    if (buffer !== null && (isNaN(buffer) || buffer < 0 || buffer > 100)) {
      return Response.json({ ok: false, message: "Mistake buffer must be 0-100." }, { status: 400 });
    }

    const config = await ensureConfig();
    await prisma.variantCostConfig.updateMany({
      where: { id: config.id, shopId },
      data: { mistakeBuffer: buffer !== null ? buffer / 100 : null },
    });
    return Response.json({ ok: true, message: "Mistake buffer updated." });
  }

  if (intent === "save-material-override") {
    const templateLineId = formData.get("templateLineId")?.toString() ?? "";
    const materialId = formData.get("materialId")?.toString() ?? "";
    const quantity = parseFloat(formData.get("quantity")?.toString() ?? "1");
    const yieldVal = formData.get("yield")?.toString();
    const usesPerVariant = formData.get("usesPerVariant")?.toString();
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
          yield: yieldVal ? parseFloat(yieldVal) : null,
          usesPerVariant: usesPerVariant ? parseFloat(usesPerVariant) : null,
        },
      });
    } else if (legacy) {
      await prisma.variantMaterialLine.updateMany({
        where: { id: legacy.id, shopId },
        data: {
          templateLineId,
          materialId,
          quantity,
          yield: yieldVal ? parseFloat(yieldVal) : null,
          usesPerVariant: usesPerVariant ? parseFloat(usesPerVariant) : null,
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
          yield: yieldVal ? parseFloat(yieldVal) : null,
          usesPerVariant: usesPerVariant ? parseFloat(usesPerVariant) : null,
        },
      });
    }

    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "MATERIAL_OVERRIDE_SAVED", actor: "merchant" },
    });
    return Response.json({ ok: true, message: "Material override saved." });
  }

  if (intent === "reset-material-override") {
    const templateLineId = formData.get("templateLineId")?.toString() ?? "";
    const config = await prisma.variantCostConfig.findFirst({ where: { variantId, shopId }, select: { id: true } });
    if (!config) return Response.json({ ok: false, message: "Configuration not found." }, { status: 404 });
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
    return Response.json({ ok: true, message: "Material override reset." });
  }

  if (intent === "add-material-line") {
    const materialId = formData.get("materialId")?.toString() ?? "";
    const quantity = parseFloat(formData.get("quantity")?.toString() ?? "1");
    const yieldVal = formData.get("yield")?.toString();
    const usesPerVariant = formData.get("usesPerVariant")?.toString();
    const config = await ensureConfig();

    await prisma.$transaction([
      prisma.variantMaterialLine.create({
        data: {
          shopId,
          configId: config.id,
          materialId,
          quantity,
          yield: yieldVal ? parseFloat(yieldVal) : null,
          usesPerVariant: usesPerVariant ? parseFloat(usesPerVariant) : null,
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
    return Response.json({ ok: true, message: "Material line added." });
  }

  if (intent === "remove-material-line") {
    const lineId = formData.get("lineId")?.toString() ?? "";
    const line = await prisma.variantMaterialLine.findFirst({
      where: { id: lineId, shopId, templateLineId: null },
      select: { configId: true },
    });
    if (!line) return Response.json({ ok: false, message: "Line not found." }, { status: 404 });

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
    return Response.json({ ok: true, message: "Material line removed." });
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
    return Response.json({ ok: true, message: "Equipment override saved." });
  }

  if (intent === "reset-equipment-override") {
    const templateLineId = formData.get("templateLineId")?.toString() ?? "";
    const config = await prisma.variantCostConfig.findFirst({ where: { variantId, shopId }, select: { id: true } });
    if (!config) return Response.json({ ok: false, message: "Configuration not found." }, { status: 404 });
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
    return Response.json({ ok: true, message: "Equipment override reset." });
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
    return Response.json({ ok: true, message: "Equipment line added." });
  }

  if (intent === "remove-equipment-line") {
    const lineId = formData.get("lineId")?.toString() ?? "";
    const line = await prisma.variantEquipmentLine.findFirst({
      where: { id: lineId, shopId, templateLineId: null },
      select: { configId: true },
    });
    if (!line) return Response.json({ ok: false, message: "Line not found." }, { status: 404 });

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
    return Response.json({ ok: true, message: "Equipment line removed." });
  }

  if (intent === "preview-cost") {
    const result = await resolveCosts(
      shopId,
      variantId,
      variant.price,
      "preview",
      prisma as Parameters<typeof resolveCosts>[4],
    );
    return Response.json({
      ok: true,
      preview: {
        laborCost: result.laborCost.toFixed(2),
        materialCost: result.materialCost.toFixed(2),
        packagingCost: result.packagingCost.toFixed(2),
        equipmentCost: result.equipmentCost.toFixed(2),
        mistakeBufferAmount: result.mistakeBufferAmount.toFixed(2),
        totalCost: result.totalCost.toFixed(2),
      },
    });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

type AvailableMaterial = {
  id: string;
  name: string;
  type: string;
  costingModel: string | null;
  perUnitCost: string;
  totalUsesPerUnit: string | null;
};

function describeMaterialLine(line: {
  costingModel: string | null;
  quantity: string | null;
  yield: string | null;
  usesPerVariant: string | null;
}) {
  if (line.costingModel === "uses") {
    return `Uses: ${line.usesPerVariant ?? "0"}`;
  }

  return `Qty: ${line.quantity ?? "0"} - Yield: ${line.yield ?? "0"}`;
}

function describeEquipmentLine(line: {
  minutes: string | null;
  uses: string | null;
}) {
  return [line.minutes ? `${line.minutes} min` : null, line.uses ? `${line.uses} uses` : null]
    .filter(Boolean)
    .join(" · ");
}

function buildVariantDraft(config: {
  templateId: string | null;
  laborMinutes: string;
  laborRate: string;
  mistakeBuffer: string;
  templateMaterialLines: TemplateMaterialOverrideLine[];
  templateEquipmentLines: TemplateEquipmentOverrideLine[];
  materialLines: SerializedMaterialLine[];
  equipmentLines: SerializedEquipmentLine[];
} | null): VariantDraft {
  return {
    templateId: config?.templateId ?? null,
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
  const { variant, config, shopDefaults, templates, availableMaterials, availableEquipment } =
    useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<{ ok: boolean; message: string; savedAt?: string }>();
  const previewFetcher = useFetcher<{ ok: boolean; message: string; preview?: Record<string, string> }>();
  const revalidator = useRevalidator();

  const { formatMoney, formatPct, getCurrencySymbol } = useAppLocalization();

  const [assignTemplateOpen, setAssignTemplateOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(config?.templateId ?? templates[0]?.id ?? "");

  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState(availableMaterials[0]?.id ?? "");
  const [matQty, setMatQty] = useState("1");
  const [matYield, setMatYield] = useState("");
  const [matUses, setMatUses] = useState("");

  const [materialOverrideTargetId, setMaterialOverrideTargetId] = useState<string | null>(null);
  const [overrideMatQty, setOverrideMatQty] = useState("1");
  const [overrideMatYield, setOverrideMatYield] = useState("");
  const [overrideMatUses, setOverrideMatUses] = useState("");

  const [addEquipmentOpen, setAddEquipmentOpen] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState(availableEquipment[0]?.id ?? "");
  const [eqMinutes, setEqMinutes] = useState("");
  const [eqUses, setEqUses] = useState("");

  const [equipmentOverrideTargetId, setEquipmentOverrideTargetId] = useState<string | null>(null);
  const [overrideEqMinutes, setOverrideEqMinutes] = useState("");
  const [overrideEqUses, setOverrideEqUses] = useState("");

  const [baseDraft, setBaseDraft] = useState(() => buildVariantDraft(config));
  const [draft, setDraft] = useState(() => buildVariantDraft(config));
  const handledSaveRef = useRef<string | null>(null);

  const isSaving = saveFetcher.state !== "idle";
  const preview = previewFetcher.data?.preview;
  const selectedMaterial = availableMaterials.find((material: AvailableMaterial) => material.id === selectedMaterialId);
  const materialOverrideTarget =
    draft.templateMaterialLines.find((line) => line.templateLineId === materialOverrideTargetId) ?? null;
  const equipmentOverrideTarget =
    draft.templateEquipmentLines.find((line) => line.templateLineId === equipmentOverrideTargetId) ?? null;
  const isDirty = serializeVariantDraftState(draft) !== serializeVariantDraftState(baseDraft);
  const shopDefaultLaborRate = shopDefaults.defaultLaborRate;
  const effectiveLaborRateLabel = draft.laborRate
    ? `${formatMoney(draft.laborRate)}/hr (Variant override)`
    : shopDefaultLaborRate
      ? `${formatMoney(shopDefaultLaborRate)}/hr (Shop default)`
      : "No labor rate set";
  const laborRateHelpText = shopDefaultLaborRate
    ? `Leave blank to use the shop default of ${formatMoney(shopDefaultLaborRate)}/hr.`
    : "Leave blank to avoid a variant override. Set a shop default in Settings to make variants inherit one.";

  useEffect(() => {
    if (!saveFetcher.data?.ok || !saveFetcher.data.savedAt || saveFetcher.data.savedAt === handledSaveRef.current) return;
    handledSaveRef.current = saveFetcher.data.savedAt;
    const committedDraft = cloneDraft(draft);
    setBaseDraft(committedDraft);
    setDraft(committedDraft);
    revalidator.revalidate();
  }, [draft, revalidator, saveFetcher.data]);

  function resetAdditionalMaterialModal() {
    setSelectedMaterialId(availableMaterials[0]?.id ?? "");
    setMatQty("1");
    setMatYield("");
    setMatUses("");
  }

  function resetAdditionalEquipmentModal() {
    setSelectedEquipmentId(availableEquipment[0]?.id ?? "");
    setEqMinutes("");
    setEqUses("");
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
    setEquipmentOverrideTargetId(line.templateLineId);
    setOverrideEqMinutes(line.overrideMinutes ?? line.minutes ?? "");
    setOverrideEqUses(line.overrideUses ?? line.uses ?? "");
  }

  function closeEquipmentOverride() {
    setEquipmentOverrideTargetId(null);
    setOverrideEqMinutes("");
    setOverrideEqUses("");
  }

  function discardChanges() {
    setDraft(cloneDraft(baseDraft));
    setAssignTemplateOpen(false);
    setMaterialOverrideTargetId(null);
    setEquipmentOverrideTargetId(null);
    setAddMaterialOpen(false);
    setAddEquipmentOpen(false);
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

  function applySelectedTemplate() {
    const nextTemplate = templates.find((template: TemplateCatalogEntry) => template.id === selectedTemplateId) ?? null;
    setDraft((current) => applyTemplateSelectionToVariantDraft(current, nextTemplate));
    setAssignTemplateOpen(false);
  }

  function removeSelectedTemplate() {
    setDraft((current) => applyTemplateSelectionToVariantDraft(current, null));
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

    setDraft((current) => ({ ...current, materialLines: [...current.materialLines, nextLine] }));
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
    const equipment = availableEquipment.find((item: { id: string }) => item.id === selectedEquipmentId);
    if (!equipment) return;

    const nextLine: SerializedEquipmentLine = {
      id: createClientId("draft-equipment"),
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      hourlyRate: equipment.hourlyRate,
      perUseCost: equipment.perUseCost,
      minutes: eqMinutes || null,
      uses: eqUses || null,
    };

    setDraft((current) => ({ ...current, equipmentLines: [...current.equipmentLines, nextLine] }));
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
              overrideMinutes: overrideEqMinutes || null,
              overrideUses: overrideEqUses || null,
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
              overrideMinutes: null,
              overrideUses: null,
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
      backAction={{ content: "Variants", url: "/app/variants" }}
      title={`${variant.productTitle} - ${variant.title}`}
    >
      <TitleBar title="Variant Cost Configuration" />
      <AppSaveBar open={isDirty} onSave={saveDraft} onDiscard={discardChanges} loading={isSaving} />

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {saveFetcher.data?.message ?? previewFetcher.data?.message ?? ""}
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
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Cost Template</Text>
              <InlineStack gap="200">
                {draft.templateId && (
                  <Button variant="plain" tone="critical" onClick={removeSelectedTemplate}>
                    Remove
                  </Button>
                )}
                <Button
                  onClick={() => {
                    setSelectedTemplateId(draft.templateId ?? templates[0]?.id ?? "");
                    setAssignTemplateOpen(true);
                  }}
                  disabled={templates.length === 0}
                >
                  {draft.templateId ? "Change template" : "Assign template"}
                </Button>
              </InlineStack>
            </InlineStack>
            <Divider />
            {draft.templateId ? (
              <Text as="p" variant="bodyMd">
                {templates.find((template: TemplateCatalogEntry) => template.id === draft.templateId)?.name ?? "Assigned template"}
              </Text>
            ) : (
              <Text as="p" variant="bodyMd" tone="subdued">No template assigned - configure lines manually below.</Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Labor</Text>
            <Divider />
            <BlockStack gap="400">
              <InlineStack gap="400" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Minutes per variant"
                    type="number"
                    min={0}
                    step={0.5}
                    value={draft.laborMinutes}
                    onChange={(value) => setDraft((current) => ({ ...current, laborMinutes: value }))}
                    autoComplete="off"
                  />
                </div>
                <div style={{ flex: 1 }}>
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
                    autoComplete="off"
                    helpText={laborRateHelpText}
                  />
                </div>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                Current effective rate: {effectiveLaborRateLabel}
              </Text>
            </BlockStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Mistake Buffer Override</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Overrides the global default from Settings for this variant only.
              </Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="400">
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
                {draft.mistakeBuffer
                  ? formatPct(Number(draft.mistakeBuffer) / 100)
                  : `${formatPct((Number(shopDefaults.mistakeBuffer ?? "0")) / 100)} (Shop Default)`}
              </Text>
            </BlockStack>
          </BlockStack>
        </Card>

        {draft.templateId && (
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Template Material Lines</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Override assigned template materials without cloning the template.
                </Text>
              </BlockStack>
              <Divider />
              {draft.templateMaterialLines.length === 0 ? (
                <Text as="p" variant="bodyMd" tone="subdued">This template has no material lines.</Text>
              ) : (
                <BlockStack gap="300">
                  {draft.templateMaterialLines.map((line) => (
                    <InlineStack key={line.templateLineId} align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{line.materialName}</Text>
                          <Badge tone={line.hasOverride ? "attention" : "info"}>
                            {line.hasOverride ? "Override active" : "Using template default"}
                          </Badge>
                        </InlineStack>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Default: {describeMaterialLine(line)}
                        </Text>
                        {line.hasOverride && (
                          <Text as="p" variant="bodyMd" tone="subdued">
                            Override: {describeMaterialLine({
                              costingModel: line.costingModel,
                              quantity: line.overrideQuantity,
                              yield: line.overrideYield,
                              usesPerVariant: line.overrideUsesPerVariant,
                            })}
                          </Text>
                        )}
                      </BlockStack>
                      <InlineStack gap="200">
                        <Button variant="plain" onClick={() => openMaterialOverride(line)}>
                          {line.hasOverride ? "Edit override" : "Override"}
                        </Button>
                        {line.hasOverride && (
                          <Button variant="plain" onClick={() => resetMaterialOverride(line.templateLineId)}>
                            Reset
                          </Button>
                        )}
                      </InlineStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Additional Material Lines</Text>
                  {draft.materialLines.length > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {draft.materialLines.length}
                    </Text>
                  )}
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Add variant-only materials that are not part of the assigned template.
                </Text>
              </BlockStack>
              <Button onClick={() => setAddMaterialOpen(true)} disabled={availableMaterials.length === 0}>
                Add material
              </Button>
            </InlineStack>
            <Divider />
            {draft.materialLines.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">No variant-only material lines.</Text>
            ) : (
              <BlockStack gap="300">
                {draft.materialLines.map((line: SerializedMaterialLine) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.materialName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">{describeMaterialLine(line)}</Text>
                    </BlockStack>
                    <Button variant="plain" tone="critical" onClick={() => removeAdditionalMaterialLine(line.id)}>
                      Remove
                    </Button>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {draft.templateId && (
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Template Equipment Lines</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Override assigned template equipment values per variant.
                </Text>
              </BlockStack>
              <Divider />
              {draft.templateEquipmentLines.length === 0 ? (
                <Text as="p" variant="bodyMd" tone="subdued">This template has no equipment lines.</Text>
              ) : (
                <BlockStack gap="300">
                  {draft.templateEquipmentLines.map((line) => (
                    <InlineStack key={line.templateLineId} align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{line.equipmentName}</Text>
                          <Badge tone={line.hasOverride ? "attention" : "info"}>
                            {line.hasOverride ? "Override active" : "Using template default"}
                          </Badge>
                        </InlineStack>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Default: {describeEquipmentLine(line)}
                        </Text>
                        {line.hasOverride && (
                          <Text as="p" variant="bodyMd" tone="subdued">
                            Override: {describeEquipmentLine({
                              minutes: line.overrideMinutes,
                              uses: line.overrideUses,
                            })}
                          </Text>
                        )}
                      </BlockStack>
                      <InlineStack gap="200">
                        <Button variant="plain" onClick={() => openEquipmentOverride(line)}>
                          {line.hasOverride ? "Edit override" : "Override"}
                        </Button>
                        {line.hasOverride && (
                          <Button variant="plain" onClick={() => resetEquipmentOverride(line.templateLineId)}>
                            Reset
                          </Button>
                        )}
                      </InlineStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Additional Equipment Lines</Text>
                  {draft.equipmentLines.length > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {draft.equipmentLines.length}
                    </Text>
                  )}
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Add variant-only equipment usage outside the assigned template.
                </Text>
              </BlockStack>
              <Button onClick={() => setAddEquipmentOpen(true)} disabled={availableEquipment.length === 0}>
                Add equipment
              </Button>
            </InlineStack>
            <Divider />
            {draft.equipmentLines.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">No variant-only equipment lines.</Text>
            ) : (
              <BlockStack gap="300">
                {draft.equipmentLines.map((line: SerializedEquipmentLine) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.equipmentName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">{describeEquipmentLine(line)}</Text>
                    </BlockStack>
                    <Button variant="plain" tone="critical" onClick={() => removeAdditionalEquipmentLine(line.id)}>
                      Remove
                    </Button>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
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
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Labor</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.laborCost)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Materials (production)</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.materialCost)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Packaging (shipping materials)</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.packagingCost)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Equipment</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.equipmentCost)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Mistake buffer</Text>
                  <Text as="p" variant="bodyMd">{formatMoney(preview.mistakeBufferAmount)}</Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">Total cost</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{formatMoney(preview.totalCost)}</Text>
                </InlineStack>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={assignTemplateOpen}
        onClose={() => setAssignTemplateOpen(false)}
        title="Assign template"
        primaryAction={{
          content: draft.templateId ? "Apply" : "Assign",
          loading: isSaving,
          onAction: applySelectedTemplate,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAssignTemplateOpen(false) }]}
      >
        <Modal.Section>
          <Select
            label="Template"
            options={templates.map((template: { id: string; name: string }) => ({ label: template.name, value: template.id }))}
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
          />
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
              {materialOverrideTarget.costingModel === "yield" && (
                <>
                  <TextField
                    label="Material quantity"
                    type="number"
                    min={0}
                    step={1}
                    value={overrideMatQty}
                    onChange={setOverrideMatQty}
                    autoComplete="off"
                  />
                  <TextField
                    label="Yield per piece"
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
                  label="Uses per variant"
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
            <Select
              label="Material"
              options={availableMaterials.map((material: AvailableMaterial) => ({ label: material.name, value: material.id }))}
              value={selectedMaterialId}
              onChange={(value) => {
                setSelectedMaterialId(value);
                setMatYield("");
                setMatUses("");
              }}
            />
            {selectedMaterial?.costingModel === "yield" && (
              <>
                <TextField
                  label="Material quantity"
                  type="number"
                  min={0}
                  step={1}
                  value={matQty}
                  onChange={setMatQty}
                  autoComplete="off"
                  helpText="Number of pieces of this material required to produce this variant."
                />
                <TextField
                  label="Yield per piece"
                  type="number"
                  min={0}
                  step={1}
                  value={matYield}
                  onChange={setMatYield}
                  autoComplete="off"
                  helpText="Number of variants produced from one piece of this material."
                />
              </>
            )}
            {selectedMaterial?.costingModel === "uses" && (
              <TextField
                label="Uses per variant"
                type="number"
                min={0}
                step={1}
                value={matUses}
                onChange={setMatUses}
                autoComplete="off"
                helpText="Number of uses of the material this variant requires."
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
              <InlineStack gap="400" wrap={false}>
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
              </InlineStack>
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
            <Select
              label="Equipment"
              options={availableEquipment.map((equipment: { id: string; name: string }) => ({ label: equipment.name, value: equipment.id }))}
              value={selectedEquipmentId}
              onChange={setSelectedEquipmentId}
            />
            <InlineStack gap="400" wrap={false}>
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
            </InlineStack>
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
