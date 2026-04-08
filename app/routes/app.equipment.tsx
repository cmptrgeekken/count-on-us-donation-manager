import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { normalizeFixedDecimalInput } from "../utils/input-formatting";
import { parseOptionalNonNegativeMoney } from "../utils/money-parsing";
import { useAppLocalization } from "../utils/use-app-localization";

const equipmentIdSchema = z.object({
  id: z.string().trim().cuid("Equipment id is invalid."),
});

const equipmentFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  purchaseLink: z.union([z.literal(""), z.url({ message: "Equipment purchase link must be a valid URL." })]),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
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
      purchaseLink: e.purchaseLink ?? "",
      equipmentCost: e.equipmentCost?.toString() ?? "",
      status: e.status,
      notes: e.notes ?? "",
      templateCount: e._count.templateLines,
      variantCount: e._count.variantLines,
    })),
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
    });
    if (!parsed.success) {
      return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid equipment." }, { status: 400 });
    }

    const name = parsed.data.name;
    const hourlyRateStr = formData.get("hourlyRate")?.toString().trim();
    const perUseCostStr = formData.get("perUseCost")?.toString().trim();
    const equipmentCostStr = formData.get("equipmentCost")?.toString().trim();
    const notes = formData.get("notes")?.toString().trim() || null;
    const purchaseLink = parsed.data.purchaseLink.trim() || null;

    let hourlyRate: Prisma.Decimal | null;
    let perUseCost: Prisma.Decimal | null;
    let equipmentCost: Prisma.Decimal | null;
    try {
      hourlyRate = parseOptionalNonNegativeMoney(hourlyRateStr, "Hourly rate");
      perUseCost = parseOptionalNonNegativeMoney(perUseCostStr, "Per-use cost");
      equipmentCost = parseOptionalNonNegativeMoney(equipmentCostStr, "Equipment cost");
    } catch (error) {
      if (error instanceof Response) {
        return Response.json({ ok: false, message: await error.text() }, { status: error.status });
      }
      throw error;
    }

    if (hourlyRate === null && perUseCost === null) {
      return Response.json(
        { ok: false, message: "At least one of hourly rate or per-use cost must be set." },
        { status: 400 },
      );
    }

    const data = {
      shopId,
      name,
      hourlyRate,
      perUseCost,
      purchaseLink,
      equipmentCost,
      notes,
    };

    if (intent === "create") {
      const item = await prisma.equipmentLibraryItem.create({ data });
      await prisma.auditLog.create({
        data: {
          shopId,
          entity: "EquipmentLibraryItem",
          entityId: item.id,
          action: "EQUIPMENT_CREATED",
          actor: "merchant",
        },
      });
      return Response.json({ ok: true, message: "Equipment created." });
    }

    const id = formData.get("id")?.toString() ?? "";
    await prisma.equipmentLibraryItem.update({ where: { id, shopId }, data });
    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "EquipmentLibraryItem",
        entityId: id,
        action: "EQUIPMENT_UPDATED",
        actor: "merchant",
      },
    });
    return Response.json({ ok: true, message: "Equipment updated." });
  }

  if (intent === "deactivate" || intent === "reactivate") {
    const parsed = equipmentIdSchema.safeParse({ id: formData.get("id")?.toString() ?? "" });
    if (!parsed.success) {
      return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid equipment." }, { status: 400 });
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
    return Response.json({
      ok: true,
      message: intent === "deactivate" ? "Equipment deactivated." : "Equipment reactivated.",
    });
  }

  if (intent === "delete") {
    const parsed = equipmentIdSchema.safeParse({ id: formData.get("id")?.toString() ?? "" });
    if (!parsed.success) {
      return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid equipment." }, { status: 400 });
    }

    const item = await prisma.equipmentLibraryItem.findFirst({
      where: { id: parsed.data.id, shopId },
      include: {
        _count: { select: { templateLines: true, variantLines: true } },
      },
    });

    if (!item) {
      return Response.json({ ok: false, message: "Equipment not found." }, { status: 404 });
    }

    if (item._count.templateLines > 0 || item._count.variantLines > 0) {
      return Response.json(
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

    return Response.json({ ok: true, message: "Equipment deleted." });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

type EquipmentItem = {
  id: string;
  name: string;
  hourlyRate: string | null;
  perUseCost: string | null;
  purchaseLink: string;
  equipmentCost: string;
  status: string;
  notes: string;
  templateCount: number;
  variantCount: number;
};

const EMPTY_FORM = {
  id: "",
  name: "",
  hourlyRate: "",
  perUseCost: "",
  purchaseLink: "",
  equipmentCost: "",
  notes: "",
};

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
    }
  }, [deleteDialogOpen, deleteSubmitPending, fetcher.state, fetcher.data]);

  function updateForm<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEquipmentDialogOpen(true);
  }

  function openEdit(item: EquipmentItem) {
    setForm({
      id: item.id,
      name: item.name,
      hourlyRate: item.hourlyRate ?? "",
      perUseCost: item.perUseCost ?? "",
      purchaseLink: item.purchaseLink,
      equipmentCost: normalizeFixedDecimalInput(item.equipmentCost),
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

  function closeEquipmentDialog() {
    setEquipmentDialogOpen(false);
    setForm(EMPTY_FORM);
  }

  function closeDeactivateDialog() {
    setDeactivateDialogOpen(false);
    setDeactivateTarget(null);
  }

  function closeDeleteDialog() {
    setDeleteSubmitPending(false);
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
  }

  const isSubmitting = fetcher.state !== "idle";
  const statusMessage = fetcher.data?.message ?? "";

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
        {fetcher.data && !fetcher.data.ok && !deleteDialogOpen && (
          <s-banner tone="critical">
            <s-text>{fetcher.data.message}</s-text>
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
              <div
                slot="filters"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "1rem",
                }}
              >
                <div style={{ display: "grid", gap: "0.2rem" }}>
                  <strong>Equipment Library</strong>
                  <s-text color="subdued">Reusable equipment costs for templates and variant configurations.</s-text>
                </div>
                <s-button variant="primary" onClick={openCreate}>New equipment</s-button>
              </div>

              <s-table-header-row>
                <s-table-header listSlot="primary">Name</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Hourly rate</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Per-use cost</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Equipment cost</s-table-header>
                <s-table-header listSlot="secondary">Purchase link</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Used by</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {equipment.map((item: EquipmentItem) => (
                  <s-table-row key={item.id}>
                    <s-table-cell>{item.name}</s-table-cell>
                    <s-table-cell>{item.hourlyRate ? `${formatMoney(item.hourlyRate)}/hr` : "—"}</s-table-cell>
                    <s-table-cell>{item.perUseCost ? `${formatMoney(item.perUseCost)}/use` : "—"}</s-table-cell>
                    <s-table-cell>{item.equipmentCost ? formatMoney(item.equipmentCost) : "—"}</s-table-cell>
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

          <s-text-field
            label="Name"
            value={form.name}
            onChange={(event) => updateForm("name", (event.target as HTMLInputElement | null)?.value ?? "")}
          />

          <s-text color="subdued">Set at least one of the following rate fields.</s-text>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            <s-text-field
              label={`Hourly rate (${getCurrencySymbol()})`}
              type="number"
              min={0}
              step={0.01}
              value={form.hourlyRate}
              onChange={(event) =>
                updateForm("hourlyRate", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              onBlur={(event) =>
                updateForm("hourlyRate", normalizeFixedDecimalInput((event.target as HTMLInputElement | null)?.value ?? ""))
              }
              details="Cost per hour of use."
            />
            <s-text-field
              label={`Per-use cost (${getCurrencySymbol()})`}
              type="number"
              min={0}
              step={0.01}
              value={form.perUseCost}
              onChange={(event) =>
                updateForm("perUseCost", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              onBlur={(event) =>
                updateForm("perUseCost", normalizeFixedDecimalInput((event.target as HTMLInputElement | null)?.value ?? ""))
              }
              details="Fixed cost per use, e.g. consumable wear."
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
              label={`Equipment cost (${getCurrencySymbol()})`}
              type="number"
              min={0}
              step={0.01}
              value={form.equipmentCost}
              onChange={(event) =>
                updateForm("equipmentCost", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              onBlur={(event) =>
                updateForm(
                  "equipmentCost",
                  normalizeFixedDecimalInput((event.target as HTMLInputElement | null)?.value ?? ""),
                )
              }
              details="Reference purchase cost for the equipment itself."
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

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="equipment-notes">Notes</label>
            <textarea
              id="equipment-notes"
              rows={4}
              value={form.notes}
              onChange={(event) => updateForm("notes", event.currentTarget.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "0.75rem",
                  borderRadius: "0.75rem",
                  border: "1px solid var(--p-color-border)",
                  background: "var(--p-color-bg-surface, #fff)",
                  color: "var(--p-color-text, #303030)",
                  font: "inherit",
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
                if (form.hourlyRate) fd.append("hourlyRate", form.hourlyRate);
                if (form.perUseCost) fd.append("perUseCost", form.perUseCost);
                fd.append("purchaseLink", form.purchaseLink);
                if (form.equipmentCost) fd.append("equipmentCost", form.equipmentCost);
                fd.append("notes", form.notes);
                fetcher.submit(fd, { method: "post" });
                closeEquipmentDialog();
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
                fetcher.submit(fd, { method: "post" });
                closeDeactivateDialog();
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
