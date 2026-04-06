import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { normalizeFixedDecimalInput } from "../utils/input-formatting";
import { useAppLocalization } from "../utils/use-app-localization";

const materialIdSchema = z.object({
  id: z.string().trim().cuid("Material id is invalid."),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "create" || intent === "update") {
    const name = formData.get("name")?.toString().trim() ?? "";
    const type = formData.get("type")?.toString() ?? "production";
    const rawCostingModel = formData.get("costingModel")?.toString() ?? "yield";
    const costingModel = rawCostingModel === "uses" ? "uses" : "yield";
    const purchasePrice = parseFloat(formData.get("purchasePrice")?.toString() ?? "0");
    const purchaseQty = parseFloat(formData.get("purchaseQty")?.toString() ?? "1");
    const totalUsesPerUnit =
      costingModel === "uses"
        ? parseFloat(formData.get("totalUsesPerUnit")?.toString() ?? "0")
        : null;
    const unitDescription = formData.get("unitDescription")?.toString().trim() || null;
    const notes = formData.get("notes")?.toString().trim() || null;

    if (!name) {
      return Response.json({ ok: false, message: "Name is required." }, { status: 400 });
    }
    if (isNaN(purchasePrice) || purchasePrice <= 0) {
      return Response.json({ ok: false, message: "Purchase price must be greater than 0." }, { status: 400 });
    }
    if (isNaN(purchaseQty) || purchaseQty <= 0) {
      return Response.json({ ok: false, message: "Purchase quantity must be greater than 0." }, { status: 400 });
    }
    if (
      costingModel === "uses" &&
      (totalUsesPerUnit === null || isNaN(totalUsesPerUnit) || totalUsesPerUnit <= 0)
    ) {
      return Response.json(
        { ok: false, message: "Total uses per unit must be greater than 0 for uses-based costing." },
        { status: 400 },
      );
    }

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
        data: {
          shopId,
          entity: "MaterialLibraryItem",
          entityId: material.id,
          action: "MATERIAL_CREATED",
          actor: "merchant",
        },
      });
      return Response.json({ ok: true, message: "Material created." });
    }

    const id = formData.get("id")?.toString() ?? "";
    await prisma.materialLibraryItem.update({ where: { id, shopId }, data });
    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "MaterialLibraryItem",
        entityId: id,
        action: "MATERIAL_UPDATED",
        actor: "merchant",
      },
    });
    return Response.json({ ok: true, message: "Material updated." });
  }

  if (intent === "deactivate" || intent === "reactivate") {
    const parsed = materialIdSchema.safeParse({ id: formData.get("id")?.toString() ?? "" });
    if (!parsed.success) {
      return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid material." }, { status: 400 });
    }
    const id = parsed.data.id;
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
    return Response.json({
      ok: true,
      message: intent === "deactivate" ? "Material deactivated." : "Material reactivated.",
    });
  }

  if (intent === "delete") {
    const parsed = materialIdSchema.safeParse({ id: formData.get("id")?.toString() ?? "" });
    if (!parsed.success) {
      return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid material." }, { status: 400 });
    }

    const material = await prisma.materialLibraryItem.findFirst({
      where: { id: parsed.data.id, shopId },
      include: {
        _count: { select: { templateLines: true, variantLines: true } },
      },
    });

    if (!material) {
      return Response.json({ ok: false, message: "Material not found." }, { status: 404 });
    }

    if (material._count.templateLines > 0 || material._count.variantLines > 0) {
      return Response.json(
        {
          ok: false,
          message: `This material is still used in ${material._count.templateLines} template(s) and ${material._count.variantLines} variant config(s). Remove those references before deleting it.`,
        },
        { status: 400 },
      );
    }

    await prisma.materialLibraryItem.delete({ where: { id: material.id, shopId } });
    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "MaterialLibraryItem",
        entityId: material.id,
        action: "MATERIAL_DELETED",
        actor: "merchant",
      },
    });

    return Response.json({ ok: true, message: "Material deleted." });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

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

