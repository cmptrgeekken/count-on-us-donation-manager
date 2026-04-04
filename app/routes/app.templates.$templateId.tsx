import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError } from "@remix-run/react";
import {
  Page,
  Card,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Modal,
  TextField,
  Autocomplete,
  Divider,
  EmptyState,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { useAppLocalization } from "../utils/use-app-localization";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const { templateId } = params;

  const template = await prisma.costTemplate.findFirst({
    where: { id: templateId, shopId },
    include: {
      materialLines: { include: { material: true } },
      equipmentLines: { include: { equipment: true } },
    },
  });

  if (!template || template.shopId !== shopId) {
    throw new Response("Not found", { status: 404 });
  }

  const [materials, equipment] = await Promise.all([
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

  return Response.json({
    template: {
      id: template.id,
      name: template.name,
      description: template.description ?? "",
      status: template.status,
      materialLines: template.materialLines.map((l) => ({
        id: l.id,
        materialId: l.materialId,
        materialName: l.material.name,
        materialType: l.material.type,
        costingModel: l.material.costingModel,
        perUnitCost: l.material.perUnitCost.toString(),
        yield: l.yield?.toString() ?? null,
        quantity: l.quantity.toString(),
        usesPerVariant: l.usesPerVariant?.toString() ?? null,
      })),
      equipmentLines: template.equipmentLines.map((l) => ({
        id: l.id,
        equipmentId: l.equipmentId,
        equipmentName: l.equipment.name,
        hourlyRate: l.equipment.hourlyRate?.toString() ?? null,
        perUseCost: l.equipment.perUseCost?.toString() ?? null,
        minutes: l.minutes?.toString() ?? null,
        uses: l.uses?.toString() ?? null,
      })),
    },
    availableMaterials: materials.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      costingModel: m.costingModel,
      perUnitCost: m.perUnitCost.toString(),
      totalUsesPerUnit: m.totalUsesPerUnit?.toString() ?? null,
    })),
    availableEquipment: equipment.map((e) => ({
      id: e.id,
      name: e.name,
      hourlyRate: e.hourlyRate?.toString() ?? null,
      perUseCost: e.perUseCost?.toString() ?? null,
    })),
  });
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const templateId = params.templateId ?? "";

  const template = await prisma.costTemplate.findFirst({ where: { id: templateId, shopId }, select: { shopId: true } });
  if (!template) {
    return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

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

  async function requireMaterialLine(lineId: string) {
    const line = await prisma.costTemplateMaterialLine.findFirst({
      where: { id: lineId, templateId },
      select: { id: true, materialId: true },
    });
    if (!line) {
      throw new Response("Not found", { status: 404 });
    }
    return line;
  }

  async function requireEquipmentLine(lineId: string) {
    const line = await prisma.costTemplateEquipmentLine.findFirst({
      where: { id: lineId, templateId },
      select: { id: true, equipmentId: true },
    });
    if (!line) {
      throw new Response("Not found", { status: 404 });
    }
    return line;
  }

  async function ensureMaterialNotAlreadyAdded(materialId: string, currentLineId?: string) {
    const existingLine = await prisma.costTemplateMaterialLine.findFirst({
      where: {
        templateId,
        materialId,
        ...(currentLineId ? { NOT: { id: currentLineId } } : {}),
      },
      select: { id: true },
    });

    if (existingLine) {
      return Response.json({ ok: false, message: "That material is already included in this template." }, { status: 400 });
    }

    return null;
  }

  async function ensureEquipmentNotAlreadyAdded(equipmentId: string, currentLineId?: string) {
    const existingLine = await prisma.costTemplateEquipmentLine.findFirst({
      where: {
        templateId,
        equipmentId,
        ...(currentLineId ? { NOT: { id: currentLineId } } : {}),
      },
      select: { id: true },
    });

    if (existingLine) {
      return Response.json({ ok: false, message: "That equipment item is already included in this template." }, { status: 400 });
    }

    return null;
  }

  if (intent === "update-meta") {
    const name = formData.get("name")?.toString().trim() ?? "";
    const description = formData.get("description")?.toString().trim() || null;
    if (!name) return Response.json({ ok: false, message: "Name is required." }, { status: 400 });
    await prisma.costTemplate.updateMany({ where: { id: templateId, shopId }, data: { name, description } });
    await prisma.auditLog.create({
      data: { shopId, entity: "CostTemplate", entityId: templateId, action: "TEMPLATE_UPDATED", actor: "merchant" },
    });
    return Response.json({ ok: true, message: "Template saved." });
  }

  if (intent === "add-material-line") {
    const materialId = formData.get("materialId")?.toString() ?? "";
    const quantity = parseFloat(formData.get("quantity")?.toString() ?? "1");
    const yieldVal = formData.get("yield")?.toString();
    const usesPerVariant = formData.get("usesPerVariant")?.toString();

    await requireMaterial(materialId);
    const duplicateMaterialResponse = await ensureMaterialNotAlreadyAdded(materialId);
    if (duplicateMaterialResponse) return duplicateMaterialResponse;

    await prisma.costTemplateMaterialLine.create({
      data: {
        templateId,
        materialId,
        quantity,
        yield: yieldVal ? parseFloat(yieldVal) : null,
        usesPerVariant: usesPerVariant ? parseFloat(usesPerVariant) : null,
      },
    });
    await prisma.auditLog.create({
      data: { shopId, entity: "CostTemplate", entityId: templateId, action: "TEMPLATE_MATERIAL_LINE_ADDED", actor: "merchant" },
    });
    return Response.json({ ok: true, message: "Material line added." });
  }

  if (intent === "update-material-line") {
    const lineId = formData.get("lineId")?.toString() ?? "";
    const quantity = parseFloat(formData.get("quantity")?.toString() ?? "1");
    const yieldVal = formData.get("yield")?.toString();
    const usesPerVariant = formData.get("usesPerVariant")?.toString();

    const line = await requireMaterialLine(lineId);

    await prisma.costTemplateMaterialLine.updateMany({
      where: { id: lineId, templateId },
      data: {
        materialId: line.materialId,
        quantity,
        yield: yieldVal ? parseFloat(yieldVal) : null,
        usesPerVariant: usesPerVariant ? parseFloat(usesPerVariant) : null,
      },
    });
    await prisma.auditLog.create({
      data: { shopId, entity: "CostTemplate", entityId: templateId, action: "TEMPLATE_MATERIAL_LINE_UPDATED", actor: "merchant" },
    });
    return Response.json({ ok: true, message: "Material line updated." });
  }

  if (intent === "remove-material-line") {
    const lineId = formData.get("lineId")?.toString() ?? "";
    await requireMaterialLine(lineId);
    await prisma.costTemplateMaterialLine.deleteMany({ where: { id: lineId, templateId } });
    await prisma.auditLog.create({
      data: { shopId, entity: "CostTemplate", entityId: templateId, action: "TEMPLATE_MATERIAL_LINE_REMOVED", actor: "merchant" },
    });
    return Response.json({ ok: true, message: "Material line removed." });
  }

  if (intent === "add-equipment-line") {
    const equipmentId = formData.get("equipmentId")?.toString() ?? "";
    const minutes = formData.get("minutes")?.toString();
    const uses = formData.get("uses")?.toString();

    await requireEquipment(equipmentId);
    const duplicateEquipmentResponse = await ensureEquipmentNotAlreadyAdded(equipmentId);
    if (duplicateEquipmentResponse) return duplicateEquipmentResponse;

    await prisma.costTemplateEquipmentLine.create({
      data: {
        templateId,
        equipmentId,
        minutes: minutes ? parseFloat(minutes) : null,
        uses: uses ? parseFloat(uses) : null,
      },
    });
    await prisma.auditLog.create({
      data: { shopId, entity: "CostTemplate", entityId: templateId, action: "TEMPLATE_EQUIPMENT_LINE_ADDED", actor: "merchant" },
    });
    return Response.json({ ok: true, message: "Equipment line added." });
  }

  if (intent === "update-equipment-line") {
    const lineId = formData.get("lineId")?.toString() ?? "";
    const minutes = formData.get("minutes")?.toString();
    const uses = formData.get("uses")?.toString();

    const line = await requireEquipmentLine(lineId);

    await prisma.costTemplateEquipmentLine.updateMany({
      where: { id: lineId, templateId },
      data: {
        equipmentId: line.equipmentId,
        minutes: minutes ? parseFloat(minutes) : null,
        uses: uses ? parseFloat(uses) : null,
      },
    });
    await prisma.auditLog.create({
      data: { shopId, entity: "CostTemplate", entityId: templateId, action: "TEMPLATE_EQUIPMENT_LINE_UPDATED", actor: "merchant" },
    });
    return Response.json({ ok: true, message: "Equipment line updated." });
  }

  if (intent === "remove-equipment-line") {
    const lineId = formData.get("lineId")?.toString() ?? "";
    await requireEquipmentLine(lineId);
    await prisma.costTemplateEquipmentLine.deleteMany({ where: { id: lineId, templateId } });
    await prisma.auditLog.create({
      data: { shopId, entity: "CostTemplate", entityId: templateId, action: "TEMPLATE_EQUIPMENT_LINE_REMOVED", actor: "merchant" },
    });
    return Response.json({ ok: true, message: "Equipment line removed." });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

// ── Types ─────────────────────────────────────────────────────────────────────

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

type TemplateMaterialLine = {
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

type TemplateEquipmentLine = {
  id: string;
  equipmentId: string;
  equipmentName: string;
  hourlyRate: string | null;
  perUseCost: string | null;
  minutes: string | null;
  uses: string | null;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function TemplateDetailPage() {
  const { template, availableMaterials, availableEquipment } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const { formatMoney } = useAppLocalization();

  const [editingMeta, setEditingMeta] = useState(false);
  const [metaName, setMetaName] = useState(template.name);
  const [metaDesc, setMetaDesc] = useState(template.description);

  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [editingMaterialLineId, setEditingMaterialLineId] = useState<string | null>(null);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [materialSearchValue, setMaterialSearchValue] = useState("");
  const [matQty, setMatQty] = useState("1");
  const [matYield, setMatYield] = useState("");
  const [matUses, setMatUses] = useState("");

  const [addEquipmentOpen, setAddEquipmentOpen] = useState(false);
  const [editingEquipmentLineId, setEditingEquipmentLineId] = useState<string | null>(null);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [equipmentSearchValue, setEquipmentSearchValue] = useState("");
  const [eqMinutes, setEqMinutes] = useState("");
  const [eqUses, setEqUses] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const unavailableMaterialIds = new Set(template.materialLines.map((line: TemplateMaterialLine) => line.materialId));
  const unavailableEquipmentIds = new Set(template.equipmentLines.map((line: TemplateEquipmentLine) => line.equipmentId));

  const selectedMaterial = availableMaterials.find((m: AvailableMaterial) => m.id === selectedMaterialId);
  const filteredMaterialOptions = availableMaterials
    .filter((material: AvailableMaterial) => !unavailableMaterialIds.has(material.id))
    .filter((material: AvailableMaterial) =>
      material.name.toLowerCase().includes(materialSearchValue.trim().toLowerCase()),
    )
    .map((material: AvailableMaterial) => ({
      value: material.id,
      label: material.name,
    }));

  const filteredEquipmentOptions = availableEquipment
    .filter((equipment: AvailableEquipment) => !unavailableEquipmentIds.has(equipment.id))
    .filter((equipment: AvailableEquipment) =>
      equipment.name.toLowerCase().includes(equipmentSearchValue.trim().toLowerCase()),
    )
    .map((equipment: AvailableEquipment) => ({
      value: equipment.id,
      label: equipment.name,
    }));

  function resetMaterialModal() {
    setEditingMaterialLineId(null);
    setSelectedMaterialId("");
    setMaterialSearchValue("");
    setMatQty("1");
    setMatYield("");
    setMatUses("");
  }

  function resetEquipmentModal() {
    setEditingEquipmentLineId(null);
    setSelectedEquipmentId("");
    setEquipmentSearchValue("");
    setEqMinutes("");
    setEqUses("");
  }

  function openAddMaterialModal() {
    resetMaterialModal();
    setAddMaterialOpen(true);
  }

  function openEditMaterialModal(line: TemplateMaterialLine) {
    setEditingMaterialLineId(line.id);
    setSelectedMaterialId(line.materialId);
    setMaterialSearchValue(line.materialName);
    setMatQty(line.quantity);
    setMatYield(line.yield ?? "");
    setMatUses(line.usesPerVariant ?? "");
    setAddMaterialOpen(true);
  }

  function closeMaterialModal() {
    setAddMaterialOpen(false);
    resetMaterialModal();
  }

  function openAddEquipmentModal() {
    resetEquipmentModal();
    setAddEquipmentOpen(true);
  }

  function openEditEquipmentModal(line: TemplateEquipmentLine) {
    setEditingEquipmentLineId(line.id);
    setSelectedEquipmentId(line.equipmentId);
    setEquipmentSearchValue(line.equipmentName);
    setEqMinutes(line.minutes ?? "");
    setEqUses(line.uses ?? "");
    setAddEquipmentOpen(true);
  }

  function closeEquipmentModal() {
    setAddEquipmentOpen(false);
    resetEquipmentModal();
  }

  function previewLineCost(): string | null {
    if (!selectedMaterial) return null;
    const perUnit = Number(selectedMaterial.perUnitCost);
    const qty = Number(matQty);
    if (!qty || qty <= 0) return null;

    if (selectedMaterial.costingModel === "yield") {
      const y = Number(matYield);
      if (!y || y <= 0) return null;
      return formatMoney(perUnit / y * qty);
    }
    if (selectedMaterial.costingModel === "uses") {
      const total = Number(selectedMaterial.totalUsesPerUnit);
      const uses = Number(matUses);
      if (!total || total <= 0 || !uses || uses <= 0) return null;
      return formatMoney(perUnit / total * uses);
    }
    return null;
  }

  function previewEquipmentCost(): string | null {
    const eq = availableEquipment.find((e: AvailableEquipment) => e.id === selectedEquipmentId);
    if (!eq) return null;
    let cost = 0;
    if (eq.hourlyRate && eqMinutes) cost += (Number(eq.hourlyRate) * Number(eqMinutes)) / 60;
    if (eq.perUseCost && eqUses) cost += Number(eq.perUseCost) * Number(eqUses);
    return cost > 0 ? formatMoney(cost) : null;
  }

  return (
    <Page
      backAction={{ content: "Templates", url: "/app/templates" }}
      title={template.name}
      titleMetadata={
        <Badge tone={template.status === "active" ? "success" : "enabled"}>
          {template.status === "active" ? "Active" : "Inactive"}
        </Badge>
      }
    >
      <TitleBar title={template.name} />

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {fetcher.data?.message ?? ""}
      </div>

      <BlockStack gap="600">
        {/* Meta */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Details</Text>
              <Button variant="plain" onClick={() => setEditingMeta((v) => !v)}>
                {editingMeta ? "Cancel" : "Edit"}
              </Button>
            </InlineStack>
            <Divider />
            {editingMeta ? (
              <fetcher.Form method="post" onSubmit={() => setEditingMeta(false)}>
                <BlockStack gap="400">
                  <input type="hidden" name="intent" value="update-meta" />
                  <TextField label="Name" name="name" value={metaName} onChange={setMetaName} autoComplete="off" />
                  <TextField label="Description" name="description" value={metaDesc} onChange={setMetaDesc} multiline={2} autoComplete="off" />
                  <Button submit loading={isSubmitting}>Save</Button>
                </BlockStack>
              </fetcher.Form>
            ) : (
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">{template.name}</Text>
                <Text as="p" variant="bodyMd" tone="subdued">{template.description || "No description"}</Text>
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* Material lines */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Materials</Text>
              <Button onClick={openAddMaterialModal} disabled={availableMaterials.length === 0}>
                Add material
              </Button>
            </InlineStack>
            <Divider />
            {template.materialLines.length === 0 ? (
              <EmptyState
                heading="No materials"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                fullWidth
              >
                <Text as="p" variant="bodyMd" tone="subdued">Add production and shipping materials to this template.</Text>
              </EmptyState>
            ) : (
              <BlockStack gap="300">
                {template.materialLines.map((line: TemplateMaterialLine) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.materialName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {line.costingModel === "yield"
                          ? `Yield: ${line.yield} — Qty: ${line.quantity}`
                          : `Uses/variant: ${line.usesPerVariant}`}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button variant="plain" onClick={() => openEditMaterialModal(line)}>
                        Edit
                      </Button>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="remove-material-line" />
                        <input type="hidden" name="lineId" value={line.id} />
                        <Button variant="plain" tone="critical" submit loading={isSubmitting}>Remove</Button>
                      </fetcher.Form>
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* Equipment lines */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Equipment</Text>
              <Button onClick={openAddEquipmentModal} disabled={availableEquipment.length === 0}>
                Add equipment
              </Button>
            </InlineStack>
            <Divider />
            {template.equipmentLines.length === 0 ? (
              <EmptyState
                heading="No equipment"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                fullWidth
              >
                <Text as="p" variant="bodyMd" tone="subdued">Add equipment to include machine time costs in this template.</Text>
              </EmptyState>
            ) : (
              <BlockStack gap="300">
                {template.equipmentLines.map((line: TemplateEquipmentLine) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.equipmentName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {[line.minutes ? `${line.minutes} min` : null, line.uses ? `${line.uses} uses` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button variant="plain" onClick={() => openEditEquipmentModal(line)}>
                        Edit
                      </Button>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="remove-equipment-line" />
                        <input type="hidden" name="lineId" value={line.id} />
                        <Button variant="plain" tone="critical" submit loading={isSubmitting}>Remove</Button>
                      </fetcher.Form>
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Add material modal */}
      <Modal
        open={addMaterialOpen}
        onClose={closeMaterialModal}
        title={editingMaterialLineId ? "Edit material line" : "Add material"}
        primaryAction={{
          content: editingMaterialLineId ? "Save" : "Add",
          disabled: !selectedMaterialId,
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", editingMaterialLineId ? "update-material-line" : "add-material-line");
            if (editingMaterialLineId) fd.append("lineId", editingMaterialLineId);
            fd.append("materialId", selectedMaterialId);
            fd.append("quantity", matQty);
            if (selectedMaterial?.costingModel === "yield" && matYield) fd.append("yield", matYield);
            if (selectedMaterial?.costingModel === "uses" && matUses) fd.append("usesPerVariant", matUses);
            fetcher.submit(fd, { method: "post" });
            closeMaterialModal();
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeMaterialModal }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {editingMaterialLineId ? (
              <TextField
                label="Material"
                value={selectedMaterial?.name ?? ""}
                autoComplete="off"
                disabled
              />
            ) : (
              <Autocomplete
                options={filteredMaterialOptions}
                selected={selectedMaterialId ? [selectedMaterialId] : []}
                onSelect={(selected) => {
                  const nextId = selected[0] ?? "";
                  const nextMaterial = availableMaterials.find((item: AvailableMaterial) => item.id === nextId);
                  setSelectedMaterialId(nextId);
                  setMaterialSearchValue(nextMaterial?.name ?? "");
                  setMatYield("");
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
            <TextField
              label="Quantity"
              type="number"
              min={0}
              step={0.001}
              value={matQty}
              onChange={setMatQty}
              autoComplete="off"
            />
            {selectedMaterial?.costingModel === "yield" && (
              <TextField
                label="Yield (units produced per purchased unit)"
                type="number"
                min={0}
                step={0.001}
                value={matYield}
                onChange={setMatYield}
                autoComplete="off"
              />
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
              />
            )}
            {previewLineCost() && (
              <Text as="p" variant="bodyMd" tone="subdued">
                Estimated line cost: <strong>{previewLineCost()}</strong>
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Add equipment modal */}
      <Modal
        open={addEquipmentOpen}
        onClose={closeEquipmentModal}
        title={editingEquipmentLineId ? "Edit equipment line" : "Add equipment"}
        primaryAction={{
          content: editingEquipmentLineId ? "Save" : "Add",
          disabled: !selectedEquipmentId,
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", editingEquipmentLineId ? "update-equipment-line" : "add-equipment-line");
            if (editingEquipmentLineId) fd.append("lineId", editingEquipmentLineId);
            fd.append("equipmentId", selectedEquipmentId);
            if (eqMinutes) fd.append("minutes", eqMinutes);
            if (eqUses) fd.append("uses", eqUses);
            fetcher.submit(fd, { method: "post" });
            closeEquipmentModal();
          },
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
                  helpText="Time on equipment per variant"
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
                  helpText="Per-use charges (e.g. needle passes)"
                />
              </div>
            </InlineStack>
            {previewEquipmentCost() && (
              <Text as="p" variant="bodyMd" tone="subdued">
                Estimated line cost: <strong>{previewEquipmentCost()}</strong>
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
