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
  Select,
  Divider,
  EmptyState,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { resolveCosts } from "../services/costEngine.server";
import l10n from "../utils/localization";

// ── Loader ────────────────────────────────────────────────────────────────────

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
          template: { select: { id: true, name: true } },
          materialLines: { include: { material: true } },
          equipmentLines: { include: { equipment: true } },
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

  return Response.json({
    variant: {
      id: variant.id,
      productTitle: variant.product.title,
      title: variant.title,
      sku: variant.sku ?? "",
      price: variant.price.toString(),
    },
    config: config
      ? {
          id: config.id,
          templateId: config.templateId,
          templateName: config.template?.name ?? null,
          defaultLaborRate: shop?.defaultLaborRate,
          laborMinutes: config.laborMinutes?.toString() ?? "",
          laborRate: config.laborRate?.toString() ?? "",
          defaultMistakeBuffer: shop?.mistakeBuffer
            ? (Number(shop.mistakeBuffer) * 100).toFixed(2)
            : "",
          mistakeBuffer: config.mistakeBuffer
            ? (Number(config.mistakeBuffer) * 100).toFixed(2)
            : "",
          lineItemCount: config.lineItemCount,
          materialLines: config.materialLines.map((l) => ({
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
          equipmentLines: config.equipmentLines.map((l) => ({
            id: l.id,
            equipmentId: l.equipmentId,
            equipmentName: l.equipment.name,
            hourlyRate: l.equipment.hourlyRate?.toString() ?? null,
            perUseCost: l.equipment.perUseCost?.toString() ?? null,
            minutes: l.minutes?.toString() ?? null,
            uses: l.uses?.toString() ?? null,
          })),
        }
      : null,
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
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
  const variantId = params.variantId ?? "";

  const variant = await prisma.variant.findFirst({ where: { id: variantId, shopId }, select: { shopId: true, price: true } });
  if (!variant)
    return Response.json({ ok: false, message: "Not found." }, { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  // Ensure config exists for mutation intents that need it
  async function ensureConfig() {
    const existing = await prisma.variantCostConfig.findFirst({ where: { variantId, shopId } });
    if (existing) return existing;
    return prisma.variantCostConfig.create({ data: { shopId, variantId } });
  }

  if (intent === "assign-template") {
    const templateId = formData.get("templateId")?.toString() ?? "";
    const config = await ensureConfig();
    await prisma.variantCostConfig.updateMany({ where: { id: config.id, shopId }, data: { templateId } });
    await prisma.auditLog.create({
      data: { shopId, entity: "VariantCostConfig", entityId: config.id, action: "TEMPLATE_ASSIGNED", actor: "merchant", payload: { templateId } },
    });
    return Response.json({ ok: true, message: "Template assigned." });
  }

  if (intent === "remove-template") {
    const config = await prisma.variantCostConfig.findFirst({ where: { variantId, shopId } });
    if (config) {
      await prisma.variantCostConfig.updateMany({ where: { id: config.id, shopId }, data: { templateId: null } });
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
    if (buffer !== null && (isNaN(buffer) || buffer < 0 || buffer > 100))
      return Response.json({ ok: false, message: "Mistake buffer must be 0–100." }, { status: 400 });
    const config = await ensureConfig();
    await prisma.variantCostConfig.updateMany({
      where: { id: config.id, shopId },
      data: { mistakeBuffer: buffer !== null ? buffer / 100 : null },
    });
    return Response.json({ ok: true, message: "Mistake buffer updated." });
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
    const line = await prisma.variantMaterialLine.findFirst({ where: { id: lineId, shopId }, select: { configId: true } });
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
    const line = await prisma.variantEquipmentLine.findFirst({ where: { id: lineId, shopId }, select: { configId: true } });
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

type VariantMaterialLine = {
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

type VariantEquipmentLine = {
  id: string;
  equipmentId: string;
  equipmentName: string;
  hourlyRate: string | null;
  perUseCost: string | null;
  minutes: string | null;
  uses: string | null;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function VariantDetailPage() {
  const { variant, config, templates, availableMaterials, availableEquipment } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string; preview?: Record<string, string> }>();

  const { formatMoney, formatPct, getCurrencySymbol } = l10n();

  const defaultLaborRate = config?.defaultLaborRate;
  const defaultMistakeBuffer = config?.defaultMistakeBuffer;

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

  const [addEquipmentOpen, setAddEquipmentOpen] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState(availableEquipment[0]?.id ?? "");
  const [eqMinutes, setEqMinutes] = useState("");
  const [eqUses, setEqUses] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const preview = fetcher.data?.preview;

  const selectedMaterial = availableMaterials.find((m: AvailableMaterial) => m.id === selectedMaterialId);

  function refreshPreview() {
    const fd = new FormData();
    fd.append("intent", "preview-cost");
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <Page
      backAction={{ content: "Variants", url: "/app/variants" }}
      title={`${variant.productTitle} — ${variant.title}`}
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
        {/* Variant info */}
        <Card>
          <BlockStack gap="200">
            <InlineStack gap="400">
              <Text as="p" variant="bodyMd" tone="subdued">SKU: {variant.sku || "—"}</Text>
              <Text as="p" variant="bodyMd" tone="subdued">Price: {formatMoney(variant.price)}</Text>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Template */}
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
              <Text as="p" variant="bodyMd" tone="subdued">No template assigned — configure lines manually below.</Text>
            )}
          </BlockStack>
        </Card>

        {/* Labor */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Labor</Text>
              <Button variant="plain" onClick={() => setEditingLabor((v) => !v)}>
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
                        placeholder={`${formatMoney(config.defaultLaborRate)}/hr (Shop default)`}
                        name="laborRate"
                        type="number"
                        min={0}
                        step={0.01}
                        value={laborRate}
                        onChange={setLaborRate}
                        autoComplete="off"
                        helpText="Leave blank to use the global default from Settings"
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
                  {config?.laborRate ? `${formatMoney(config.laborRate)}/hr` : `${formatMoney(config.defaultLaborRate)}/hr (Shop Default)`}
                </Text>
              </InlineStack>
            )}
          </BlockStack>
        </Card>

        {/* Mistake buffer override */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Mistake Buffer Override</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Overrides the global default from Settings for this variant only.
                </Text>
              </BlockStack>
              <Button variant="plain" onClick={() => setEditingBuffer((v) => !v)}>
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
                    placeholder={`${formatPct(defaultMistakeBuffer / 100)} (Shop Default)`}
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
                {config?.mistakeBuffer ? `${formatPct(config.mistakeBuffer / 100)}` : `${formatPct(defaultMistakeBuffer / 100)} (Shop Default)`}
              </Text>
            )}
          </BlockStack>
        </Card>

        {/* Material overrides */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Material Lines</Text>
                  {config && config.materialLines.length > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {config.materialLines.length}
                    </Text>
                  )}
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Override template lines or add variant-specific materials.
                </Text>
              </BlockStack>
              <Button onClick={() => setAddMaterialOpen(true)} disabled={availableMaterials.length === 0}>
                Add material
              </Button>
            </InlineStack>
            <Divider />
            {!config || config.materialLines.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">No variant-specific material lines.</Text>
            ) : (
              <BlockStack gap="300">
                {config.materialLines.map((line: VariantMaterialLine) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.materialName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {line.costingModel === "yield"
                          ? `Qty: ${line.quantity} — Yield: ${line.yield}`
                          : `Uses: ${line.usesPerVariant}`}
                      </Text>
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

        {/* Equipment overrides */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">Equipment Lines</Text>
                  {config && config.equipmentLines.length > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {config.equipmentLines.length}
                    </Text>
                  )}
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Override template lines or add variant-specific equipment.
                </Text>
              </BlockStack>
              <Button onClick={() => setAddEquipmentOpen(true)} disabled={availableEquipment.length === 0}>
                Add equipment
              </Button>
            </InlineStack>
            <Divider />
            {!config || config.equipmentLines.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">No variant-specific equipment lines.</Text>
            ) : (
              <BlockStack gap="300">
                {config.equipmentLines.map((line: VariantEquipmentLine) => (
                  <InlineStack key={line.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{line.equipmentName}</Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {[line.minutes ? `${line.minutes} min` : null, line.uses ? `${line.uses} uses` : null]
                          .filter(Boolean).join(" · ")}
                      </Text>
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

        {/* Cost preview */}
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

      {/* Assign template modal */}
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
            options={templates.map((t: { id: string; name: string }) => ({ label: t.name, value: t.id }))}
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
          />
        </Modal.Section>
      </Modal>

      {/* Add material modal */}
      <Modal
        open={addMaterialOpen}
        onClose={() => setAddMaterialOpen(false)}
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
            if (selectedMaterial?.costingModel === "uses" && matUses)
              fd.append("usesPerVariant", matUses);
            fetcher.submit(fd, { method: "post" });
            setAddMaterialOpen(false);
            setMatQty("1"); setMatYield(""); setMatUses("");
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAddMaterialOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select
              label="Material"
              options={availableMaterials.map((m: AvailableMaterial) => ({ label: m.name, value: m.id }))}
              value={selectedMaterialId}
              onChange={(v) => { setSelectedMaterialId(v); setMatYield(""); setMatUses(""); }}
            />
            {selectedMaterial?.costingModel === "yield" && (
              <>
                <TextField
                  label="Material Quantity" 
                  type="number" 
                  min={0} step={1}
                  value={matQty} 
                  onChange={setMatQty} 
                  autoComplete="off"
                  helpText="Number of pieces of this material required to produce this variant." />
                <TextField 
                  label="Yield Per Piece"
                  type="number" 
                  min={0} 
                  step={1}
                  value={matYield}
                  onChange={setMatYield}
                  autoComplete="off"
                  helpText="Number of variants produced from one piece of this material." />
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
                helpText="Number of uses of the material this variant requires." />
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Add equipment modal */}
      <Modal
        open={addEquipmentOpen}
        onClose={() => setAddEquipmentOpen(false)}
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
            setEqMinutes(""); setEqUses("");
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAddEquipmentOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select
              label="Equipment"
              options={availableEquipment.map((e: AvailableEquipment) => ({ label: e.name, value: e.id }))}
              value={selectedEquipmentId}
              onChange={setSelectedEquipmentId}
            />
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField label="Minutes" type="number" min={0} step={0.5} value={eqMinutes} onChange={setEqMinutes} autoComplete="off" />
              </div>
              <div style={{ flex: 1 }}>
                <TextField label="Uses" type="number" min={0} step={1} value={eqUses} onChange={setEqUses} autoComplete="off" />
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
