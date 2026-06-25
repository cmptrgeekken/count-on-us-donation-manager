import { jsonResponse } from "~/utils/json-response.server";
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator, useRouteError } from "@remix-run/react";
import {
  Autocomplete,
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  EmptyState,
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
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import {
  parseOptionalNonNegativeNumber,
  parseOptionalNonNegativeWholeNumber,
  parseOptionalPositiveNumber,
  parseOptionalPositiveWholeNumber,
  parseRequiredNonNegativeWholeNumber,
} from "../utils/number-parsing";
import { useAppLocalization } from "../utils/use-app-localization";
import { useUnsavedChangesGuard } from "../utils/use-unsaved-changes-guard";
import {
  cloneDraft,
  createClientId,
  normalizeTemplateDraft,
  type TemplateDraft,
  type TemplateDraftEquipmentLine,
  type TemplateDraftMaterialLine,
} from "../utils/staged-editor";

const templateDraftSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  description: z.string(),
  defaultShippingTemplateId: z.string().nullable().optional(),
  materialLines: z.array(z.object({
    id: z.string(),
    materialId: z.string().min(1),
    quantity: z.string(),
    yield: z.string().nullable(),
    usesPerVariant: z.string().nullable(),
  })),
  equipmentLines: z.array(z.object({
    id: z.string(),
    equipmentId: z.string().min(1),
    usageMode: z.string().nullable().optional(),
    minutes: z.string().nullable(),
    uses: z.string().nullable(),
    yieldDurationMinutes: z.string().nullable().optional(),
    yieldUses: z.string().nullable().optional(),
    yieldQuantity: z.string().nullable().optional(),
  })),
});

function serializeTemplate(template: {
  id: string;
  name: string;
  type: string;
  defaultShippingTemplateId: string | null;
  description: string | null;
  status: string;
  materialLines: Array<{
    id: string;
    materialId: string;
    material: { name: string; type: string; costingModel: string | null; perUnitCost: { toString(): string } };
    yield: { toString(): string } | null;
    quantity: { toString(): string };
    usesPerVariant: { toString(): string } | null;
  }>;
  equipmentLines: Array<{
    id: string;
    equipmentId: string;
    equipment: { name: string; hourlyRate: { toString(): string } | null; perUseCost: { toString(): string } | null };
    usageMode: string;
    minutes: { toString(): string } | null;
    uses: { toString(): string } | null;
    yieldDurationMinutes: { toString(): string } | null;
    yieldUses: { toString(): string } | null;
    yieldQuantity: { toString(): string } | null;
  }>;
}) {
  return {
    id: template.id,
    name: template.name,
    type: template.type,
    defaultShippingTemplateId: template.defaultShippingTemplateId,
    description: template.description ?? "",
    status: template.status,
    materialLines: template.materialLines.map((line) => ({
      id: line.id,
      materialId: line.materialId,
      materialName: line.material.name,
      materialType: line.material.type,
      costingModel: line.material.costingModel,
      perUnitCost: line.material.perUnitCost.toString(),
      quantity: line.quantity.toString(),
      yield: line.yield?.toString() ?? null,
      usesPerVariant: line.usesPerVariant?.toString() ?? null,
    })),
    equipmentLines: template.equipmentLines.map((line) => ({
      id: line.id,
      equipmentId: line.equipmentId,
      equipmentName: line.equipment.name,
      hourlyRate: line.equipment.hourlyRate?.toString() ?? null,
      perUseCost: line.equipment.perUseCost?.toString() ?? null,
      usageMode: line.usageMode ?? "direct",
      minutes: line.minutes?.toString() ?? null,
      uses: line.uses?.toString() ?? null,
      yieldDurationMinutes: line.yieldDurationMinutes?.toString() ?? null,
      yieldUses: line.yieldUses?.toString() ?? null,
      yieldQuantity: line.yieldQuantity?.toString() ?? null,
    })),
  };
}

