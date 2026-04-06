import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate, useRouteError, useSearchParams } from "@remix-run/react";
import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { useAppLocalization } from "../utils/use-app-localization";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const filterProductId = url.searchParams.get("product") ?? "";
  const filterConfigured = url.searchParams.get("configured") ?? "";

  const [variants, products, templates] = await Promise.all([
    prisma.variant.findMany({
      where: {
        shopId,
        ...(filterProductId ? { productId: filterProductId } : {}),
        ...(filterConfigured === "yes" ? { costConfig: { isNot: null } } : {}),
        ...(filterConfigured === "no" ? { costConfig: { is: null } } : {}),
      },
      orderBy: [{ product: { title: "asc" } }, { title: "asc" }],
      include: {
        product: { select: { id: true, title: true } },
        costConfig: { select: { id: true, productionTemplateId: true, productionTemplate: { select: { name: true } } } },
      },
    }),
    prisma.product.findMany({
      where: { shopId },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    prisma.costTemplate.findMany({
      where: { shopId, status: "active", type: "production" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return Response.json({
    variants: variants.map((v) => ({
      id: v.id,
      shopifyId: v.shopifyId,
      productId: v.productId,
      productTitle: v.product.title,
      title: v.title,
      sku: v.sku ?? "",
      price: v.price.toString(),
      hasConfig: v.costConfig !== null,
      templateName: v.costConfig?.productionTemplate?.name ?? null,
    })),
    products: products.map((p) => ({ id: p.id, title: p.title })),
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    filterProductId,
    filterConfigured,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "bulk-assign-template") {
    const templateId = formData.get("templateId")?.toString() ?? "";
    const variantIds = formData.getAll("variantId").map(String);

    if (!templateId) {
      return Response.json({ ok: false, message: "No template selected." }, { status: 400 });
    }
    if (variantIds.length === 0) {
      return Response.json({ ok: false, message: "No variants selected." }, { status: 400 });
    }

    const template = await prisma.costTemplate.findFirst({
      where: { id: templateId, shopId },
      select: { shopId: true },
    });

    if (!template) {
      return Response.json({ ok: false, message: "Template not found." }, { status: 404 });
    }

    for (const variantId of variantIds) {
      const existing = await prisma.variantCostConfig.findFirst({ where: { variantId, shopId } });
      if (existing) {
        await prisma.variantCostConfig.updateMany({ where: { id: existing.id, shopId }, data: { productionTemplateId: templateId } });
      } else {
        await prisma.variantCostConfig.create({ data: { shopId, variantId, productionTemplateId: templateId } });
      }
    }

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "VariantCostConfig",
        action: "BULK_TEMPLATE_ASSIGNED",
        actor: "merchant",
        payload: { templateId, variantCount: variantIds.length },
      },
    });

    return Response.json({ ok: true, message: `Template assigned to ${variantIds.length} variant(s).` });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

type VariantRow = {
  id: string;
  shopifyId: string;
  productId: string;
  productTitle: string;
  title: string;
  sku: string;
  price: string;
  hasConfig: boolean;
  templateName: string | null;
};

export default function VariantsPage() {
  const { variants, products, templates, filterProductId, filterConfigured } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const { formatMoney } = useAppLocalization();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const assignDialogRef = useRef<HTMLDialogElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);

  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingAssign, setPendingAssign] = useState<string[]>([]);
  const [overwriteCount, setOverwriteCount] = useState(0);

  useEffect(() => {
    setSelectedVariantIds((current) => current.filter((id) => variants.some((variant: VariantRow) => variant.id === id)));
  }, [variants]);

  useEffect(() => {
    const dialog = assignDialogRef.current;
    if (!dialog) return;

    if (assignDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!assignDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [assignDialogOpen]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;

    if (confirmDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!confirmDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [confirmDialogOpen]);

  const isSubmitting = fetcher.state !== "idle";
  const statusMessage = fetcher.data?.message ?? "";
  const allSelected = variants.length > 0 && selectedVariantIds.length === variants.length;

  const selectedConfiguredCount = useMemo(
    () => variants.filter((variant: VariantRow) => selectedVariantIds.includes(variant.id) && variant.hasConfig).length,
    [selectedVariantIds, variants],
  );

  function updateSelection(id: string, checked: boolean) {
    setSelectedVariantIds((current) =>
      checked ? (current.includes(id) ? current : [...current, id]) : current.filter((value) => value !== id),
    );
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedVariantIds(checked ? variants.map((variant: VariantRow) => variant.id) : []);
  }

  function clearSelection() {
    setSelectedVariantIds([]);
  }

  function openAssignDialog() {
    setSelectedTemplateId(templates[0]?.id ?? "");
    setAssignDialogOpen(true);
  }

  function closeAssignDialog() {
    setAssignDialogOpen(false);
  }

  function closeConfirmDialog() {
    setConfirmDialogOpen(false);
    setPendingAssign([]);
    setOverwriteCount(0);
  }

  function submitAssign(ids: string[]) {
    const fd = new FormData();
    fd.append("intent", "bulk-assign-template");
    fd.append("templateId", selectedTemplateId);
    ids.forEach((id) => fd.append("variantId", id));
    fetcher.submit(fd, { method: "post" });
    clearSelection();
    closeAssignDialog();
    closeConfirmDialog();
  }

  function handleBulkAssign() {
    if (selectedVariantIds.length === 0) {
      return;
    }

    setPendingAssign(selectedVariantIds);

    if (selectedConfiguredCount > 0) {
      setOverwriteCount(selectedConfiguredCount);
      setConfirmDialogOpen(true);
    } else {
      submitAssign(selectedVariantIds);
    }
  }

  function applyFilters(form: HTMLFormElement) {
    const formData = new FormData(form);
    const params = new URLSearchParams(searchParams);

    const product = formData.get("product")?.toString() ?? "";
    const configured = formData.get("configured")?.toString() ?? "";

    if (product) params.set("product", product);
    else params.delete("product");

    if (configured) params.set("configured", configured);
    else params.delete("configured");

    navigate(`?${params.toString()}`);
  }

  function clearFilters() {
    const params = new URLSearchParams(searchParams);
    params.delete("product");
    params.delete("configured");
    navigate(`?${params.toString()}`);
  }

  return (
    <>
      <ui-title-bar title="Variants" />

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
        {fetcher.data?.ok && fetcher.data.message && (
          <s-banner tone="success">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        )}

        {variants.length === 0 && !filterProductId && !filterConfigured ? (
          <s-section heading="No variants synced yet">
            <s-text>Variants will appear here after the initial catalog sync completes.</s-text>
          </s-section>
        ) : (
          <>
            <s-section>
              <form
                method="get"
                style={{ display: "grid", gap: "1rem" }}
                onSubmit={(event) => {
                  event.preventDefault();
                  applyFilters(event.currentTarget);
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "1rem",
                    alignItems: "end",
                  }}
                >
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <label htmlFor="variants-product-filter">Product</label>
                    <select
                      id="variants-product-filter"
                      name="product"
                      defaultValue={filterProductId}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "0.75rem",
                        borderRadius: "0.75rem",
                        border: "1px solid var(--p-color-border, #d2d5d8)",
                        background: "var(--p-color-bg-surface, #fff)",
                        color: "var(--p-color-text, #303030)",
                        font: "inherit",
                      }}
                    >
                      <option value="">All products</option>
                      {products.map((product: { id: string; title: string }) => (
                        <option key={product.id} value={product.id}>{product.title}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <label htmlFor="variants-configured-filter">Configuration status</label>
                    <select
                      id="variants-configured-filter"
                      name="configured"
                      defaultValue={filterConfigured}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "0.75rem",
                        borderRadius: "0.75rem",
                        border: "1px solid var(--p-color-border, #d2d5d8)",
                        background: "var(--p-color-bg-surface, #fff)",
                        color: "var(--p-color-text, #303030)",
                        font: "inherit",
                      }}
                    >
                      <option value="">All</option>
                      <option value="yes">Configured</option>
                      <option value="no">Not configured</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                    <s-button type="submit" variant="primary">Apply filters</s-button>
                    <s-button variant="secondary" onClick={clearFilters}>Clear</s-button>
                  </div>
                </div>

                {(filterProductId || filterConfigured) && (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {filterProductId && (
                      <s-badge tone="info">
                        Product: {products.find((product: { id: string; title: string }) => product.id === filterProductId)?.title ?? filterProductId}
                      </s-badge>
                    )}
                    {filterConfigured && (
                      <s-badge tone="info">
                        {filterConfigured === "yes" ? "Configured only" : "Not configured only"}
                      </s-badge>
                    )}
                  </div>
                )}
              </form>
            </s-section>

            {selectedVariantIds.length > 0 && (
              <s-section>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: "0.25rem" }}>
                    <strong>{selectedVariantIds.length} variant{selectedVariantIds.length !== 1 ? "s" : ""} selected</strong>
                    <s-text color="subdued">
                      {selectedConfiguredCount > 0
                        ? `${selectedConfiguredCount} selected variant(s) already have a configuration.`
                        : "Assign a template to the selected variants."}
                    </s-text>
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                    <s-button variant="secondary" onClick={clearSelection}>Clear selection</s-button>
                    <s-button variant="primary" onClick={openAssignDialog} disabled={templates.length === 0}>
                      Assign template
                    </s-button>
                  </div>
                </div>
              </s-section>
            )}

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
                    <strong>Variants</strong>
                    <s-text color="subdued">Filter, select, and assign templates to synced Shopify variants.</s-text>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => toggleSelectAll(event.currentTarget.checked)}
                    />
                    <span>Select all visible</span>
                  </label>
                </div>

                <s-table-header-row>
                  <s-table-header>Select</s-table-header>
                  <s-table-header listSlot="secondary">Product</s-table-header>
                  <s-table-header listSlot="primary">Variant</s-table-header>
                  <s-table-header listSlot="secondary">SKU</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">Price</s-table-header>
                  <s-table-header listSlot="secondary">Template</s-table-header>
                  <s-table-header listSlot="inline">Status</s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {variants.map((variant: VariantRow) => (
                    <s-table-row key={variant.id}>
                      <s-table-cell>
                        <input
                          type="checkbox"
                          checked={selectedVariantIds.includes(variant.id)}
                          onChange={(event) => updateSelection(variant.id, event.currentTarget.checked)}
                          aria-label={`Select ${variant.title}`}
                        />
                      </s-table-cell>
                      <s-table-cell>{variant.productTitle}</s-table-cell>
                      <s-table-cell>{variant.title}</s-table-cell>
                      <s-table-cell>{variant.sku || "—"}</s-table-cell>
                      <s-table-cell>{formatMoney(variant.price)}</s-table-cell>
                      <s-table-cell>{variant.templateName ?? "—"}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={variant.hasConfig ? "success" : "enabled"}>
                          {variant.hasConfig ? "Configured" : "Not configured"}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <Link to={`/app/variants/${variant.id}`}>
                          <s-button variant="secondary">Configure</s-button>
                        </Link>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-section>
          </>
        )}
      </s-page>

      <dialog
        ref={assignDialogRef}
        onClose={closeAssignDialog}
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
              <strong>Assign template</strong>
              <s-text color="subdued">
                Assign a template to {selectedVariantIds.length} selected variant{selectedVariantIds.length !== 1 ? "s" : ""}.
              </s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeAssignDialog}
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

          {templates.length === 0 ? (
            <s-text>No active templates are available. Create a template first.</s-text>
          ) : (
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="variant-template-assign">Template</label>
              <select
                id="variant-template-assign"
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.currentTarget.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "0.75rem",
                  borderRadius: "0.75rem",
                  border: "1px solid var(--p-color-border, #d2d5d8)",
                  background: "var(--p-color-bg-surface, #fff)",
                  color: "var(--p-color-text, #303030)",
                  font: "inherit",
                }}
              >
                {templates.map((template: { id: string; name: string }) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={closeAssignDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              disabled={isSubmitting || templates.length === 0 || selectedVariantIds.length === 0}
              onClick={handleBulkAssign}
            >
              Assign
            </s-button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={confirmDialogRef}
        onClose={closeConfirmDialog}
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
              <strong>Overwrite existing configurations?</strong>
              <s-text color="subdued">Some selected variants already have a configuration.</s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeConfirmDialog}
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
            {overwriteCount} of the selected variant(s) already have a cost configuration. Assigning this template will replace their current template assignment. Per-variant line overrides and labor settings will be preserved.
          </s-text>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={closeConfirmDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              tone="critical"
              disabled={isSubmitting}
              onClick={() => submitAssign(pendingAssign)}
            >
              Yes, overwrite
            </s-button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Variants] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Variants" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading variants. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
