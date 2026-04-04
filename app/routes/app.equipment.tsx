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
  IndexTable,
  useIndexResourceState,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { useAppLocalization } from "../utils/use-app-localization";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const equipment = await prisma.equipmentLibraryItem.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { templateLines: true, variantLines: true } },
    },
  });

  return Response.json({
    equipment: equipment.map((e) => ({
      id: e.id,
      name: e.name,
      hourlyRate: e.hourlyRate?.toString() ?? null,
      perUseCost: e.perUseCost?.toString() ?? null,
      status: e.status,
      notes: e.notes ?? "",
      templateCount: e._count.templateLines,
      variantCount: e._count.variantLines,
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
    const hourlyRateStr = formData.get("hourlyRate")?.toString().trim();
    const perUseCostStr = formData.get("perUseCost")?.toString().trim();
    const notes = formData.get("notes")?.toString().trim() || null;

    if (!name)
      return Response.json({ ok: false, message: "Name is required." }, { status: 400 });

    const hourlyRate = hourlyRateStr ? parseFloat(hourlyRateStr) : null;
    const perUseCost = perUseCostStr ? parseFloat(perUseCostStr) : null;

    if ((hourlyRate === null || isNaN(hourlyRate)) && (perUseCost === null || isNaN(perUseCost)))
      return Response.json({ ok: false, message: "At least one of hourly rate or per-use cost must be set." }, { status: 400 });
    if (hourlyRate !== null && hourlyRate < 0)
      return Response.json({ ok: false, message: "Hourly rate must be 0 or greater." }, { status: 400 });
    if (perUseCost !== null && perUseCost < 0)
      return Response.json({ ok: false, message: "Per-use cost must be 0 or greater." }, { status: 400 });

    const data = {
      shopId,
      name,
      hourlyRate: hourlyRate !== null && !isNaN(hourlyRate) ? hourlyRate : null,
      perUseCost: perUseCost !== null && !isNaN(perUseCost) ? perUseCost : null,
      notes,
    };

    if (intent === "create") {
      const item = await prisma.equipmentLibraryItem.create({ data });
      await prisma.auditLog.create({
        data: { shopId, entity: "EquipmentLibraryItem", entityId: item.id, action: "EQUIPMENT_CREATED", actor: "merchant" },
      });
      return Response.json({ ok: true, message: "Equipment created." });
    } else {
      const id = formData.get("id")?.toString() ?? "";
      await prisma.equipmentLibraryItem.update({ where: { id }, data });
      await prisma.auditLog.create({
        data: { shopId, entity: "EquipmentLibraryItem", entityId: id, action: "EQUIPMENT_UPDATED", actor: "merchant" },
      });
      return Response.json({ ok: true, message: "Equipment updated." });
    }
  }

  if (intent === "deactivate" || intent === "reactivate") {
    const id = formData.get("id")?.toString() ?? "";
    const status = intent === "deactivate" ? "inactive" : "active";
    await prisma.equipmentLibraryItem.update({ where: { id, shopId }, data: { status } });
    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "EquipmentLibraryItem",
        entityId: id,
        action: intent === "deactivate" ? "EQUIPMENT_DEACTIVATED" : "EQUIPMENT_REACTIVATED",
        actor: "merchant",
      },
    });
    return Response.json({ ok: true, message: intent === "deactivate" ? "Equipment deactivated." : "Equipment reactivated." });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

// ── Types ─────────────────────────────────────────────────────────────────────

type EquipmentItem = {
  id: string;
  name: string;
  hourlyRate: string | null;
  perUseCost: string | null;
  status: string;
  notes: string;
  templateCount: number;
  variantCount: number;
};

const EMPTY_FORM = { id: "", name: "", hourlyRate: "", perUseCost: "", notes: "" };

// ── Component ─────────────────────────────────────────────────────────────────

export default function EquipmentPage() {
  const { equipment } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();

  const { formatMoney, getCurrencySymbol } = useAppLocalization();

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deactivateTarget, setDeactivateTarget] = useState<EquipmentItem | null>(null);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(equipment);

  function openCreate() {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(e: EquipmentItem) {
    setForm({
      id: e.id,
      name: e.name,
      hourlyRate: e.hourlyRate ?? "",
      perUseCost: e.perUseCost ?? "",
      notes: e.notes,
    });
    setModalOpen(true);
  }

  const isSubmitting = fetcher.state !== "idle";

  const rowMarkup = equipment.map((e: EquipmentItem, index: number) => (
    <IndexTable.Row
      id={e.id}
      key={e.id}
      selected={selectedResources.includes(e.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">{e.name}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {e.hourlyRate ? `${formatMoney(e.hourlyRate)}/hr` : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {e.perUseCost ? `${formatMoney(e.perUseCost)}/use` : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="subdued">
          {e.templateCount + e.variantCount} uses
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={e.status === "active" ? "success" : "enabled"}>
          {e.status === "active" ? "Active" : "Inactive"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <span onClick={(ev) => ev.stopPropagation()}>
            <Button variant="plain" onClick={() => openEdit(e)}>Edit</Button>
          </span>
          {e.status === "active" ? (
            <span onClick={(ev) => ev.stopPropagation()}>
              <Button variant="plain" tone="critical" onClick={() => setDeactivateTarget(e)}>
                Deactivate
              </Button>
            </span>
          ) : (
            <fetcher.Form method="post" style={{ display: "inline" }} onClick={(ev) => ev.stopPropagation()}>
              <input type="hidden" name="intent" value="reactivate" />
              <input type="hidden" name="id" value={e.id} />
              <Button variant="plain" submit loading={isSubmitting}>Reactivate</Button>
            </fetcher.Form>
          )}
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="Equipment Library">
        <button variant="primary" onClick={openCreate}>New equipment</button>
      </TitleBar>

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
          {equipment.length === 0 ? (
            <EmptyState
              heading="No equipment yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Add equipment (heat presses, printers, embroidery machines) to include their costs in variant calculations.
                </Text>
                <Button variant="primary" onClick={openCreate}>Add first equipment</Button>
              </BlockStack>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "equipment item", plural: "equipment items" }}
              itemCount={equipment.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Name" },
                { title: "Hourly rate" },
                { title: "Per-use cost" },
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
        title={form.id ? "Edit equipment" : "New equipment"}
        primaryAction={{
          content: form.id ? "Save" : "Create",
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", form.id ? "update" : "create");
            if (form.id) fd.append("id", form.id);
            fd.append("name", form.name);
            if (form.hourlyRate) fd.append("hourlyRate", form.hourlyRate);
            if (form.perUseCost) fd.append("perUseCost", form.perUseCost);
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
            <Text as="p" variant="bodyMd" tone="subdued">
              Set at least one of the following rate fields.
            </Text>
            <InlineStack gap="400" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label={`Hourly rate (${getCurrencySymbol()})`}
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.hourlyRate}
                  onChange={(v) => setForm((f) => ({ ...f, hourlyRate: v }))}
                  autoComplete="off"
                  helpText="Cost per hour of use"
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextField
                  label={`Per-use cost (${getCurrencySymbol()})`}
                  type="number"
                  min={0}
                  step={0.0001}
                  value={form.perUseCost}
                  onChange={(v) => setForm((f) => ({ ...f, perUseCost: v }))}
                  autoComplete="off"
                  helpText="Fixed cost per use (e.g. ink cartridge wear)"
                />
              </div>
            </InlineStack>
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
          title="Deactivate equipment"
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
                  This equipment is currently used in {deactivateTarget.templateCount} template(s) and {deactivateTarget.variantCount} variant config(s). Existing cost calculations will not be affected.
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
  console.error("[Equipment] ErrorBoundary caught:", error);
  return (
    <Page>
      <TitleBar title="Equipment Library" />
      <Banner tone="critical">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="bold">Something went wrong loading equipment.</Text>
          <Text as="p" variant="bodyMd">Please refresh the page. If the problem persists, contact support.</Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
