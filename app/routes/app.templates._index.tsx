import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const templates = await prisma.costTemplate.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: {
        select: { materialLines: true, equipmentLines: true, variantConfigs: true },
      },
    },
  });

  return Response.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? "",
      status: t.status,
      materialLineCount: t._count.materialLines,
      equipmentLineCount: t._count.equipmentLines,
      variantCount: t._count.variantConfigs,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "create") {
    const name = formData.get("name")?.toString().trim() ?? "";
    const description = formData.get("description")?.toString().trim() || null;

    if (!name) {
      return Response.json({ ok: false, message: "Name is required." }, { status: 400 });
    }

    const template = await prisma.costTemplate.create({
      data: { shopId, name, description },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "CostTemplate",
        entityId: template.id,
        action: "TEMPLATE_CREATED",
        actor: "merchant",
      },
    });

    return Response.json({ ok: true, message: "Template created.", id: template.id });
  }

  if (intent === "deactivate" || intent === "reactivate") {
    const id = formData.get("id")?.toString() ?? "";
    const status = intent === "deactivate" ? "inactive" : "active";

    await prisma.costTemplate.update({ where: { id, shopId }, data: { status } });
    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "CostTemplate",
        entityId: id,
        action: intent === "deactivate" ? "TEMPLATE_DEACTIVATED" : "TEMPLATE_REACTIVATED",
        actor: "merchant",
      },
    });

    return Response.json({
      ok: true,
      message: intent === "deactivate" ? "Template deactivated." : "Template reactivated.",
    });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

type Template = {
  id: string;
  name: string;
  description: string;
  status: string;
  materialLineCount: number;
  equipmentLineCount: number;
  variantCount: number;
};

export default function TemplatesPage() {
  const { templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string; id?: string }>();
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const deactivateDialogRef = useRef<HTMLDialogElement>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<Template | null>(null);

  useEffect(() => {
    const dialog = createDialogRef.current;
    if (!dialog) return;

    if (createDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!createDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [createDialogOpen]);

  useEffect(() => {
    const dialog = deactivateDialogRef.current;
    if (!dialog) return;

    if (deactivateDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!deactivateDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [deactivateDialogOpen]);

  function openCreateDialog() {
    setNewName("");
    setNewDesc("");
    setCreateDialogOpen(true);
  }

  function closeCreateDialog() {
    setCreateDialogOpen(false);
    setNewName("");
    setNewDesc("");
  }

  function openDeactivateDialog(template: Template) {
    setDeactivateTarget(template);
    setDeactivateDialogOpen(true);
  }

  function closeDeactivateDialog() {
    setDeactivateDialogOpen(false);
    setDeactivateTarget(null);
  }

  const isSubmitting = fetcher.state !== "idle";
  const statusMessage = fetcher.data?.message ?? "";

  return (
    <>
      <ui-title-bar title="Cost Templates">
        <button type="button" onClick={openCreateDialog}>New template</button>
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
        {fetcher.data && !fetcher.data.ok && (
          <s-banner tone="critical">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        )}

        {templates.length === 0 ? (
          <s-section heading="No templates yet">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text>
                Create reusable cost templates to quickly configure multiple variants with the same materials and equipment.
              </s-text>
              <div>
                <s-button variant="primary" onClick={openCreateDialog}>Create first template</s-button>
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
                  <strong>Cost Templates</strong>
                  <s-text color="subdued">Reusable cost structures for variant configuration.</s-text>
                </div>
                <s-button variant="primary" onClick={openCreateDialog}>New template</s-button>
              </div>

              <s-table-header-row>
                <s-table-header listSlot="primary">Name</s-table-header>
                <s-table-header listSlot="secondary">Description</s-table-header>
                <s-table-header listSlot="labeled" format="numeric">Lines</s-table-header>
                <s-table-header listSlot="labeled" format="numeric">Used by</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {templates.map((template: Template) => (
                  <s-table-row key={template.id}>
                    <s-table-cell>{template.name}</s-table-cell>
                    <s-table-cell>{template.description || "—"}</s-table-cell>
                    <s-table-cell>{template.materialLineCount + template.equipmentLineCount} lines</s-table-cell>
                    <s-table-cell>
                      {template.variantCount} variant{template.variantCount !== 1 ? "s" : ""}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={template.status === "active" ? "success" : "enabled"}>
                        {template.status === "active" ? "Active" : "Inactive"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <Link to={`/app/templates/${template.id}`}>
                          <s-button variant="secondary">Edit</s-button>
                        </Link>
                        {template.status === "active" ? (
                          <s-button tone="critical" variant="secondary" onClick={() => openDeactivateDialog(template)}>
                            Deactivate
                          </s-button>
                        ) : (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="reactivate" />
                            <input type="hidden" name="id" value={template.id} />
                            <s-button type="submit" variant="secondary" disabled={isSubmitting}>Reactivate</s-button>
                          </fetcher.Form>
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
        ref={createDialogRef}
        onClose={closeCreateDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "36rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>New template</strong>
              <s-text color="subdued">Create a reusable structure for materials, equipment, and default labor inputs.</s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeCreateDialog}
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
            value={newName}
            onChange={(event) => setNewName((event.target as HTMLInputElement | null)?.value ?? "")}
          />

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="template-description">Description</label>
            <textarea
              id="template-description"
              rows={3}
              value={newDesc}
              onChange={(event) => setNewDesc(event.currentTarget.value)}
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--p-color-border)",
                font: "inherit",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={closeCreateDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              disabled={isSubmitting}
              onClick={() => {
                const fd = new FormData();
                fd.append("intent", "create");
                fd.append("name", newName);
                fd.append("description", newDesc);
                fetcher.submit(fd, { method: "post" });
                closeCreateDialog();
              }}
            >
              Create
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
              <strong>Deactivate template</strong>
              <s-text color="subdued">Hide this template from new variant assignments without changing existing calculations.</s-text>
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
              ? `Deactivating ${deactivateTarget.name} will hide it from new variant configurations.`
              : "Deactivating this template will hide it from new variant configurations."}
          </s-text>

          {deactivateTarget && deactivateTarget.variantCount > 0 && (
            <s-banner tone="warning">
              <s-text>
                {deactivateTarget.variantCount} variant(s) currently use this template. Their cost calculations will not be affected.
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
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Templates] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Cost Templates" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading templates. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
