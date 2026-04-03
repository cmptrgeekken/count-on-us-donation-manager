import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
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
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { resolveCosts } from "../services/costEngine.server";
import l10n from "../utils/localization";

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
      select: { id: true, name: true },
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
    templates: templates.map((template) => ({ id: template.id, name: template.name })),
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

export default function VariantDetailPage() {
  const { variant, config, shopDefaults, templates, availableMaterials, availableEquipment } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string; preview?: Record<string, string> }>();
  const { formatMoney, formatPct, getCurrencySymbol } = l10n();

  const [assignTemplateOpen, setAssignTemplateOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "");

  const [editingLabor, setEditingLabor] = useState(false);
  const [laborMinutes, setLaborMinutes] = useState(config?.laborMinutes ?? "");
  const [laborRate, setLaborRate] = useState(config?.laborRate ?? "");

  const [editingBuffer, setEditingBuffer] = useState(false);
  const [bufferInput, setBufferInput] = useState(config?.mistakeBuffer ?? "");

  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState(availableMaterials[0]?.id ?? "");
  const [matQty, setMatQty] = useState("1");
  const [matYield, setMatYield] = useState("");
  const [matUses, setMatUses] = useState("");

  const [materialOverrideTarget, setMaterialOverrideTarget] = useState<TemplateMaterialOverrideLine | null>(null);
  const [overrideMatQty, setOverrideMatQty] = useState("1");
  const [overrideMatYield, setOverrideMatYield] = useState("");
  const [overrideMatUses, setOverrideMatUses] = useState("");

  const [addEquipmentOpen, setAddEquipmentOpen] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState(availableEquipment[0]?.id ?? "");
  const [eqMinutes, setEqMinutes] = useState("");
  const [eqUses, setEqUses] = useState("");

  const [equipmentOverrideTarget, setEquipmentOverrideTarget] = useState<TemplateEquipmentOverrideLine | null>(null);
  const [overrideEqMinutes, setOverrideEqMinutes] = useState("");
  const [overrideEqUses, setOverrideEqUses] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const preview = fetcher.data?.preview;
  const selectedMaterial = availableMaterials.find((material: AvailableMaterial) => material.id === selectedMaterialId);
  const shopDefaultLaborRate = shopDefaults.defaultLaborRate;
  const effectiveLaborRateLabel = config?.laborRate
    ? `${formatMoney(config.laborRate)}/hr (Variant override)`
    : shopDefaultLaborRate
      ? `${formatMoney(shopDefaultLaborRate)}/hr (Shop default)`
      : "No labor rate set";
  const laborRateHelpText = shopDefaultLaborRate
    ? `Leave blank to use the shop default of ${formatMoney(shopDefaultLaborRate)}/hr.`
    : "Leave blank to avoid a variant override. Set a shop default in Settings to make variants inherit one.";

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

  function openMaterialOverride(line: TemplateMaterialOverrideLine) {
    setMaterialOverrideTarget(line);
    setOverrideMatQty(line.overrideQuantity ?? line.quantity);
    setOverrideMatYield(line.overrideYield ?? line.yield ?? "");
    setOverrideMatUses(line.overrideUsesPerVariant ?? line.usesPerVariant ?? "");
  }

  function closeMaterialOverride() {
    setMaterialOverrideTarget(null);
    setOverrideMatQty("1");
    setOverrideMatYield("");
    setOverrideMatUses("");
  }

  function openEquipmentOverride(line: TemplateEquipmentOverrideLine) {
    setEquipmentOverrideTarget(line);
    setOverrideEqMinutes(line.overrideMinutes ?? line.minutes ?? "");
    setOverrideEqUses(line.overrideUses ?? line.uses ?? "");
  }

  function closeEquipmentOverride() {
    setEquipmentOverrideTarget(null);
    setOverrideEqMinutes("");
    setOverrideEqUses("");
  }

  function refreshPreview() {
    const fd = new FormData();
    fd.append("intent", "preview-cost");
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <Page
      backAction={{ content: "Variants", url: "/app/variants" }}
      title={`${variant.productTitle} - ${variant.title}`}
    >
      <TitleBar title="Variant Cost Configuration" />

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {fetcher.data?.message ?? ""}
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
                {config?.templateId && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="remove-template" />
                    <Button variant="plain" tone="critical" submit loading={isSubmitting}>Remove</Button>
                  </fetcher.Form>
                )}
                <Button onClick={() => setAssignTemplateOpen(true)} disabled={templates.length === 0}>
                  {config?.templateId ? "Change template" : "Assign template"}
                </Button>
              </InlineStack>
            </InlineStack>
            <Divider />
            {config?.templateName ? (
              <Text as="p" variant="bodyMd">{config.templateName}</Text>
            ) : (
              <Text as="p" variant="bodyMd" tone="subdued">No template assigned - configure lines manually below.</Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Labor</Text>
              <Button variant="plain" onClick={() => setEditingLabor((value) => !value)}>
                {editingLabor ? "Cancel" : "Edit"}
              </Button>
            </InlineStack>
            <Divider />
            {editingLabor ? (
              <fetcher.Form method="post" onSubmit={() => setEditingLabor(false)}>
                <BlockStack gap="400">
                  <input type="hidden" name="intent" value="update-labor" />
                  <InlineStack gap="400" wrap={false}>
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Minutes per variant"
                        name="laborMinutes"
                        type="number"
                        min={0}
                        step={0.5}
                        value={laborMinutes}
                        onChange={setLaborMinutes}
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
                        name="laborRate"
                        type="number"
                        min={0}
                        step={0.01}
                        value={laborRate}
                        onChange={setLaborRate}
                        autoComplete="off"
                        helpText={laborRateHelpText}
                      />
                    </div>
                  </InlineStack>
                  <Button submit loading={isSubmitting}>Save</Button>
                </BlockStack>
              </fetcher.Form>
            ) : (
              <InlineStack gap="600">
                <Text as="p" variant="bodyMd" tone="subdued">
                  {config?.laborMinutes ? `${config.laborMinutes} min` : "Not set"}
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {effectiveLaborRateLabel}
                </Text>
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Mistake Buffer Override</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Overrides the global default from Settings for this variant only.
                </Text>
              </BlockStack>
              <Button variant="plain" onClick={() => setEditingBuffer((value) => !value)}>
                {editingBuffer ? "Cancel" : "Edit"}
              </Button>
            </InlineStack>
            <Divider />
            {editingBuffer ? (
              <fetcher.Form method="post" onSubmit={() => setEditingBuffer(false)}>
                <BlockStack gap="400">
                  <input type="hidden" name="intent" value="update-mistake-buffer" />
                  <TextField
                    label="Mistake buffer (%)"
                    placeholder={`${formatPct((Number(shopDefaults.mistakeBuffer ?? "0")) / 100)} (Shop Default)`}
                    name="mistakeBuffer"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={bufferInput}
                    onChange={setBufferInput}
                    autoComplete="off"
                    helpText="Leave blank to use the global default from Settings"
                  />
                  <Button submit loading={isSubmitting}>Save</Button>
                </BlockStack>
              </fetcher.Form>
            ) : (
              <Text as="p" variant="bodyMd" tone="subdued">
                {config?.mistakeBuffer
                  ? formatPct(Number(config.mistakeBuffer) / 100)
                  : `${formatPct((Number(shopDefaults.mistakeBuffer ?? "0")) / 100)} (Shop Default)`}
              </Text>
            )}
          </BlockStack>
        </Card>

        {config?.templateId && (
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Template Material Lines</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Override assigned template materials without cloning the template.
                </Text>
              </BlockStack>
              <Divider />
              {config.templateMaterialLines.length === 0 ? (
                <Text as="p" variant="bodyMd" tone="subdued">This template has no material lines.</Text>
              ) : (
                <BlockStack gap="300">
                  {config.templateMaterialLines.map((line: TemplateMaterialOverrideLine) => (
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
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="reset-material-override" />
                            <input type="hidden" name="templateLineId" value={line.templateLineId} />
                            <Button variant="plain" submit loading={isSubmitting}>Reset</Button>
                          </fetcher.Form>
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
                  {config && config.materialLines.length > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {config.materialLines.length}
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
            {!config || config.materialLines.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">No variant-only material lines.</Text>
            ) : (
              <BlockStack gap="300">
                {config.materialLines.map((line: SerializedMaterialLine) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.materialName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">{describeMaterialLine(line)}</Text>
                    </BlockStack>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="remove-material-line" />
                      <input type="hidden" name="lineId" value={line.id} />
                      <Button variant="plain" tone="critical" submit loading={isSubmitting}>Remove</Button>
                    </fetcher.Form>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {config?.templateId && (
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Template Equipment Lines</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Override assigned template equipment values per variant.
                </Text>
              </BlockStack>
              <Divider />
              {config.templateEquipmentLines.length === 0 ? (
                <Text as="p" variant="bodyMd" tone="subdued">This template has no equipment lines.</Text>
              ) : (
                <BlockStack gap="300">
                  {config.templateEquipmentLines.map((line: TemplateEquipmentOverrideLine) => (
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
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="reset-equipment-override" />
                            <input type="hidden" name="templateLineId" value={line.templateLineId} />
                            <Button variant="plain" submit loading={isSubmitting}>Reset</Button>
                          </fetcher.Form>
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
                  {config && config.equipmentLines.length > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {config.equipmentLines.length}
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
            {!config || config.equipmentLines.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">No variant-only equipment lines.</Text>
            ) : (
              <BlockStack gap="300">
                {config.equipmentLines.map((line: SerializedEquipmentLine) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.equipmentName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">{describeEquipmentLine(line)}</Text>
                    </BlockStack>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="remove-equipment-line" />
                      <input type="hidden" name="lineId" value={line.id} />
                      <Button variant="plain" tone="critical" submit loading={isSubmitting}>Remove</Button>
                    </fetcher.Form>
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
              <Button onClick={refreshPreview} loading={isSubmitting}>Refresh</Button>
            </InlineStack>
            <Divider />
            {!preview ? (
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
          content: "Assign",
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", "assign-template");
            fd.append("templateId", selectedTemplateId);
            fetcher.submit(fd, { method: "post" });
            setAssignTemplateOpen(false);
          },
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
          loading: isSubmitting,
          onAction: () => {
            if (!materialOverrideTarget) return;
            const fd = new FormData();
            fd.append("intent", "save-material-override");
            fd.append("templateLineId", materialOverrideTarget.templateLineId);
            fd.append("materialId", materialOverrideTarget.materialId);
            fd.append("quantity", overrideMatQty);
            if (materialOverrideTarget.costingModel === "yield" && overrideMatYield) fd.append("yield", overrideMatYield);
            if (materialOverrideTarget.costingModel === "uses" && overrideMatUses) fd.append("usesPerVariant", overrideMatUses);
            fetcher.submit(fd, { method: "post" });
            closeMaterialOverride();
          },
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
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", "add-material-line");
            fd.append("materialId", selectedMaterialId);
            if (selectedMaterial?.costingModel === "yield" && matYield) {
              fd.append("quantity", matQty);
              fd.append("yield", matYield);
            }
            if (selectedMaterial?.costingModel === "uses" && matUses) {
              fd.append("usesPerVariant", matUses);
            }
            fetcher.submit(fd, { method: "post" });
            setAddMaterialOpen(false);
            resetAdditionalMaterialModal();
          },
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
          loading: isSubmitting,
          onAction: () => {
            if (!equipmentOverrideTarget) return;
            const fd = new FormData();
            fd.append("intent", "save-equipment-override");
            fd.append("templateLineId", equipmentOverrideTarget.templateLineId);
            fd.append("equipmentId", equipmentOverrideTarget.equipmentId);
            if (overrideEqMinutes) fd.append("minutes", overrideEqMinutes);
            if (overrideEqUses) fd.append("uses", overrideEqUses);
            fetcher.submit(fd, { method: "post" });
            closeEquipmentOverride();
          },
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
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", "add-equipment-line");
            fd.append("equipmentId", selectedEquipmentId);
            if (eqMinutes) fd.append("minutes", eqMinutes);
            if (eqUses) fd.append("uses", eqUses);
            fetcher.submit(fd, { method: "post" });
            setAddEquipmentOpen(false);
            resetAdditionalEquipmentModal();
          },
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
