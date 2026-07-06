import { jsonResponse } from "~/utils/json-response.server";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ResourceTableHeader } from "../components/admin-ui";
import { prisma } from "../db.server";
import { resolveEquipmentEffectiveRates } from "../services/costEngine.server";
import { createEquipmentLibraryItem } from "../services/libraryCreate.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { normalizeFixedDecimalInput } from "../utils/input-formatting";
import { EQUIPMENT_USAGE_BASIS_OPTIONS, usageBasisLabel } from "../utils/equipment-usage";
import {
  parseOptionalNonNegativeDecimal,
  parseOptionalNonNegativeMoney,
  parseOptionalPositiveDecimal,
  parseRequiredPositiveDecimal,
  parseRequiredPositiveMoney,
} from "../utils/money-parsing";
import { useAppLocalization } from "../utils/use-app-localization";

const equipmentIdSchema = z.object({
  id: z.string().trim().cuid("Equipment id is invalid."),
});

const equipmentFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  purchaseLink: z.union([z.literal(""), z.url({ message: "Equipment purchase link must be a valid URL." })]),
  hourlyRateMode: z.enum(["manual", "calculated"]),
  perUseCostMode: z.enum(["manual", "calculated"]),
  usageBasis: z.enum(["time", "unit", "time_and_unit"]),
  expectedLifespanUnit: z.enum(["hours", "uses"]),
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

const dialogFieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
};

