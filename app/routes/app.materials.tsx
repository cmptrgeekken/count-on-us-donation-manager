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
  Badge,
  Button,
  Modal,
  TextField,
  Select,
  IndexTable,
  useIndexResourceState,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import l10n from "../utils/localization";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const materials = await prisma.materialLibraryItem.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { templateLines: true, variantLines: true } },
    },
  });

  return Response.json({
    materials: materials.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      costingModel: m.costingModel,
      purchasePrice: m.purchasePrice.toString(),
      purchaseQty: m.purchaseQty.toString(),
      perUnitCost: m.perUnitCost.toString(),
      totalUsesPerUnit: m.totalUsesPerUnit?.toString() ?? null,
      unitDescription: m.unitDescription ?? "",
      status: m.status,
      notes: m.notes ?? "",
      templateCount: m._count.templateLines,
      variantCount: m._count.variantLines,
    })),
  });
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "create" || intent === "update") {
    const name = formData.get("name")?.toString().trim() ?? "";
    const type = formData.get("type")?.toString() ?? "production";
    const costingModel = formData.get("costingModel")?.toString() ?? "yield";
    const purchasePrice = parseFloat(formData.get("purchasePrice")?.toString() ?? "0");
    const purchaseQty = parseFloat(formData.get("purchaseQty")?.toString() ?? "1");
    const totalUsesPerUnit =
      costingModel === "uses"
        ? parseFloat(formData.get("totalUsesPerUnit")?.toString() ?? "0")
        : null;
    const unitDescription = formData.get("unitDescription")?.toString().trim() || null;
    const notes = formData.get("notes")?.toString().trim() || null;

    if (!name)
      return Response.json({ ok: false, message: "Name is required." }, { status: 400 });
    if (isNaN(purchasePrice) || purchasePrice <= 0)
      return Response.json({ ok: false, message: "Purchase price must be greater than 0." }, { status: 400 });
    if (isNaN(purchaseQty) || purchaseQty <= 0)
      return Response.json({ ok: false, message: "Purchase quantity must be greater than 0." }, { status: 400 });
    if (costingModel === "uses" && (totalUsesPerUnit === null || isNaN(totalUsesPerUnit) || totalUsesPerUnit <= 0))
      return Response.json({ ok: false, message: "Total uses per unit must be greater than 0 for uses-based costing." }, { status: 400 });

    const perUnitCost = purchasePrice / purchaseQty;
    const data = {
      shopId,
      name,
      type,
      costingModel,
      purchasePrice,
      purchaseQty,
      perUnitCost,
      totalUsesPerUnit,
      unitDescription,
      notes,
    };

    if (intent === "create") {
      const material = await prisma.materialLibraryItem.create({ data });
      await prisma.auditLog.create({
        data: { shopId, entity: "MaterialLibraryItem", entityId: material.id, action: "MATERIAL_CREATED", actor: "merchant" },
      });
      return Response.json({ ok: true, message: "Material created." });
    } else {
      const id = formData.get("id")?.toString() ?? "";
      await prisma.materialLibraryItem.update({ where: { id, shopId }, data });
      await prisma.auditLog.create({
        data: { shopId, entity: "MaterialLibraryItem", entityId: id, action: "MATERIAL_UPDATED", actor: "merchant" },
      });
      return Response.json({ ok: true, message: "Material updated." });
    }
  }

  if (intent === "deactivate" || intent === "reactivate") {
    const id = formData.get("id")?.toString() ?? "";
    const status = intent === "deactivate" ? "inactive" : "active";
    await prisma.materialLibraryItem.update({ where: { id, shopId }, data: { status } });
    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "MaterialLibraryItem",
        entityId: id,
        action: intent === "deactivate" ? "MATERIAL_DEACTIVATED" : "MATERIAL_REACTIVATED",
        actor: "merchant",
      },
    });
    return Response.json({ ok: true, message: intent === "deactivate" ? "Material deactivated." : "Material reactivated." });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Material = {
  id: string;
  name: string;
  type: string;
  costingModel: string | null;
  purchasePrice: string;
  purchaseQty: string;
  perUnitCost: string;
  totalUsesPerUnit: string | null;
  unitDescription: string;
  status: string;
  notes: string;
  templateCount: number;
  variantCount: number;
};

