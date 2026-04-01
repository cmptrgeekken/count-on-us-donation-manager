import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError, Link, Outlet } from "@remix-run/react";
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

// ── Loader ────────────────────────────────────────────────────────────────────

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

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "create") {
    const name = formData.get("name")?.toString().trim() ?? "";
    const description = formData.get("description")?.toString().trim() || null;

    if (!name)
      return Response.json({ ok: false, message: "Name is required." }, { status: 400 });

    const template = await prisma.costTemplate.create({
      data: { shopId, name, description },
    });
    await prisma.auditLog.create({
      data: { shopId, entity: "CostTemplate", entityId: template.id, action: "TEMPLATE_CREATED", actor: "merchant" },
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
    return Response.json({ ok: true, message: intent === "deactivate" ? "Template deactivated." : "Template reactivated." });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Template = {
  id: string;
  name: string;
  description: string;
  status: string;
  materialLineCount: number;
  equipmentLineCount: number;
  variantCount: number;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const { templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string; id?: string }>();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<Template | null>(null);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(templates);

  const isSubmitting = fetcher.state !== "idle";

  const rowMarkup = templates.map((t: Template, index: number) => (
    <IndexTable.Row
      id={t.id}
      key={t.id}
      selected={selectedResources.includes(t.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Link to={`/app/templates/${t.id}`} style={{ textDecoration: "none" }} onClick={(e) => e.stopPropagation()}>
          <Text as="span" variant="bodyMd" fontWeight="semibold">{t.name}</Text>
        </Link>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="subdued">
          {t.description || "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {t.materialLineCount + t.equipmentLineCount} lines
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="subdued">
          {t.variantCount} variant{t.variantCount !== 1 ? "s" : ""}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={t.status === "active" ? "success" : "enabled"}>
          {t.status === "active" ? "Active" : "Inactive"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Link to={`/app/templates/${t.id}`} onClick={(e) => e.stopPropagation()}>
            <Button variant="plain">Edit</Button>
          </Link>
          {t.status === "active" ? (
            <span onClick={(e) => e.stopPropagation()}>
              <Button variant="plain" tone="critical" onClick={() => setDeactivateTarget(t)}>
                Deactivate
              </Button>
            </span>
          ) : (
            <fetcher.Form method="post" style={{ display: "inline" }} onClick={(e) => e.stopPropagation()}>
              <input type="hidden" name="intent" value="reactivate" />
              <input type="hidden" name="id" value={t.id} />
              <Button variant="plain" submit loading={isSubmitting}>Reactivate</Button>
            </fetcher.Form>
          )}
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page>
      <TitleBar title="Cost Templates">
        <button variant="primary" onClick={() => setCreateOpen(true)}>New template</button>
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
          {templates.length === 0 ? (
            <EmptyState
              heading="No templates yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Create reusable cost templates to quickly configure multiple variants with the same materials and equipment.
                </Text>
                <Button variant="primary" onClick={() => setCreateOpen(true)}>Create first template</Button>
              </BlockStack>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "template", plural: "templates" }}
              itemCount={templates.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Name" },
                { title: "Description" },
                { title: "Lines" },
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

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New template"
        primaryAction={{
          content: "Create",
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("intent", "create");
            fd.append("name", newName);
            fd.append("description", newDesc);
            fetcher.submit(fd, { method: "post" });
            setCreateOpen(false);
            setNewName("");
            setNewDesc("");
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setCreateOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Name"
              value={newName}
              onChange={setNewName}
              autoComplete="off"
            />
            <TextField
              label="Description (optional)"
              value={newDesc}
              onChange={setNewDesc}
              multiline={2}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Deactivate confirmation */}
      {deactivateTarget && (
        <Modal
          open
          onClose={() => setDeactivateTarget(null)}
          title="Deactivate template"
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
                Deactivating <strong>{deactivateTarget.name}</strong> will hide it from new variant configurations.
              </Text>
              {deactivateTarget.variantCount > 0 && (
                <Text as="p" variant="bodyMd" tone="caution">
                  {deactivateTarget.variantCount} variant(s) currently use this template. Their cost calculations will not be affected.
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
  console.error("[Templates] ErrorBoundary caught:", error);
  return (
    <Page>
      <TitleBar title="Cost Templates" />
      <Banner tone="critical">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="bold">Something went wrong loading templates.</Text>
          <Text as="p" variant="bodyMd">Please refresh the page. If the problem persists, contact support.</Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