function parseConsumablesInput(value: FormDataEntryValue | null, shopId: string) {
  let rawConsumables: unknown = [];
  const raw = value?.toString().trim() ?? "";
  if (raw) {
    try {
      rawConsumables = JSON.parse(raw) as unknown;
    } catch {
      throw new Response("Consumables must be valid JSON.", { status: 400 });
    }
  }

  const parsed = z.array(equipmentConsumableSchema).safeParse(rawConsumables);
  if (!parsed.success) {
    throw new Response(parsed.error.issues[0]?.message ?? "Invalid consumables.", { status: 400 });
  }

  return parsed.data.map((consumable, index) => ({
    id: consumable.id,
    shopId,
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
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const [equipment, shopDefaults] = await Promise.all([
    prisma.equipmentLibraryItem.findMany({
      where: { shopId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { templateLines: true, variantLines: true } },
        consumables: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      },
    }),
    prisma.shop.findUnique({
      where: { shopId },
      select: { defaultElectricityCostPerKwh: true },
    }),
  ]);
  const defaultElectricityCostPerKwh = shopDefaults?.defaultElectricityCostPerKwh ?? null;

  return jsonResponse({
    equipment: equipment.map((e) => {
      const rates = resolveEquipmentEffectiveRates(e, defaultElectricityCostPerKwh);
      return {
        id: e.id,
        name: e.name,
        hourlyRate: e.hourlyRate?.toString() ?? null,
        effectiveHourlyRate: rates.hourlyRate?.toString() ?? null,
        hourlyRateMode: e.hourlyRateMode,
        perUseCost: e.perUseCost?.toString() ?? null,
        effectivePerUseCost: rates.perUseCost?.toString() ?? null,
        perUseCostMode: e.perUseCostMode,
        usageBasis: e.usageBasis,
        purchaseLink: e.purchaseLink ?? "",
        equipmentCost: e.equipmentCost?.toString() ?? "",
        acquisitionCost: e.acquisitionCost?.toString() ?? "",
        expectedLifespanHours: e.expectedLifespanHours?.toString() ?? "",
        expectedLifespanUnit: e.expectedLifespanUnit,
        salvageValue: e.salvageValue?.toString() ?? "",
        wattsPerOperatingHour: e.wattsPerOperatingHour?.toString() ?? "",
        electricityCostPerKwhOverride: e.electricityCostPerKwhOverride?.toString() ?? "",
        status: e.status,
        notes: e.notes ?? "",
        templateCount: e._count.templateLines,
        variantCount: e._count.variantLines,
        consumables: e.consumables.map((consumable) => ({
          id: consumable.id,
          name: consumable.name,
          replacementCost: consumable.replacementCost.toString(),
          lifespanQuantity: consumable.lifespanQuantity.toString(),
          lifespanUnit: consumable.lifespanUnit,
          sku: consumable.sku ?? "",
          purchaseLink: consumable.purchaseLink ?? "",
          notes: consumable.notes ?? "",
          status: consumable.status,
        })),
      };
    }),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "create" || intent === "update") {
    const parsed = equipmentFormSchema.safeParse({
      name: formData.get("name")?.toString() ?? "",
      purchaseLink: formData.get("purchaseLink")?.toString().trim() ?? "",
      hourlyRateMode: formData.get("hourlyRateMode")?.toString() ?? "calculated",
      perUseCostMode: formData.get("perUseCostMode")?.toString() ?? "calculated",
      usageBasis: formData.get("usageBasis")?.toString() ?? "time_and_unit",
      expectedLifespanUnit: formData.get("expectedLifespanUnit")?.toString() ?? "hours",
    });
    if (!parsed.success) {
      return jsonResponse({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid equipment." }, { status: 400 });
    }

    const name = parsed.data.name;
    const hourlyRateMode = parsed.data.hourlyRateMode;
    const perUseCostMode = parsed.data.perUseCostMode;
    const usageBasis = parsed.data.usageBasis;
    const expectedLifespanUnit = parsed.data.expectedLifespanUnit;
    const hourlyRateStr = formData.get("hourlyRate")?.toString().trim();
    const perUseCostStr = formData.get("perUseCost")?.toString().trim();
    const acquisitionCostStr = formData.get("acquisitionCost")?.toString().trim();
    const expectedLifespanHoursStr = formData.get("expectedLifespanHours")?.toString().trim();
    const salvageValueStr = formData.get("salvageValue")?.toString().trim();
    const wattsPerOperatingHourStr = formData.get("wattsPerOperatingHour")?.toString().trim();
    const electricityCostPerKwhOverrideStr = formData.get("electricityCostPerKwhOverride")?.toString().trim();
    const notes = formData.get("notes")?.toString().trim() || null;
    const purchaseLink = parsed.data.purchaseLink.trim() || null;

    let hourlyRate: Prisma.Decimal | null;
    let perUseCost: Prisma.Decimal | null;
    let acquisitionCost: Prisma.Decimal | null;
    let expectedLifespanHours: Prisma.Decimal | null;
    let salvageValue: Prisma.Decimal | null;
    let wattsPerOperatingHour: Prisma.Decimal | null;
    let electricityCostPerKwhOverride: Prisma.Decimal | null;
    let consumables: ReturnType<typeof parseConsumablesInput>;
    try {
      hourlyRate = parseOptionalNonNegativeMoney(hourlyRateStr, "Hourly rate");
      perUseCost = parseOptionalNonNegativeMoney(perUseCostStr, "Per-use cost");
      acquisitionCost = parseOptionalNonNegativeMoney(acquisitionCostStr, "Acquisition cost");
      expectedLifespanHours = parseOptionalPositiveDecimal(expectedLifespanHoursStr, "Expected lifespan");
      salvageValue = parseOptionalNonNegativeMoney(salvageValueStr, "Salvage value");
      wattsPerOperatingHour = parseOptionalNonNegativeDecimal(wattsPerOperatingHourStr, "Watts per operating hour", 4);
      electricityCostPerKwhOverride = parseOptionalNonNegativeDecimal(
        electricityCostPerKwhOverrideStr,
        "Electricity cost per kWh override",
        6,
      );
      consumables = parseConsumablesInput(formData.get("consumables"), shopId);
    } catch (error) {
      if (error instanceof Response) {
        return jsonResponse({ ok: false, message: await error.text() }, { status: error.status });
      }
      throw error;
    }

    if (hourlyRateMode === "manual" && hourlyRate === null) {
      return jsonResponse(
        { ok: false, message: "Hourly override rate is required when hourly override is enabled." },
        { status: 400 },
      );
    }
    if (perUseCostMode === "manual" && perUseCost === null) {
      return jsonResponse(
        { ok: false, message: "Per-use override cost is required when per-use override is enabled." },
        { status: 400 },
      );
    }

    const hasManualOverride = hourlyRateMode === "manual" || perUseCostMode === "manual";
    const hasCalculatedComponent = acquisitionCost !== null || consumables.length > 0 || wattsPerOperatingHour !== null;
    if (!hasManualOverride && !hasCalculatedComponent) {
      return jsonResponse(
        { ok: false, message: "Add at least one equipment cost component or enable a manual override." },
        { status: 400 },
      );
    }

    const data = {
      shopId,
      name,
      hourlyRate,
      hourlyRateMode,
      perUseCost,
      perUseCostMode,
      usageBasis,
      purchaseLink,
      equipmentCost: acquisitionCost,
      acquisitionCost,
      expectedLifespanHours,
      expectedLifespanUnit,
      salvageValue,
      wattsPerOperatingHour,
      electricityCostPerKwhOverride,
      notes,
    };

    if (intent === "create") {
      try {
        await createEquipmentLibraryItem({
          shopId,
          input: {
            name,
            hourlyRateMode,
            hourlyRate: hourlyRateStr ?? "",
            perUseCostMode,
            perUseCost: perUseCostStr ?? "",
            usageBasis,
            acquisitionCost: acquisitionCostStr ?? "",
            expectedLifespanHours: expectedLifespanHoursStr ?? "",
            expectedLifespanUnit,
            salvageValue: salvageValueStr ?? "",
            wattsPerOperatingHour: wattsPerOperatingHourStr ?? "",
            electricityCostPerKwhOverride: electricityCostPerKwhOverrideStr ?? "",
            consumables: formData.get("consumables")?.toString() ?? "[]",
            purchaseLink: parsed.data.purchaseLink,
            notes: notes ?? "",
          },
        });
      } catch (error) {
        if (error instanceof Response) {
          return jsonResponse({ ok: false, message: await error.text() }, { status: error.status });
        }
        throw error;
      }
      return jsonResponse({ ok: true, message: "Equipment created." });
    }

    const parsedId = equipmentIdSchema.safeParse({ id: formData.get("id")?.toString() ?? "" });
    if (!parsedId.success) {
      return jsonResponse({ ok: false, message: parsedId.error.issues[0]?.message ?? "Invalid equipment." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.equipmentLibraryItem.update({ where: { id: parsedId.data.id, shopId }, data });
      await tx.equipmentConsumable.deleteMany({ where: { shopId, equipmentId: parsedId.data.id } });
      if (consumables.length > 0) {
        await tx.equipmentConsumable.createMany({
          data: consumables.map((consumable) => ({
            shopId,
            equipmentId: parsedId.data.id,
            name: consumable.name,
            replacementCost: consumable.replacementCost,
            lifespanQuantity: consumable.lifespanQuantity,
            lifespanUnit: consumable.lifespanUnit,
            sku: consumable.sku,
            purchaseLink: consumable.purchaseLink,
            notes: consumable.notes,
            sortOrder: consumable.sortOrder,
            status: consumable.status,
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          shopId,
          entity: "EquipmentLibraryItem",
          entityId: parsedId.data.id,
          action: "EQUIPMENT_UPDATED",
          actor: "merchant",
        },
      });
    });
    return jsonResponse({ ok: true, message: "Equipment updated." });
  }

  if (intent === "deactivate" || intent === "reactivate") {
    const parsed = equipmentIdSchema.safeParse({ id: formData.get("id")?.toString() ?? "" });
    if (!parsed.success) {
      return jsonResponse({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid equipment." }, { status: 400 });
    }
    const id = parsed.data.id;
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
    return jsonResponse({
      ok: true,
      message: intent === "deactivate" ? "Equipment deactivated." : "Equipment reactivated.",
    });
  }

  if (intent === "delete") {
    const parsed = equipmentIdSchema.safeParse({ id: formData.get("id")?.toString() ?? "" });
    if (!parsed.success) {
      return jsonResponse({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid equipment." }, { status: 400 });
    }

    const item = await prisma.equipmentLibraryItem.findFirst({
      where: { id: parsed.data.id, shopId },
      include: {
        _count: { select: { templateLines: true, variantLines: true } },
      },
    });

    if (!item) {
      return jsonResponse({ ok: false, message: "Equipment not found." }, { status: 404 });
    }

    if (item._count.templateLines > 0 || item._count.variantLines > 0) {
      return jsonResponse(
        {
          ok: false,
          message: `This equipment is still used in ${item._count.templateLines} template(s) and ${item._count.variantLines} variant config(s). Remove those references before deleting it.`,
        },
        { status: 400 },
      );
    }

    await prisma.equipmentLibraryItem.delete({ where: { id: item.id, shopId } });
    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "EquipmentLibraryItem",
        entityId: item.id,
        action: "EQUIPMENT_DELETED",
        actor: "merchant",
      },
    });

    return jsonResponse({ ok: true, message: "Equipment deleted." });
  }

  return jsonResponse({ ok: false, message: "Unknown action." }, { status: 400 });
};

type EquipmentItem = {
  id: string;
  name: string;
  hourlyRate: string | null;
  effectiveHourlyRate: string | null;
  hourlyRateMode: string;
  perUseCost: string | null;
  effectivePerUseCost: string | null;
  perUseCostMode: string;
  usageBasis: string;
  purchaseLink: string;
  equipmentCost: string;
  acquisitionCost: string;
  expectedLifespanHours: string;
  expectedLifespanUnit: string;
  salvageValue: string;
  wattsPerOperatingHour: string;
  electricityCostPerKwhOverride: string;
  status: string;
  notes: string;
  templateCount: number;
  variantCount: number;
  consumables: EquipmentConsumableFormRow[];
};

type EquipmentConsumableFormRow = {
  id?: string;
  name: string;
  replacementCost: string;
  lifespanQuantity: string;
  lifespanUnit: "hours" | "uses";
  sku: string;
  purchaseLink: string;
  notes: string;
};

const EMPTY_FORM = {
  id: "",
  name: "",
  hourlyRateMode: "calculated",
  hourlyRate: "",
  perUseCostMode: "calculated",
  perUseCost: "",
  usageBasis: "time_and_unit",
  purchaseLink: "",
  equipmentCost: "",
  acquisitionCost: "",
  expectedLifespanHours: "",
  expectedLifespanUnit: "hours",
  salvageValue: "",
  wattsPerOperatingHour: "",
  electricityCostPerKwhOverride: "",
  consumables: [] as EquipmentConsumableFormRow[],
  notes: "",
};

type EquipmentActionIntent = "create" | "update" | "deactivate" | "delete" | "reactivate";

export default function EquipmentPage() {
  const { equipment } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const { formatMoney, getCurrencySymbol } = useAppLocalization();
  const equipmentDialogRef = useRef<HTMLDialogElement>(null);
  const deactivateDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [deactivateTarget, setDeactivateTarget] = useState<EquipmentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EquipmentItem | null>(null);
  const [deleteSubmitPending, setDeleteSubmitPending] = useState(false);
  const [equipmentDialogOpen, setEquipmentDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [lastSubmittedIntent, setLastSubmittedIntent] = useState<EquipmentActionIntent | null>(null);

  useEffect(() => {
    const dialog = equipmentDialogRef.current;
    if (!dialog) return;

    if (equipmentDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!equipmentDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [equipmentDialogOpen]);

  useEffect(() => {
    const dialog = deactivateDialogRef.current;
    if (!dialog) return;

    if (deactivateDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!deactivateDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [deactivateDialogOpen]);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;

    if (deleteDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!deleteDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [deleteDialogOpen]);

  useEffect(() => {
    if (deleteDialogOpen && deleteSubmitPending && fetcher.state === "idle" && fetcher.data?.ok) {
      setDeleteSubmitPending(false);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      setLastSubmittedIntent(null);
    }
  }, [deleteDialogOpen, deleteSubmitPending, fetcher.state, fetcher.data]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok) return;

    if (lastSubmittedIntent === "create" || lastSubmittedIntent === "update") {
      setEquipmentDialogOpen(false);
      setForm(EMPTY_FORM);
      setLastSubmittedIntent(null);
    }

    if (lastSubmittedIntent === "deactivate") {
      setDeactivateDialogOpen(false);
      setDeactivateTarget(null);
      setLastSubmittedIntent(null);
    }
  }, [fetcher.state, fetcher.data, lastSubmittedIntent]);

  function updateForm<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addConsumable() {
    setForm((current) => ({
      ...current,
      consumables: [
        ...current.consumables,
        {
          name: "",
          replacementCost: "",
          lifespanQuantity: "",
          lifespanUnit: "hours",
          sku: "",
          purchaseLink: "",
          notes: "",
        },
      ],
    }));
  }

  function updateConsumable<K extends keyof EquipmentConsumableFormRow>(
    index: number,
    key: K,
    value: EquipmentConsumableFormRow[K],
  ) {
    setForm((current) => ({
      ...current,
      consumables: current.consumables.map((consumable, currentIndex) =>
        currentIndex === index ? { ...consumable, [key]: value } : consumable,
      ),
    }));
  }

  function removeConsumable(index: number) {
    setForm((current) => ({
      ...current,
      consumables: current.consumables.filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEquipmentDialogOpen(true);
  }

  function openEdit(item: EquipmentItem) {
    setForm({
      id: item.id,
      name: item.name,
      hourlyRateMode: item.hourlyRateMode,
      hourlyRate: item.hourlyRate ?? "",
      perUseCostMode: item.perUseCostMode,
      perUseCost: item.perUseCost ?? "",
      usageBasis: item.usageBasis,
      purchaseLink: item.purchaseLink,
      equipmentCost: normalizeFixedDecimalInput(item.equipmentCost),
      acquisitionCost: normalizeFixedDecimalInput(item.acquisitionCost || item.equipmentCost),
      expectedLifespanHours: item.expectedLifespanHours,
      expectedLifespanUnit: item.expectedLifespanUnit,
      salvageValue: normalizeFixedDecimalInput(item.salvageValue),
      wattsPerOperatingHour: item.wattsPerOperatingHour,
      electricityCostPerKwhOverride: item.electricityCostPerKwhOverride,
      consumables: item.consumables.map((consumable) => ({
        id: consumable.id,
        name: consumable.name,
        replacementCost: normalizeFixedDecimalInput(consumable.replacementCost),
        lifespanQuantity: consumable.lifespanQuantity,
        lifespanUnit: consumable.lifespanUnit === "uses" ? "uses" : "hours",
        sku: consumable.sku,
        purchaseLink: consumable.purchaseLink,
        notes: consumable.notes,
      })),
      notes: item.notes,
    });
    setEquipmentDialogOpen(true);
  }

  function confirmDeactivate(item: EquipmentItem) {
    setDeactivateTarget(item);
    setDeactivateDialogOpen(true);
  }

  function confirmDelete(item: EquipmentItem) {
    setDeleteSubmitPending(false);
    setDeleteTarget(item);
    setDeleteDialogOpen(true);
  }

  const closeEquipmentDialog = useCallback(() => {
    setEquipmentDialogOpen(false);
    setForm(EMPTY_FORM);
    if (lastSubmittedIntent === "create" || lastSubmittedIntent === "update") {
      setLastSubmittedIntent(null);
    }
  }, [lastSubmittedIntent]);

  const closeDeactivateDialog = useCallback(() => {
    setDeactivateDialogOpen(false);
    setDeactivateTarget(null);
    if (lastSubmittedIntent === "deactivate") {
      setLastSubmittedIntent(null);
    }
  }, [lastSubmittedIntent]);

  function closeDeleteDialog() {
    setDeleteSubmitPending(false);
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
    if (lastSubmittedIntent === "delete") {
      setLastSubmittedIntent(null);
    }
  }

  const isSubmitting = fetcher.state !== "idle";
  const statusMessage = fetcher.data?.message ?? "";
  const showPageError = fetcher.data && !fetcher.data.ok && !(
    lastSubmittedIntent === "create" ||
    lastSubmittedIntent === "update" ||
    lastSubmittedIntent === "deactivate" ||
    lastSubmittedIntent === "delete"
  );
  const pageErrorMessage = showPageError ? fetcher.data?.message : null;

  return (
    <>
      <ui-title-bar title="Equipment Library">
        <button type="button" onClick={openCreate}>New equipment</button>
      </ui-title-bar>

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
        }}
      >
        {statusMessage}
      </div>

      <s-page>
        {pageErrorMessage && (
          <s-banner tone="critical">
            <s-text>{pageErrorMessage}</s-text>
          </s-banner>
        )}

        {equipment.length === 0 ? (
          <s-section heading="No equipment yet">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text>Add equipment such as presses, printers, and embroidery machines to variant costing.</s-text>
              <div>
                <s-button variant="primary" onClick={openCreate}>Add first equipment</s-button>
              </div>
            </div>
          </s-section>
        ) : (
          <s-section padding="none">
            <s-table>
              <ResourceTableHeader
                title="Equipment Library"
                description="Reusable equipment costs for templates and variant configurations."
                action={<s-button variant="primary" onClick={openCreate}>New equipment</s-button>}
              />

              <s-table-header-row>
                <s-table-header listSlot="primary">Name</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Hourly rate</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Per-use cost</s-table-header>
                <s-table-header listSlot="secondary">Usage basis</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Acquisition cost</s-table-header>
                <s-table-header listSlot="secondary">Purchase link</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Used by</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {equipment.map((item: EquipmentItem) => (
                  <s-table-row key={item.id}>
                    <s-table-cell>{item.name}</s-table-cell>
                    <s-table-cell>{item.effectiveHourlyRate ? `${formatMoney(item.effectiveHourlyRate)}/hr` : "—"}</s-table-cell>
                    <s-table-cell>{item.effectivePerUseCost ? `${formatMoney(item.effectivePerUseCost)}/use` : "—"}</s-table-cell>
                    <s-table-cell>{usageBasisLabel(item.usageBasis)}</s-table-cell>
                    <s-table-cell>{item.acquisitionCost || item.equipmentCost ? formatMoney(item.acquisitionCost || item.equipmentCost) : "—"}</s-table-cell>
                    <s-table-cell>
                      {item.purchaseLink ? (
                        <a href={item.purchaseLink} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </s-table-cell>
                    <s-table-cell>{item.templateCount + item.variantCount} uses</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={item.status === "active" ? "success" : "enabled"}>
                        {item.status === "active" ? "Active" : "Inactive"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <s-button variant="secondary" onClick={() => openEdit(item)}>Edit</s-button>
                        {item.status === "active" ? (
                          <s-button tone="critical" variant="secondary" onClick={() => confirmDeactivate(item)}>
                            Deactivate
                          </s-button>
                        ) : (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="reactivate" />
                            <input type="hidden" name="id" value={item.id} />
                            <s-button type="submit" variant="secondary" disabled={isSubmitting}>Reactivate</s-button>
                          </fetcher.Form>
                        )}
                        {item.templateCount + item.variantCount === 0 ? (
                          <s-button tone="critical" variant="secondary" onClick={() => confirmDelete(item)}>
                            Delete
                          </s-button>
                        ) : (
                          <s-text color="subdued">Delete unavailable while in use</s-text>
                        )}
                      </div>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        )}
      </s-page>

      <dialog
        ref={equipmentDialogRef}
        onClose={closeEquipmentDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "40rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>{form.id ? "Edit equipment" : "New equipment"}</strong>
              <s-text color="subdued">Define hourly and fixed per-use costs used in template and variant calculations.</s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeEquipmentDialog}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "1.5rem",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          {fetcher.data && !fetcher.data.ok && (lastSubmittedIntent === "create" || lastSubmittedIntent === "update") ? (
            <s-banner tone="critical">
              <s-text>{fetcher.data.message}</s-text>
            </s-banner>
          ) : null}

          <s-text-field
            label="Name"
            value={form.name}
            onChange={(event) => updateForm("name", (event.target as HTMLInputElement | null)?.value ?? "")}
          />

          <s-text color="subdued">
            Equipment components are included automatically. Enable an override only when a known rate should replace the calculated value.
          </s-text>

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="usage-basis">Usage basis</label>
            <select
              id="usage-basis"
              value={form.usageBasis}
              onChange={(event) => {
                const nextUsageBasis = event.currentTarget.value;
                setForm((current) => ({
                  ...current,
                  usageBasis: nextUsageBasis,
                  expectedLifespanUnit:
                    nextUsageBasis === "time" ? "hours" : nextUsageBasis === "unit" ? "uses" : current.expectedLifespanUnit,
                }));
              }}
              style={dialogFieldStyle}
            >
              {EQUIPMENT_USAGE_BASIS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <s-text color="subdued">Controls which usage inputs appear when adding this equipment to templates and variants.</s-text>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            <div style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
              <label
                htmlFor="hourly-rate-override"
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
              >
                <input
                  id="hourly-rate-override"
                  type="checkbox"
                  checked={form.hourlyRateMode === "manual"}
                  onChange={(event) =>
                    updateForm("hourlyRateMode", event.currentTarget.checked ? "manual" : "calculated")
                  }
                />
                <span>Override hourly rate</span>
              </label>
              <s-text color="subdued">Calculated hourly rates include hour-based lifespan reserve, electricity, and hourly consumables.</s-text>
            </div>
            <s-text-field
              label={`Hourly override (${getCurrencySymbol()}/hr)`}
              type="number"
              min={0}
              step={0.01}
              value={form.hourlyRate}
              disabled={form.hourlyRateMode !== "manual"}
              onChange={(event) =>
                updateForm("hourlyRate", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              onBlur={(event) =>
                updateForm("hourlyRate", normalizeFixedDecimalInput((event.target as HTMLInputElement | null)?.value ?? ""))
              }
              details="Replaces the calculated hourly rate when enabled."
            />
            <div style={{ display: "grid", gap: "0.5rem", alignContent: "start" }}>
              <label
                htmlFor="per-use-cost-override"
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
              >
                <input
                  id="per-use-cost-override"
                  type="checkbox"
                  checked={form.perUseCostMode === "manual"}
                  onChange={(event) =>
                    updateForm("perUseCostMode", event.currentTarget.checked ? "manual" : "calculated")
                  }
                />
                <span>Override per-use cost</span>
              </label>
              <s-text color="subdued">Calculated per-use costs include use-based lifespan reserve and consumables.</s-text>
            </div>
            <s-text-field
              label={`Per-use override (${getCurrencySymbol()})`}
              type="number"
              min={0}
              step={0.01}
              value={form.perUseCost}
              disabled={form.perUseCostMode !== "manual"}
              onChange={(event) =>
                updateForm("perUseCost", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              onBlur={(event) =>
                updateForm("perUseCost", normalizeFixedDecimalInput((event.target as HTMLInputElement | null)?.value ?? ""))
              }
              details="Replaces the calculated per-use cost when enabled."
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            <s-text-field
              label={`Acquisition cost (${getCurrencySymbol()})`}
              type="number"
              min={0}
              step={0.01}
              value={form.acquisitionCost}
              onChange={(event) =>
                updateForm("acquisitionCost", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              onBlur={(event) =>
                updateForm(
                  "acquisitionCost",
                  normalizeFixedDecimalInput((event.target as HTMLInputElement | null)?.value ?? ""),
                )
              }
              details="Used with lifespan to calculate replacement reserve."
            />
            <s-text-field
              label="Expected lifespan"
              type="number"
              min={0}
              step={0.0001}
              value={form.expectedLifespanHours}
              onChange={(event) =>
                updateForm("expectedLifespanHours", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              details={form.expectedLifespanUnit === "uses" ? "Example: 10000 uses." : "Example: 5000 hours."}
            />
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="expected-lifespan-unit">Lifespan unit</label>
              <select
                id="expected-lifespan-unit"
                value={form.expectedLifespanUnit}
                onChange={(event) => updateForm("expectedLifespanUnit", event.currentTarget.value)}
                style={dialogFieldStyle}
              >
                <option value="hours">Hours</option>
                <option value="uses">Uses</option>
              </select>
              <s-text color="subdued">
                Determines whether acquisition cost is allocated per operating hour or per equipment use.
              </s-text>
            </div>
            <s-text-field
              label={`Salvage value (${getCurrencySymbol()})`}
              type="number"
              min={0}
              step={0.01}
              value={form.salvageValue}
              onChange={(event) =>
                updateForm("salvageValue", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              onBlur={(event) =>
                updateForm("salvageValue", normalizeFixedDecimalInput((event.target as HTMLInputElement | null)?.value ?? ""))
              }
            />
            <s-text-field
              label="Equipment purchase link"
              type="url"
              value={form.purchaseLink}
              onChange={(event) =>
                updateForm("purchaseLink", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              details="Optional vendor or catalog URL for reordering or reference."
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            <s-text-field
              label="Watts per operating hour"
              type="number"
              min={0}
              step={0.0001}
              value={form.wattsPerOperatingHour}
              onChange={(event) =>
                updateForm("wattsPerOperatingHour", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              details="Average active draw in watts."
            />
            <s-text-field
              label={`Electricity override (${getCurrencySymbol()}/kWh)`}
              type="number"
              min={0}
              step={0.000001}
              value={form.electricityCostPerKwhOverride}
              onChange={(event) =>
                updateForm("electricityCostPerKwhOverride", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              details="Leave blank to use the shop default."
            />
          </div>

          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
              <strong>Consumables</strong>
              <s-button variant="secondary" onClick={addConsumable}>Add consumable</s-button>
            </div>
            {form.consumables.length === 0 ? (
              <s-text color="subdued">Add filters, blades, nozzles, mats, or other equipment-specific consumables.</s-text>
            ) : (
              form.consumables.map((consumable, index) => (
                <div
                  key={consumable.id ?? index}
                  style={{
                    display: "grid",
                    gap: "0.75rem",
                    padding: "0.75rem",
                    border: "1px solid var(--p-color-border, #d2d5d8)",
                    borderRadius: "0.5rem",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "0.75rem",
                    }}
                  >
                    <s-text-field
                      label="Name"
                      value={consumable.name}
                      onChange={(event) =>
                        updateConsumable(index, "name", (event.target as HTMLInputElement | null)?.value ?? "")
                      }
                    />
                    <s-text-field
                      label={`Replacement cost (${getCurrencySymbol()})`}
                      type="number"
                      min={0}
                      step={0.01}
                      value={consumable.replacementCost}
                      onChange={(event) =>
                        updateConsumable(index, "replacementCost", (event.target as HTMLInputElement | null)?.value ?? "")
                      }
                      onBlur={(event) =>
                        updateConsumable(
                          index,
                          "replacementCost",
                          normalizeFixedDecimalInput((event.target as HTMLInputElement | null)?.value ?? ""),
                        )
                      }
                    />
                    <s-text-field
                      label="Lifespan"
                      type="number"
                      min={0}
                      step={0.0001}
                      value={consumable.lifespanQuantity}
                      onChange={(event) =>
                        updateConsumable(index, "lifespanQuantity", (event.target as HTMLInputElement | null)?.value ?? "")
                      }
                    />
                    <div style={{ display: "grid", gap: "0.35rem" }}>
                      <label htmlFor={`consumable-unit-${index}`}>Lifespan unit</label>
                      <select
                        id={`consumable-unit-${index}`}
                        value={consumable.lifespanUnit}
                        onChange={(event) =>
                          updateConsumable(
                            index,
                            "lifespanUnit",
                            event.currentTarget.value === "uses" ? "uses" : "hours",
                          )
                        }
                        style={dialogFieldStyle}
                      >
                        <option value="hours">Hours</option>
                        <option value="uses">Uses</option>
                      </select>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "0.75rem",
                    }}
                  >
                    <s-text-field
                      label="SKU"
                      value={consumable.sku}
                      onChange={(event) =>
                        updateConsumable(index, "sku", (event.target as HTMLInputElement | null)?.value ?? "")
                      }
                    />
                    <s-text-field
                      label="Purchase link"
                      type="url"
                      value={consumable.purchaseLink}
                      onChange={(event) =>
                        updateConsumable(index, "purchaseLink", (event.target as HTMLInputElement | null)?.value ?? "")
                      }
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <s-button tone="critical" variant="secondary" onClick={() => removeConsumable(index)}>
                      Remove
                    </s-button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="equipment-notes">Notes</label>
            <textarea
              id="equipment-notes"
              rows={4}
              value={form.notes}
              onChange={(event) => updateForm("notes", event.currentTarget.value)}
                style={{
                  ...dialogFieldStyle,
                  resize: "vertical",
                }}
              />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={closeEquipmentDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              disabled={isSubmitting}
              onClick={() => {
                const fd = new FormData();
                fd.append("intent", form.id ? "update" : "create");
                if (form.id) fd.append("id", form.id);
                fd.append("name", form.name);
                fd.append("hourlyRateMode", form.hourlyRateMode);
                if (form.hourlyRate) fd.append("hourlyRate", form.hourlyRate);
                fd.append("perUseCostMode", form.perUseCostMode);
                if (form.perUseCost) fd.append("perUseCost", form.perUseCost);
                fd.append("usageBasis", form.usageBasis);
                fd.append("purchaseLink", form.purchaseLink);
                if (form.acquisitionCost) fd.append("acquisitionCost", form.acquisitionCost);
                if (form.expectedLifespanHours) fd.append("expectedLifespanHours", form.expectedLifespanHours);
                fd.append("expectedLifespanUnit", form.expectedLifespanUnit);
                if (form.salvageValue) fd.append("salvageValue", form.salvageValue);
                if (form.wattsPerOperatingHour) fd.append("wattsPerOperatingHour", form.wattsPerOperatingHour);
                if (form.electricityCostPerKwhOverride) {
                  fd.append("electricityCostPerKwhOverride", form.electricityCostPerKwhOverride);
                }
                fd.append("consumables", JSON.stringify(form.consumables));
                fd.append("notes", form.notes);
                setLastSubmittedIntent(form.id ? "update" : "create");
                fetcher.submit(fd, { method: "post" });
              }}
            >
              {form.id ? "Save" : "Create"}
            </s-button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={deactivateDialogRef}
        onClose={closeDeactivateDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "32rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>Deactivate equipment</strong>
              <s-text color="subdued">Hide this equipment from new configurations while preserving existing calculations.</s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeDeactivateDialog}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "1.5rem",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          {fetcher.data && !fetcher.data.ok && lastSubmittedIntent === "deactivate" ? (
            <s-banner tone="critical">
              <s-text>{fetcher.data.message}</s-text>
            </s-banner>
          ) : null}

          <s-text>
            {deactivateTarget
              ? `Deactivating ${deactivateTarget.name} will hide it from new configurations.`
              : "Deactivating this equipment will hide it from new configurations."}
          </s-text>

          {deactivateTarget && deactivateTarget.templateCount + deactivateTarget.variantCount > 0 && (
            <s-banner tone="warning">
              <s-text>
                This equipment is currently used in {deactivateTarget.templateCount} template(s) and {deactivateTarget.variantCount} variant config(s). Existing cost calculations will not be affected.
              </s-text>
            </s-banner>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={closeDeactivateDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              tone="critical"
              disabled={isSubmitting}
              onClick={() => {
                if (!deactivateTarget) return;
                const fd = new FormData();
                fd.append("intent", "deactivate");
                fd.append("id", deactivateTarget.id);
                setLastSubmittedIntent("deactivate");
                fetcher.submit(fd, { method: "post" });
              }}
            >
              Deactivate
            </s-button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={deleteDialogRef}
        onClose={closeDeleteDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "32rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>Delete equipment</strong>
              <s-text color="subdued">Delete this equipment permanently when it is no longer referenced by templates or variants.</s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeDeleteDialog}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "1.5rem",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          {fetcher.data && !fetcher.data.ok && deleteDialogOpen ? (
            <s-banner tone="critical">
              <s-text>{fetcher.data.message}</s-text>
            </s-banner>
          ) : null}

          <s-text>
            {deleteTarget
              ? `Delete ${deleteTarget.name} permanently? This cannot be undone.`
              : "Delete this equipment permanently? This cannot be undone."}
          </s-text>

          {deleteTarget && deleteTarget.templateCount + deleteTarget.variantCount > 0 ? (
            <s-banner tone="warning">
              <s-text>
                This equipment is still used in {deleteTarget.templateCount} template(s) and {deleteTarget.variantCount} variant config(s), so deletion is blocked.
              </s-text>
            </s-banner>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={closeDeleteDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              tone="critical"
              disabled={isSubmitting || (deleteTarget ? deleteTarget.templateCount + deleteTarget.variantCount > 0 : true)}
              onClick={() => {
                if (!deleteTarget) return;
                const fd = new FormData();
                fd.append("intent", "delete");
                fd.append("id", deleteTarget.id);
                setDeleteSubmitPending(true);
                setLastSubmittedIntent("delete");
                fetcher.submit(fd, { method: "post" });
              }}
            >
              Delete
            </s-button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Equipment] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Equipment Library" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading equipment. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