const EMPTY_FORM = {
  id: "",
  name: "",
  type: "production",
  costingModel: "yield",
  purchasePrice: "",
  purchaseQty: "",
  totalUsesPerUnit: "",
  unitDescription: "",
  notes: "",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function MaterialsPage() {
  const { materials } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const { formatMoney, getCurrencySymbol } = l10n();

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deactivateTarget, setDeactivateTarget] = useState<Material | null>(null);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(materials);

  function openCreate() {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(m: Material) {
    setForm({
      id: m.id,
      name: m.name,
      type: m.type,
      costingModel: m.costingModel ?? "yield",
      purchasePrice: m.purchasePrice,
      purchaseQty: m.purchaseQty,
      totalUsesPerUnit: m.totalUsesPerUnit ?? "",
      unitDescription: m.unitDescription,
      notes: m.notes,
    });
    setModalOpen(true);
  }

  const perUnitPreview =
    form.purchasePrice && form.purchaseQty && Number(form.purchaseQty) > 0
      ? (Number(form.purchasePrice) / Number(form.purchaseQty)).toFixed(2)
      : null;

  const perUsePreview = 
    perUnitPreview && form.totalUsesPerUnit && Number(form.totalUsesPerUnit) > 0
      ? (Number(perUnitPreview) / Number(form.totalUsesPerUnit)).toFixed(2)
      : null;

  const isSubmitting = fetcher.state !== "idle";

  const rowMarkup = materials.map((m: Material, index: number) => (
    <IndexTable.Row
      id={m.id}
      key={m.id}
      selected={selectedResources.includes(m.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">{m.name}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {m.type === "production" ? "Production" : "Shipping"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {m.costingModel === "yield" ? "Yield-based" : m.costingModel === "uses" ? "Uses-based" : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">{formatMoney(m.perUnitCost)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="subdued">
          {m.templateCount + m.variantCount} uses
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={m.status === "active" ? "success" : "enabled"}>
          {m.status === "active" ? "Active" : "Inactive"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <span onClick={(e) => e.stopPropagation()}>
            <Button variant="plain" onClick={() => openEdit(m)}>Edit</Button>
          </span>
          {m.status === "active" ? (
            <span onClick={(e) => e.stopPropagation()}>
              <Button variant="plain" tone="critical" onClick={() => setDeactivateTarget(m)}>
                Deactivate
              </Button>
            </span>
          ) : (
            <fetcher.Form method="post" style={{ display: "inline" }} onClick={(e) => e.stopPropagation()}>
              <input type="hidden" name="intent" value="reactivate" />
              <input type="hidden" name="id" value={m.id} />
              <Button variant="plain" submit loading={isSubmitting}>Reactivate</Button>
            </fetcher.Form>
          )}
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="Material Library">
        <button variant="primary" onClick={openCreate}>New material</button>
      </TitleBar>

      {/* Screen reader announcements */}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {fetcher.data?.message ?? ""}
      </div>

      <BlockStack gap="400">
        {fetcher.data && !fetcher.data.ok && (
          <Banner tone="critical">
            <Text as="p" variant="bodyMd">{fetcher.data.message}</Text>
          </Banner>
        )}

        <Card padding="0">
          {materials.length === 0 ? (
            <EmptyState
              heading="No materials yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Add production and shipping materials to calculate per-unit costs.
                </Text>
                <Button variant="primary" onClick={openCreate}>Add first material</Button>
              </BlockStack>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "material", plural: "materials" }}
              itemCount={materials.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Name" },
                { title: "Type" },
                { title: "Costing model" },
                { title: "Per-unit cost" },
                { title: "Used by" },
                { title: "Status" },
                { title: "Actions" },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          )}
        </Card>
      </BlockStack>

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? "Edit material" : "New material"}
        primaryAction={{
          content: form.id ? "Save" : "Create",
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", form.id ? "update" : "create");
            if (form.id) fd.append("id", form.id);
            fd.append("name", form.name);
            fd.append("type", form.type);
            fd.append("costingModel", form.costingModel);
            fd.append("purchasePrice", form.purchasePrice);
            fd.append("purchaseQty", form.purchaseQty);
            if (form.costingModel === "uses")
              fd.append("totalUsesPerUnit", form.totalUsesPerUnit);
            fd.append("unitDescription", form.unitDescription);
            fd.append("notes", form.notes);
            fetcher.submit(fd, { method: "post" });
            setModalOpen(false);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setModalOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Name"
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              autoComplete="off"
            />
            <Select
              label="Type"
              options={[
                { label: "Production material", value: "production" },
                { label: "Shipping material", value: "shipping" },
              ]}
              value={form.type}
              onChange={(v) => setForm((f) => ({ ...f, type: v }))}
            />
            <Select
              label="Costing model"
              options={[
                { label: "Yield-based (e.g. fabric by the metre)", value: "yield" },
                { label: "Uses-based (e.g. screen with 50 uses)", value: "uses" },
              ]}
              value={form.costingModel}
              onChange={(v) => setForm((f) => ({ ...f, costingModel: v }))}
            />
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label={`Purchase price (${getCurrencySymbol()})`}
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.purchasePrice}
                  onChange={(v) => setForm((f) => ({ ...f, purchasePrice: v }))}
                  autoComplete="off"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Purchase quantity"
                  type="number"
                  min={0}
                  step={0.001}
                  value={form.purchaseQty}
                  onChange={(v) => setForm((f) => ({ ...f, purchaseQty: v }))}
                  autoComplete="off"
                />
              </div>
            </InlineStack>
            {perUnitPreview && (
              <Text as="p" variant="bodyMd" tone="subdued">
                Per-unit cost: <strong>{formatMoney(perUnitPreview)}</strong>
              </Text>
            )}
            {form.costingModel === "uses" && (
              <>
                <TextField
                  label="Total uses per unit"
                  type="number"
                  min={0}
                  step={1}
                  value={form.totalUsesPerUnit}
                  onChange={(v) => setForm((f) => ({ ...f, totalUsesPerUnit: v }))}
                  autoComplete="off"
                  helpText="How many uses can be extracted from one purchased unit"
                />
                {perUsePreview && (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Per-use cost (rounded): <strong>{formatMoney(perUsePreview)}</strong>
                  </Text>
                )}
              </>
            )}
            <TextField
              label="Unit description (optional)"
              value={form.unitDescription}
              onChange={(v) => setForm((f) => ({ ...f, unitDescription: v }))}
              autoComplete="off"
              helpText="e.g. metres, grams, sheets"
            />
            <TextField
              label="Notes (optional)"
              value={form.notes}
              onChange={(v) => setForm((f) => ({ ...f, notes: v }))}
              multiline={3}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Deactivate confirmation modal */}
      {deactivateTarget && (
        <Modal
          open
          onClose={() => setDeactivateTarget(null)}
          title="Deactivate material"
          primaryAction={{
            content: "Deactivate",
            destructive: true,
            loading: isSubmitting,
            onAction: () => {
              const fd = new FormData();
              fd.append("intent", "deactivate");
              fd.append("id", deactivateTarget.id);
              fetcher.submit(fd, { method: "post" });
              setDeactivateTarget(null);
            },
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setDeactivateTarget(null) }]}
        >
          <Modal.Section>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Deactivating <strong>{deactivateTarget.name}</strong> will hide it from new configurations.
              </Text>
              {deactivateTarget.templateCount + deactivateTarget.variantCount > 0 && (
                <Text as="p" variant="bodyMd" tone="caution">
                  This material is currently used in {deactivateTarget.templateCount} template(s) and {deactivateTarget.variantCount} variant config(s). Existing cost calculations will not be affected.
                </Text>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Materials] ErrorBoundary caught:", error);
  return (
    <Page>
      <TitleBar title="Material Library" />
      <Banner tone="critical">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="bold">Something went wrong loading materials.</Text>
          <Text as="p" variant="bodyMd">Please refresh the page. If the problem persists, contact support.</Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