export default function MaterialsPage() {
  const { materials } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const { formatMoney, getCurrencySymbol } = useAppLocalization();
  const materialDialogRef = useRef<HTMLDialogElement>(null);
  const deactivateDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [deactivateTarget, setDeactivateTarget] = useState<Material | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null);
  const [deleteSubmitPending, setDeleteSubmitPending] = useState(false);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    const dialog = materialDialogRef.current;
    if (!dialog) return;

    if (materialDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!materialDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [materialDialogOpen]);

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

  function openCreate() {
    setForm(EMPTY_FORM);
    setMaterialDialogOpen(true);
  }

  function openEdit(material: Material) {
    setForm({
      id: material.id,
      name: material.name,
      type: material.type,
      costingModel: material.costingModel ?? "yield",
      purchasePrice: material.purchasePrice,
      purchaseQty: material.purchaseQty,
      totalUsesPerUnit: material.totalUsesPerUnit ?? "",
      unitDescription: material.unitDescription,
      notes: material.notes,
    });
    setMaterialDialogOpen(true);
  }

  function confirmDeactivate(material: Material) {
    setDeactivateTarget(material);
    setDeactivateDialogOpen(true);
  }

  function confirmDelete(material: Material) {
    setDeleteSubmitPending(false);
    setDeleteTarget(material);
    setDeleteDialogOpen(true);
  }

  function closeMaterialDialog() {
    setMaterialDialogOpen(false);
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

  function updateForm<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
  const statusMessage = fetcher.data?.message ?? "";

  return (
    <>
      <ui-title-bar title="Material Library">
        <button type="button" onClick={openCreate}>New material</button>
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

        {materials.length === 0 ? (
          <s-section heading="No materials yet">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text>Add production and shipping materials to calculate per-unit costs.</s-text>
              <div>
                <s-button variant="primary" onClick={openCreate}>Add first material</s-button>
              </div>
            </div>
          </s-section>
        ) : (
          <s-section padding="none">
            <s-table>
              <div slot="filters" style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap", padding: "1rem" }}>
                <div style={{ display: "grid", gap: "0.2rem" }}>
                  <strong>Material Library</strong>
                  <s-text color="subdued">Production and shipping materials used in template and variant costing.</s-text>
                </div>
                <s-button variant="primary" onClick={openCreate}>
                  New material
                </s-button>
              </div>

              <s-table-header-row>
                <s-table-header listSlot="primary">Name</s-table-header>
                <s-table-header listSlot="inline">Type</s-table-header>
                <s-table-header listSlot="labeled">Costing model</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Per-unit cost</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Used by</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {materials.map((material: Material) => (
                  <s-table-row key={material.id}>
                    <s-table-cell>{material.name}</s-table-cell>
                    <s-table-cell>{material.type === "production" ? "Production" : "Shipping"}</s-table-cell>
                    <s-table-cell>
                      {material.costingModel === "yield"
                        ? "Yield-based"
                        : material.costingModel === "uses"
                          ? "Uses-based"
                          : "Flat per unit"}
                    </s-table-cell>
                    <s-table-cell>{formatMoney(material.perUnitCost)}</s-table-cell>
                    <s-table-cell>{material.templateCount + material.variantCount} uses</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={material.status === "active" ? "success" : "enabled"}>
                        {material.status === "active" ? "Active" : "Inactive"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <s-button
                          variant="secondary"
                          onClick={() => openEdit(material)}
                        >
                          Edit
                        </s-button>
                        {material.status === "active" ? (
                          <s-button
                            tone="critical"
                            variant="secondary"
                            onClick={() => confirmDeactivate(material)}
                          >
                            Deactivate
                          </s-button>
                        ) : (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="reactivate" />
                            <input type="hidden" name="id" value={material.id} />
                            <s-button type="submit" variant="secondary" disabled={isSubmitting}>Reactivate</s-button>
                          </fetcher.Form>
                        )}
                        <s-button tone="critical" variant="secondary" onClick={() => confirmDelete(material)}>
                          Delete
                        </s-button>
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
        ref={materialDialogRef}
        onClose={closeMaterialDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "42rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>{form.id ? "Edit material" : "New material"}</strong>
              <s-text color="subdued">Configure pricing inputs used by templates and variant overrides.</s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeMaterialDialog}
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

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="material-type">Type</label>
            <select
              id="material-type"
              value={form.type}
              onChange={(event) => updateForm("type", event.currentTarget.value)}
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--p-color-border)",
                font: "inherit",
              }}
            >
              <option value="production">Production material</option>
              <option value="shipping">Shipping material</option>
            </select>
          </div>

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="material-costing-model">Costing model</label>
            <select
              id="material-costing-model"
              value={form.costingModel}
              onChange={(event) => updateForm("costingModel", event.currentTarget.value)}
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--p-color-border)",
                font: "inherit",
              }}
            >
              <option value="yield">Yield-based (e.g. fabric by the metre)</option>
              <option value="uses">Uses-based (e.g. screen with 50 uses)</option>
            </select>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            <s-text-field
              label={`Purchase price (${getCurrencySymbol()})`}
              type="number"
              min={0}
              step={0.01}
              value={form.purchasePrice}
              onChange={(event) =>
                updateForm("purchasePrice", (event.target as HTMLInputElement | null)?.value ?? "")
              }
              onBlur={(event) =>
                updateForm("purchasePrice", normalizeFixedDecimalInput((event.target as HTMLInputElement | null)?.value ?? ""))
              }
            />
            <s-text-field
              label="Purchase quantity"
              type="number"
              min={0}
              step={0.001}
              value={form.purchaseQty}
              onChange={(event) =>
                updateForm("purchaseQty", (event.target as HTMLInputElement | null)?.value ?? "")
              }
            />
          </div>

          {perUnitPreview && <s-text color="subdued">Per-unit cost: {formatMoney(perUnitPreview)}</s-text>}

          {form.costingModel === "uses" && (
            <>
              <s-text-field
                label="Total uses per unit"
                type="number"
                min={0}
                step={1}
                value={form.totalUsesPerUnit}
                onChange={(event) =>
                  updateForm("totalUsesPerUnit", (event.target as HTMLInputElement | null)?.value ?? "")
                }
              />
              {perUsePreview && <s-text color="subdued">Per-use cost: {formatMoney(perUsePreview)}</s-text>}
            </>
          )}

          <s-text-field
            label="Unit description"
            value={form.unitDescription}
            onChange={(event) =>
              updateForm("unitDescription", (event.target as HTMLInputElement | null)?.value ?? "")
            }
            details="Optional, e.g. metres, grams, sheets."
          />

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="material-notes">Notes</label>
            <textarea
              id="material-notes"
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
            <s-button variant="secondary" onClick={closeMaterialDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              disabled={isSubmitting}
              onClick={() => {
                const fd = new FormData();
                fd.append("intent", form.id ? "update" : "create");
                if (form.id) fd.append("id", form.id);
                fd.append("name", form.name);
                fd.append("type", form.type);
                fd.append("costingModel", form.costingModel);
                fd.append("purchasePrice", form.purchasePrice);
                fd.append("purchaseQty", form.purchaseQty);
                if (form.costingModel === "uses") {
                  fd.append("totalUsesPerUnit", form.totalUsesPerUnit);
                }
                fd.append("unitDescription", form.unitDescription);
                fd.append("notes", form.notes);
                fetcher.submit(fd, { method: "post" });
                closeMaterialDialog();
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
              <strong>Deactivate material</strong>
              <s-text color="subdued">Hide this material from new configurations while preserving historical calculations.</s-text>
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
              : "Deactivating this material will hide it from new configurations."}
          </s-text>

          {deactivateTarget && deactivateTarget.templateCount + deactivateTarget.variantCount > 0 && (
            <s-banner tone="warning">
              <s-text>
                This material is currently used in {deactivateTarget.templateCount} template(s) and {deactivateTarget.variantCount} variant config(s). Existing cost calculations will not be affected.
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
              <strong>Delete material</strong>
              <s-text color="subdued">Delete this material permanently when it is no longer referenced by templates or variants.</s-text>
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
              Ã—
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
              : "Delete this material permanently? This cannot be undone."}
          </s-text>

          {deleteTarget && deleteTarget.templateCount + deleteTarget.variantCount > 0 ? (
            <s-banner tone="warning">
              <s-text>
                This material is still used in {deleteTarget.templateCount} template(s) and {deleteTarget.variantCount} variant config(s), so deletion is blocked.
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
  console.error("[Materials] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Material Library" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading materials. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
