import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, Link } from "@remix-run/react";
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
  Select,
  IndexTable,
  useIndexResourceState,
  EmptyState,
  Filters,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
        costConfig: { select: { id: true, templateId: true, template: { select: { name: true } } } },
      },
    }),
    prisma.product.findMany({
      where: { shopId },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    prisma.costTemplate.findMany({
      where: { shopId, status: "active" },
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
      templateName: v.costConfig?.template?.name ?? null,
    })),
    products: products.map((p) => ({ id: p.id, title: p.title })),
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    filterProductId,
    filterConfigured,
  });
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "bulk-assign-template") {
    const templateId = formData.get("templateId")?.toString() ?? "";
    const variantIds = formData.getAll("variantId").map(String);

    if (!templateId) return Response.json({ ok: false, message: "No template selected." }, { status: 400 });
    if (variantIds.length === 0) return Response.json({ ok: false, message: "No variants selected." }, { status: 400 });

    // Verify template belongs to this shop
    const template = await prisma.costTemplate.findFirst({ where: { id: templateId, shopId }, select: { shopId: true } });
    if (!template)
      return Response.json({ ok: false, message: "Template not found." }, { status: 404 });

    for (const variantId of variantIds) {
      const existing = await prisma.variantCostConfig.findFirst({ where: { variantId, shopId } });
      if (existing) {
        await prisma.variantCostConfig.updateMany({ where: { id: existing.id, shopId }, data: { templateId } });
      } else {
        await prisma.variantCostConfig.create({ data: { shopId, variantId, templateId } });
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

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function VariantsPage() {
  const { variants, products, templates, filterProductId, filterConfigured } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();

  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [overwriteCount, setOverwriteCount] = useState(0);
  const [pendingAssign, setPendingAssign] = useState<string[]>([]);

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(variants);

  const isSubmitting = fetcher.state !== "idle";

  function handleBulkAssign() {
    const alreadyConfigured = variants
      .filter((v: VariantRow) => selectedResources.includes(v.id) && v.hasConfig)
      .length;

    setPendingAssign([...selectedResources]);

    if (alreadyConfigured > 0) {
      setOverwriteCount(alreadyConfigured);
      setConfirmOverwrite(true);
    } else {
      submitAssign([...selectedResources]);
    }
  }

  function submitAssign(ids: string[]) {
    const fd = new FormData();
    fd.append("intent", "bulk-assign-template");
    fd.append("templateId", selectedTemplateId);
    ids.forEach((id) => fd.append("variantId", id));
    fetcher.submit(fd, { method: "post" });
    clearSelection();
    setAssignOpen(false);
    setConfirmOverwrite(false);
  }

  const bulkActions = selectedResources.length > 0
    ? [{ content: "Assign template", onAction: () => setAssignOpen(true) }]
    : [];

  const rowMarkup = variants.map((v: VariantRow, index: number) => (
    <IndexTable.Row
      id={v.id}
      key={v.id}
      selected={selectedResources.includes(v.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="subdued">{v.productTitle}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Link to={`/app/variants/${v.id}`} style={{ textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>
          <Text as="span" variant="bodyMd" fontWeight="semibold">{v.title}</Text>
        </Link>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="subdued">{v.sku || "—"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">${Number(v.price).toFixed(2)}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="subdued">{v.templateName ?? "—"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={v.hasConfig ? "success" : "enabled"}>
          {v.hasConfig ? "Configured" : "Not configured"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Link to={`/app/variants/${v.id}`} onClick={(e) => e.stopPropagation()}>
          <Button variant="plain">Configure</Button>
        </Link>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const appliedFilters = [];
  if (filterConfigured) {
    appliedFilters.push({
      key: "configured",
      label: filterConfigured === "yes" ? "Configured only" : "Not configured only",
      onRemove: () => {},
    });
  }

  return (
    <Page>
      <TitleBar title="Variants" />

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
        {fetcher.data?.ok && fetcher.data.message && (
          <Banner tone="success">
            <Text as="p" variant="bodyMd">{fetcher.data.message}</Text>
          </Banner>
        )}

        <Card padding="0">
          {variants.length === 0 && !filterProductId && !filterConfigured ? (
            <EmptyState
              heading="No variants synced yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <Text as="p" variant="bodyMd" tone="subdued">
                Variants will appear here after the initial catalog sync completes.
              </Text>
            </EmptyState>
          ) : (
            <>
              <Filters
                queryValue=""
                filters={[
                  {
                    key: "product",
                    label: "Product",
                    filter: (
                      <Select
                        label="Product"
                        labelHidden
                        options={[
                          { label: "All products", value: "" },
                          ...products.map((p: { id: string; title: string }) => ({ label: p.title, value: p.id })),
                        ]}
                        value={filterProductId}
                        onChange={(v) => {
                          const url = new URL(window.location.href);
                          if (v) url.searchParams.set("product", v);
                          else url.searchParams.delete("product");
                          window.location.href = url.toString();
                        }}
                      />
                    ),
                    shortcut: true,
                  },
                  {
                    key: "configured",
                    label: "Configuration status",
                    filter: (
                      <Select
                        label="Status"
                        labelHidden
                        options={[
                          { label: "All", value: "" },
                          { label: "Configured", value: "yes" },
                          { label: "Not configured", value: "no" },
                        ]}
                        value={filterConfigured}
                        onChange={(v) => {
                          const url = new URL(window.location.href);
                          if (v) url.searchParams.set("configured", v);
                          else url.searchParams.delete("configured");
                          window.location.href = url.toString();
                        }}
                      />
                    ),
                    shortcut: true,
                  },
                ]}
                appliedFilters={appliedFilters}
                onQueryChange={() => {}}
                onQueryClear={() => {}}
                onClearAll={() => {}}
              />
              <IndexTable
                resourceName={{ singular: "variant", plural: "variants" }}
                itemCount={variants.length}
                selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                bulkActions={bulkActions}
                headings={[
                  { title: "Product" },
                  { title: "Variant" },
                  { title: "SKU" },
                  { title: "Price" },
                  { title: "Template" },
                  { title: "Status" },
                  { title: "Actions" },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            </>
          )}
        </Card>
      </BlockStack>

      {/* Bulk assign modal — template picker */}
      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title={`Assign template to ${selectedResources.length} variant(s)`}
        primaryAction={{
          content: "Assign",
          loading: isSubmitting,
          onAction: handleBulkAssign,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAssignOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {templates.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                No active templates available. Create a template first.
              </Text>
            ) : (
              <Select
                label="Template"
                options={templates.map((t: { id: string; name: string }) => ({ label: t.name, value: t.id }))}
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
              />
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Overwrite confirmation modal */}
      <Modal
        open={confirmOverwrite}
        onClose={() => setConfirmOverwrite(false)}
        title="Overwrite existing configurations?"
        primaryAction={{
          content: "Yes, overwrite",
          destructive: true,
          loading: isSubmitting,
          onAction: () => submitAssign(pendingAssign),
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmOverwrite(false) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            {overwriteCount} of the selected variant(s) already have a cost configuration. Assigning this template will replace their current template assignment. Per-variant line overrides and labor settings will be preserved.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Variants] ErrorBoundary caught:", error);
  return (
    <Page>
      <TitleBar title="Variants" />
      <Banner tone="critical">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="bold">Something went wrong loading variants.</Text>
          <Text as="p" variant="bodyMd">Please refresh the page. If the problem persists, contact support.</Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