function buildTemplateDraft(template: ReturnType<typeof serializeTemplate>): TemplateDraft {
  return {
    name: template.name,
    description: template.description,
    defaultShippingTemplateId: template.defaultShippingTemplateId,
    materialLines: cloneDraft(template.materialLines),
    equipmentLines: cloneDraft(template.equipmentLines),
  };
}

function sortTemplateMaterialLines(lines: TemplateDraftMaterialLine[]) {
  return [...lines].sort((a, b) => a.materialName.localeCompare(b.materialName));
}

function sortTemplateEquipmentLines(lines: TemplateDraftEquipmentLine[]) {
  return [...lines].sort((a, b) => a.equipmentName.localeCompare(b.equipmentName));
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const templateId = params.templateId ?? "";

  const template = await prisma.costTemplate.findFirst({
    where: { id: templateId, shopId },
    include: {
      materialLines: { include: { material: true }, orderBy: { material: { name: "asc" } } },
      equipmentLines: { include: { equipment: true }, orderBy: { equipment: { name: "asc" } } },
    },
  });

  if (!template) {
    throw new Response("Not found", { status: 404 });
  }

  const [materials, equipment, shippingTemplates] = await Promise.all([
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
    prisma.costTemplate.findMany({
      where: {
        shopId,
        status: "active",
        type: "shipping",
        id: { not: templateId },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return jsonResponse({
    template: serializeTemplate(template),
    availableMaterials: materials.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      costingModel: item.costingModel,
      perUnitCost: item.perUnitCost.toString(),
      totalUsesPerUnit: item.totalUsesPerUnit?.toString() ?? null,
    })),
    availableEquipment: equipment.map((item) => ({
      id: item.id,
      name: item.name,
      hourlyRate: item.hourlyRate?.toString() ?? null,
      perUseCost: item.perUseCost?.toString() ?? null,
    })),
    availableShippingTemplates: shippingTemplates,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const templateId = params.templateId ?? "";

  const template = await prisma.costTemplate.findFirst({
    where: { id: templateId, shopId },
    include: {
      materialLines: { select: { id: true, materialId: true } },
      equipmentLines: { select: { id: true, equipmentId: true } },
    },
  });

  if (!template) {
    return jsonResponse({ ok: false, message: "Not found." }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent !== "save-template-draft") {
    return jsonResponse({ ok: false, message: "Unknown action." }, { status: 400 });
  }

  const rawDraft = formData.get("draft")?.toString();
  if (!rawDraft) {
    return jsonResponse({ ok: false, message: "Draft data is required." }, { status: 400 });
  }

  const parsedDraft = templateDraftSchema.safeParse(JSON.parse(rawDraft));
  if (!parsedDraft.success) {
    return jsonResponse(
      { ok: false, message: parsedDraft.error.issues[0]?.message ?? "Invalid template data." },
      { status: 400 },
    );
  }

  const draft = parsedDraft.data;
  const normalizedDefaultShippingTemplateId = draft.defaultShippingTemplateId?.trim() || null;
  const existingMaterialLines = new Map(template.materialLines.map((line) => [line.id, line]));
  const existingEquipmentLines = new Map(template.equipmentLines.map((line) => [line.id, line]));

  if (template.type === "shipping" && normalizedDefaultShippingTemplateId) {
    return jsonResponse(
      { ok: false, message: "Shipping templates cannot define a default shipping template." },
      { status: 400 },
    );
  }

  if (normalizedDefaultShippingTemplateId) {
    const shippingTemplate = await prisma.costTemplate.findFirst({
      where: { id: normalizedDefaultShippingTemplateId, shopId },
      select: { id: true, type: true },
    });

    if (!shippingTemplate) {
      return jsonResponse({ ok: false, message: "Default shipping template not found." }, { status: 404 });
    }

    if (shippingTemplate.type !== "shipping") {
      return jsonResponse(
        { ok: false, message: "Default shipping template must reference a shipping template." },
        { status: 400 },
      );
    }
  }

  const materialIds = draft.materialLines.map((line) => line.materialId);
  if (new Set(materialIds).size !== materialIds.length) {
    return jsonResponse({ ok: false, message: "Each material can only appear once in a template." }, { status: 400 });
  }

  const equipmentIds = draft.equipmentLines.map((line) => line.equipmentId);
  if (new Set(equipmentIds).size !== equipmentIds.length) {
    return jsonResponse({ ok: false, message: "Each equipment item can only appear once in a template." }, { status: 400 });
  }

  for (const line of draft.materialLines) {
    if (existingMaterialLines.has(line.id) && existingMaterialLines.get(line.id)?.materialId !== line.materialId) {
      return jsonResponse({ ok: false, message: "Existing material lines cannot change their material." }, { status: 400 });
    }
  }

  for (const line of draft.equipmentLines) {
    if (existingEquipmentLines.has(line.id) && existingEquipmentLines.get(line.id)?.equipmentId !== line.equipmentId) {
      return jsonResponse({ ok: false, message: "Existing equipment lines cannot change their equipment." }, { status: 400 });
    }
  }

  const newMaterialIds = [...new Set(draft.materialLines.filter((line) => !existingMaterialLines.has(line.id)).map((line) => line.materialId))];
  const newEquipmentIds = [...new Set(draft.equipmentLines.filter((line) => !existingEquipmentLines.has(line.id)).map((line) => line.equipmentId))];

  const [materialRecords, equipmentRecords] = await Promise.all([
    prisma.materialLibraryItem.findMany({ where: { id: { in: newMaterialIds }, shopId }, select: { id: true } }),
    prisma.equipmentLibraryItem.findMany({ where: { id: { in: newEquipmentIds }, shopId }, select: { id: true } }),
  ]);

  if (materialRecords.length !== newMaterialIds.length) {
    return jsonResponse({ ok: false, message: "One or more materials could not be found." }, { status: 404 });
  }

  if (equipmentRecords.length !== newEquipmentIds.length) {
    return jsonResponse({ ok: false, message: "One or more equipment items could not be found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.costTemplate.updateMany({
      where: { id: templateId, shopId },
      data: {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        defaultShippingTemplateId: template.type === "production" ? normalizedDefaultShippingTemplateId : null,
      },
    });
    
    const incomingMaterialIds = new Set(draft.materialLines.map((line) => line.id));
    const incomingEquipmentIds = new Set(draft.equipmentLines.map((line) => line.id));

    const removedMaterialLineIds = template.materialLines
      .map((line) => line.id)
      .filter((lineId) => !incomingMaterialIds.has(lineId));
    const removedEquipmentLineIds = template.equipmentLines
      .map((line) => line.id)
      .filter((lineId) => !incomingEquipmentIds.has(lineId));

    if (removedMaterialLineIds.length > 0) {
      await tx.costTemplateMaterialLine.deleteMany({
        where: { id: { in: removedMaterialLineIds }, templateId },
      });
    }

    if (removedEquipmentLineIds.length > 0) {
      await tx.costTemplateEquipmentLine.deleteMany({
        where: { id: { in: removedEquipmentLineIds }, templateId },
      });
    }

    for (const line of draft.materialLines) {
      const data = {
        quantity: parseRequiredNonNegativeWholeNumber(line.quantity, "Material quantity"),
        yield: parseOptionalNonNegativeWholeNumber(line.yield, "Items made from one purchased unit"),
        usesPerVariant: parseOptionalNonNegativeWholeNumber(line.usesPerVariant, "Portions used per item"),
      };

      if (existingMaterialLines.has(line.id)) {
        await tx.costTemplateMaterialLine.update({
          where: { id: line.id },
          data,
        });
      } else {
        await tx.costTemplateMaterialLine.create({
          data: {
            templateId,
            materialId: line.materialId,
            ...data,
          },
        });
      }
    }

    for (const line of draft.equipmentLines) {
      const usageMode = line.usageMode || "direct";
      const data = {
        usageMode,
        minutes: usageMode === "direct" ? parseOptionalNonNegativeNumber(line.minutes, "Equipment minutes") : null,
        uses: usageMode === "direct" ? parseOptionalNonNegativeWholeNumber(line.uses, "Equipment uses") : null,
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

      if (existingEquipmentLines.has(line.id)) {
        await tx.costTemplateEquipmentLine.update({
          where: { id: line.id },
          data,
        });
      } else {
        await tx.costTemplateEquipmentLine.create({
          data: {
            templateId,
            equipmentId: line.equipmentId,
            ...data,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "CostTemplate",
        entityId: templateId,
        action: "TEMPLATE_UPDATED",
        actor: "merchant",
      },
    });
  });

  return jsonResponse({
    ok: true,
    message: "Template saved.",
    savedAt: new Date().toISOString(),
  });
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
  hourlyRate: string | null;
  perUseCost: string | null;
};

function serializeDraft(draft: TemplateDraft) {
  return JSON.stringify(normalizeTemplateDraft(draft));
}

function describeMaterialLine(line: TemplateDraftMaterialLine) {
  if (line.costingModel === "counted") {
    return `Counted parts: ${line.quantity} per item`;
  }

  if (line.costingModel === "yield") {
    return `Variable yield: ${line.quantity} purchased unit(s), ${line.yield ?? "-"} items per purchased unit`;
  }

  if (line.costingModel === "uses") {
    return `Portioned use: ${line.usesPerVariant ?? "-"} portion(s) per item`;
  }

  return `Qty: ${line.quantity}`;
}

function describeEquipmentLine(line: TemplateDraftEquipmentLine) {
  if (line.usageMode === "duration_yield") {
    return `${line.yieldDurationMinutes ?? "-"} min yields ${line.yieldQuantity ?? "-"} products`;
  }
  if (line.usageMode === "use_yield") {
    return `${line.yieldUses ?? "-"} uses yields ${line.yieldQuantity ?? "-"} products`;
  }
  return [line.minutes ? `${line.minutes} min` : null, line.uses ? `${line.uses} uses` : null]
    .filter(Boolean)
    .join(" | ");
}

export default function TemplateDetailPage() {
  const { template, availableMaterials, availableEquipment, availableShippingTemplates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string; savedAt?: string }>();
  const revalidator = useRevalidator();
  const { formatMoney } = useAppLocalization();

  const [baseDraft, setBaseDraft] = useState(() => buildTemplateDraft(template));
  const [draft, setDraft] = useState(() => buildTemplateDraft(template));

  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [editingMaterialLineId, setEditingMaterialLineId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [materialSearchValue, setMaterialSearchValue] = useState("");
  const [matQty, setMatQty] = useState("1");
  const [matYield, setMatYield] = useState("1");
  const [matUses, setMatUses] = useState("");

  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false);
  const [editingEquipmentLineId, setEditingEquipmentLineId] = useState<string | null>(null);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [equipmentSearchValue, setEquipmentSearchValue] = useState("");
  const [eqUsageMode, setEqUsageMode] = useState("direct");
  const [eqMinutes, setEqMinutes] = useState("");
  const [eqUses, setEqUses] = useState("");
  const [eqYieldDurationMinutes, setEqYieldDurationMinutes] = useState("");
  const [eqYieldUses, setEqYieldUses] = useState("");
  const [eqYieldQuantity, setEqYieldQuantity] = useState("");

  const handledSaveRef = useRef<string | null>(null);

  const isSaving = fetcher.state !== "idle";
  const isDirty = serializeDraft(draft) !== serializeDraft(baseDraft);
  const { confirmThenNavigate } = useUnsavedChangesGuard(isDirty);
  const selectedMaterial = availableMaterials.find((item: AvailableMaterial) => item.id === selectedMaterialId);

  useEffect(() => {
    if (!fetcher.data?.ok || !fetcher.data.savedAt || fetcher.data.savedAt === handledSaveRef.current) return;
    handledSaveRef.current = fetcher.data.savedAt;
    const committedDraft = cloneDraft(draft);
    setBaseDraft(committedDraft);
    setDraft(committedDraft);
    revalidator.revalidate();
  }, [draft, fetcher.data, revalidator]);

  function resetMaterialModal() {
    setEditingMaterialLineId(null);
    setSelectedMaterialId("");
    setMaterialSearchValue("");
    setMatQty("1");
    setMatYield("1");
    setMatUses("");
  }

  function closeMaterialModal() {
    setMaterialModalOpen(false);
    resetMaterialModal();
  }

  function resetEquipmentModal() {
    setEditingEquipmentLineId(null);
    setSelectedEquipmentId("");
    setEquipmentSearchValue("");
    setEqUsageMode("direct");
    setEqMinutes("");
    setEqUses("");
    setEqYieldDurationMinutes("");
    setEqYieldUses("");
    setEqYieldQuantity("");
  }

  function closeEquipmentModal() {
    setEquipmentModalOpen(false);
    resetEquipmentModal();
  }

  function discardChanges() {
    setDraft(cloneDraft(baseDraft));
    closeMaterialModal();
    closeEquipmentModal();
  }

  function saveDraft() {
    const formData = new FormData();
    formData.append("intent", "save-template-draft");
    formData.append("draft", JSON.stringify(normalizeTemplateDraft(draft)));
    fetcher.submit(formData, { method: "post" });
  }

  function openAddMaterialModal() {
    resetMaterialModal();
    setMaterialModalOpen(true);
  }

  function openEditMaterialModal(line: TemplateDraftMaterialLine) {
    setEditingMaterialLineId(line.id);
    setSelectedMaterialId(line.materialId);
    setMaterialSearchValue(line.materialName);
    setMatQty(line.quantity);
    setMatYield(line.yield ?? "");
    setMatUses(line.usesPerVariant ?? "");
    setMaterialModalOpen(true);
  }

  function commitMaterialModal() {
    if (!selectedMaterial) return;

    const nextLine: TemplateDraftMaterialLine = {
      id: editingMaterialLineId ?? createClientId("draft-material"),
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
      materialLines: editingMaterialLineId
        ? sortTemplateMaterialLines(current.materialLines.map((line) => (line.id === editingMaterialLineId ? nextLine : line)))
        : sortTemplateMaterialLines([...current.materialLines, nextLine]),
    }));
    closeMaterialModal();
  }

  function removeMaterialLine(lineId: string) {
    setDraft((current) => ({
      ...current,
      materialLines: current.materialLines.filter((line) => line.id !== lineId),
    }));
  }

  function openAddEquipmentModal() {
    resetEquipmentModal();
    setEquipmentModalOpen(true);
  }

  function openEditEquipmentModal(line: TemplateDraftEquipmentLine) {
    setEditingEquipmentLineId(line.id);
    setSelectedEquipmentId(line.equipmentId);
    setEquipmentSearchValue(line.equipmentName);
    setEqUsageMode(line.usageMode ?? "direct");
    setEqMinutes(line.minutes ?? "");
    setEqUses(line.uses ?? "");
    setEqYieldDurationMinutes(line.yieldDurationMinutes ?? "");
    setEqYieldUses(line.yieldUses ?? "");
    setEqYieldQuantity(line.yieldQuantity ?? "");
    setEquipmentModalOpen(true);
  }

  function commitEquipmentModal() {
    const selectedEquipment = availableEquipment.find((item: AvailableEquipment) => item.id === selectedEquipmentId);
    if (!selectedEquipment) return;

    const nextLine: TemplateDraftEquipmentLine = {
      id: editingEquipmentLineId ?? createClientId("draft-equipment"),
      equipmentId: selectedEquipment.id,
      equipmentName: selectedEquipment.name,
      hourlyRate: selectedEquipment.hourlyRate,
      perUseCost: selectedEquipment.perUseCost,
      usageMode: eqUsageMode,
      minutes: eqUsageMode === "direct" ? (eqMinutes || null) : null,
      uses: eqUsageMode === "direct" ? (eqUses || null) : null,
      yieldDurationMinutes: eqUsageMode === "duration_yield" ? (eqYieldDurationMinutes || null) : null,
      yieldUses: eqUsageMode === "use_yield" ? (eqYieldUses || null) : null,
      yieldQuantity: eqUsageMode !== "direct" ? (eqYieldQuantity || null) : null,
    };

    setDraft((current) => ({
      ...current,
      equipmentLines: editingEquipmentLineId
        ? sortTemplateEquipmentLines(current.equipmentLines.map((line) => (line.id === editingEquipmentLineId ? nextLine : line)))
        : sortTemplateEquipmentLines([...current.equipmentLines, nextLine]),
    }));
    closeEquipmentModal();
  }

  function removeEquipmentLine(lineId: string) {
    setDraft((current) => ({
      ...current,
      equipmentLines: current.equipmentLines.filter((line) => line.id !== lineId),
    }));
  }

  function previewMaterialLineCost() {
    if (!selectedMaterial) return null;
    const quantity = Number(matQty);
    if (Number.isNaN(quantity) || quantity <= 0) return null;

    if (selectedMaterial.costingModel === "yield") {
      const yieldValue = Number(matYield);
      if (Number.isNaN(yieldValue) || yieldValue <= 0) return null;
      return formatMoney((Number(selectedMaterial.perUnitCost) / yieldValue) * quantity);
    }

    if (selectedMaterial.costingModel === "counted") {
      const quantity = Number(matQty);
      if (Number.isNaN(quantity) || quantity <= 0) return null;
      return formatMoney(Number(selectedMaterial.perUnitCost) * quantity);
    }

    if (selectedMaterial.costingModel === "uses") {
      const uses = Number(matUses);
      const totalUses = Number(selectedMaterial.totalUsesPerUnit);
      if (Number.isNaN(uses) || uses <= 0 || Number.isNaN(totalUses) || totalUses <= 0) return null;
      return formatMoney((Number(selectedMaterial.perUnitCost) / totalUses) * uses);
    }

    return null;
  }

  function previewEquipmentLineCost() {
    const equipment = availableEquipment.find((item: AvailableEquipment) => item.id === selectedEquipmentId);
    if (!equipment) return null;

    let cost = 0;
    if (eqUsageMode === "duration_yield") {
      const duration = Number(eqYieldDurationMinutes);
      const quantity = Number(eqYieldQuantity);
      if (equipment.hourlyRate && duration > 0 && quantity > 0) {
        return formatMoney(((Number(equipment.hourlyRate) * duration) / 60) / quantity);
      }
      return null;
    }
    if (eqUsageMode === "use_yield") {
      const uses = Number(eqYieldUses);
      const quantity = Number(eqYieldQuantity);
      if (equipment.perUseCost && uses > 0 && quantity > 0) {
        return formatMoney((Number(equipment.perUseCost) * uses) / quantity);
      }
      return null;
    }
    if (equipment.hourlyRate && eqMinutes) {
      cost += (Number(equipment.hourlyRate) * Number(eqMinutes)) / 60;
    }
    if (equipment.perUseCost && eqUses) {
      cost += Number(equipment.perUseCost) * Number(eqUses);
    }
    return cost > 0 ? formatMoney(cost) : null;
  }

  const unavailableMaterialIds = new Set(
    draft.materialLines
      .filter((line) => line.id !== editingMaterialLineId)
      .map((line) => line.materialId),
  );
  const unavailableEquipmentIds = new Set(
    draft.equipmentLines
      .filter((line) => line.id !== editingEquipmentLineId)
      .map((line) => line.equipmentId),
  );

  const selectableMaterials = availableMaterials.filter((item: AvailableMaterial) => item.type === template.type);

  const filteredMaterialOptions = availableMaterials
    .filter((item: AvailableMaterial) => item.type === template.type)
    .filter((item: AvailableMaterial) => !unavailableMaterialIds.has(item.id))
    .filter((item: AvailableMaterial) =>
      item.name.toLowerCase().includes(materialSearchValue.trim().toLowerCase()),
    )
    .map((item: AvailableMaterial) => ({ value: item.id, label: item.name }));

  const filteredEquipmentOptions = availableEquipment
    .filter((item: AvailableEquipment) => !unavailableEquipmentIds.has(item.id))
    .filter((item: AvailableEquipment) =>
      item.name.toLowerCase().includes(equipmentSearchValue.trim().toLowerCase()),
    )
    .map((item: AvailableEquipment) => ({ value: item.id, label: item.name }));

  return (
    <Page
      backAction={{ content: "Templates", onAction: () => void confirmThenNavigate("/app/templates") }}
      title={draft.name || template.name}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone={template.type === "shipping" ? "info" : "success"}>
            {template.type === "shipping" ? "Shipping" : "Production"}
          </Badge>
          <Badge tone={template.status === "active" ? "success" : "enabled"}>
            {template.status === "active" ? "Active" : "Inactive"}
          </Badge>
        </InlineStack>
      }
    >
      <TitleBar title={draft.name || template.name} />
      <AppSaveBar
        open={isDirty}
        onSave={saveDraft}
        onDiscard={discardChanges}
        saveDisabled={draft.name.trim().length === 0}
        loading={isSaving}
      />

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {fetcher.data?.message ?? ""}
      </div>

      <BlockStack gap="600">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Details</Text>
            <Divider />
            <TextField
              label="Name"
              value={draft.name}
              onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
              autoComplete="off"
            />
            <TextField
              label="Description"
              value={draft.description}
              onChange={(value) => setDraft((current) => ({ ...current, description: value }))}
              multiline={2}
              autoComplete="off"
            />
            {template.type === "production" && (
              <BlockStack gap="200">
                <Select
                  label="Default shipping template"
                  value={draft.defaultShippingTemplateId ?? ""}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, defaultShippingTemplateId: value || null }))
                  }
                  options={[
                    { label: "None", value: "" },
                    ...availableShippingTemplates.map((shippingTemplate: { id: string; name: string }) => ({
                      label: shippingTemplate.name,
                      value: shippingTemplate.id,
                    })),
                  ]}
                />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Variants using this Production template will inherit this Shipping template unless they set an explicit Shipping override.
                </Text>
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Materials</Text>
              <Button onClick={openAddMaterialModal} disabled={selectableMaterials.length === 0}>
                Add material
              </Button>
            </InlineStack>
            <Divider />
            {draft.materialLines.length === 0 ? (
              <EmptyState
                heading="No materials"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                fullWidth
              >
                <Text as="p" variant="bodyMd" tone="subdued">
                  {template.type === "shipping"
                    ? "Add shipping materials to this template."
                    : "Add production materials to this template."}
                </Text>
              </EmptyState>
            ) : (
              <BlockStack gap="300">
                {draft.materialLines.map((line) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.materialName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">{describeMaterialLine(line)}</Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button variant="plain" onClick={() => openEditMaterialModal(line)}>
                        Edit
                      </Button>
                      <Button variant="plain" tone="critical" onClick={() => removeMaterialLine(line.id)}>
                        Remove
                      </Button>
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Equipment</Text>
              <Button onClick={openAddEquipmentModal} disabled={availableEquipment.length === 0}>
                Add equipment
              </Button>
            </InlineStack>
            <Divider />
            {draft.equipmentLines.length === 0 ? (
              <EmptyState
                heading="No equipment"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                fullWidth
              >
                <Text as="p" variant="bodyMd" tone="subdued">
                  Add equipment to include machine time costs in this template.
                </Text>
              </EmptyState>
            ) : (
              <BlockStack gap="300">
                {draft.equipmentLines.map((line) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.equipmentName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">{describeEquipmentLine(line)}</Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button variant="plain" onClick={() => openEditEquipmentModal(line)}>
                        Edit
                      </Button>
                      <Button variant="plain" tone="critical" onClick={() => removeEquipmentLine(line.id)}>
                        Remove
                      </Button>
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={materialModalOpen}
        onClose={closeMaterialModal}
        title={editingMaterialLineId ? "Edit material line" : "Add material"}
        primaryAction={{
          content: editingMaterialLineId ? "Apply" : "Add",
          disabled: !selectedMaterialId,
          loading: isSaving,
          onAction: commitMaterialModal,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeMaterialModal }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {editingMaterialLineId ? (
              <TextField label="Material" value={selectedMaterial?.name ?? ""} autoComplete="off" disabled />
            ) : (
              <Autocomplete
                options={filteredMaterialOptions}
                selected={selectedMaterialId ? [selectedMaterialId] : []}
                onSelect={(selected) => {
                  const nextId = selected[0] ?? "";
                  const nextMaterial = availableMaterials.find((item: AvailableMaterial) => item.id === nextId);
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
                    No materials match that search.
                  </Text>
                }
              />
            )}
            {selectedMaterial?.costingModel === "counted" && (
              <TextField
                label="Quantity used per item"
                type="number"
                min={0}
                step={1}
                value={matQty}
                onChange={setMatQty}
                autoComplete="off"
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
                />
                <TextField
                  label="Items made from one purchased unit"
                  type="number"
                  min={0}
                  step={1}
                  value={matYield}
                  onChange={setMatYield}
                  autoComplete="off"
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
              />
            )}
            {previewMaterialLineCost() && (
              <Text as="p" variant="bodyMd" tone="subdued">
                Estimated line cost: <strong>{previewMaterialLineCost()}</strong>
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={equipmentModalOpen}
        onClose={closeEquipmentModal}
        title={editingEquipmentLineId ? "Edit equipment line" : "Add equipment"}
        primaryAction={{
          content: editingEquipmentLineId ? "Apply" : "Add",
          disabled: !selectedEquipmentId,
          loading: isSaving,
          onAction: commitEquipmentModal,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeEquipmentModal }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {editingEquipmentLineId ? (
              <TextField
                label="Equipment"
                value={availableEquipment.find((item: AvailableEquipment) => item.id === selectedEquipmentId)?.name ?? ""}
                autoComplete="off"
                disabled
              />
            ) : (
              <Autocomplete
                options={filteredEquipmentOptions}
                selected={selectedEquipmentId ? [selectedEquipmentId] : []}
                onSelect={(selected) => {
                  const nextId = selected[0] ?? "";
                  const nextEquipment = availableEquipment.find((item: AvailableEquipment) => item.id === nextId);
                  setSelectedEquipmentId(nextId);
                  setEquipmentSearchValue(nextEquipment?.name ?? "");
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
                    No equipment matches that search.
                  </Text>
                }
              />
            )}
            <Select
              label="Usage mode"
              value={eqUsageMode}
              onChange={setEqUsageMode}
              options={[
                { label: "Direct minutes / uses", value: "direct" },
                { label: "Duration yield", value: "duration_yield" },
                { label: "Use yield", value: "use_yield" },
              ]}
            />
            {eqUsageMode === "direct" && (
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
                    helpText="Time on equipment per variant."
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
                    helpText="Per-use charges per variant."
                  />
                </div>
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
                    helpText="Total machine time for the run or batch."
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
            {previewEquipmentLineCost() && (
              <Text as="p" variant="bodyMd" tone="subdued">
                Estimated line cost: <strong>{previewEquipmentLineCost()}</strong>
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[TemplateDetail] ErrorBoundary caught:", error);
  return (
    <Page>
      <TitleBar title="Cost Template" />
      <Banner tone="critical">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="bold">Something went wrong loading this template.</Text>
          <Text as="p" variant="bodyMd">Please refresh the page. If the problem persists, contact support.</Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
