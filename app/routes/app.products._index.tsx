import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import { authenticateAdminRequest, isPlaywrightBypassRequest } from "../utils/admin-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const [shop, latestCatalogSync, products] = await Promise.all([
    prisma.shop.findUnique({
      where: { shopId },
      select: { catalogSynced: true },
    }),
    prisma.auditLog.findFirst({
      where: {
        shopId,
        action: "CATALOG_SYNC_COMPLETED",
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        payload: true,
      },
    }),
    prisma.product.findMany({
      where: { shopId },
      orderBy: { title: "asc" },
      include: {
        _count: {
          select: { causeAssignments: true, variants: true },
        },
      },
    }),
  ]);

  return Response.json({
    catalogSynced: shop?.catalogSynced ?? false,
    latestCatalogSync: latestCatalogSync
      ? {
          completedAt: latestCatalogSync.createdAt.toISOString(),
          payload: latestCatalogSync.payload,
        }
      : null,
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      variantCount: product._count.variants,
      causeAssignmentCount: product._count.causeAssignments,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent !== "sync-catalog") {
    return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
  }

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Shop",
      action: "CATALOG_SYNC_REQUESTED",
      actor: "merchant",
      payload: {
        source: "products_index",
      },
    },
  });

  if (!isPlaywrightBypassRequest(request)) {
    await jobQueue.send(
      "catalog.sync",
      { shopId },
      {
        singletonKey: shopId,
        singletonSeconds: 15 * 60,
      },
    );
  }

  return Response.json({
    ok: true,
    message:
      "Catalog sync queued. Shopify products and variants will be added or refreshed without deleting your existing local seed data.",
  });
};

type ProductRow = {
  id: string;
  title: string;
  handle: string;
  status: string;
  variantCount: number;
  causeAssignmentCount: number;
};

type SyncActionData = {
  ok: boolean;
  message: string;
};

function formatSyncDate(value: string | null) {
  if (!value) return "Not yet completed";
  return new Date(value).toLocaleString();
}

export default function ProductsPage() {
  const { catalogSynced, latestCatalogSync, products } = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<SyncActionData>();

  return (
    <>
      <ui-title-bar title="Products" />
      <s-page>
        <s-section heading="Catalog sync">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <s-text>
              Sync products and variants from Shopify without removing locally seeded test data. Existing Shopify-backed rows are
              refreshed in place by `shopifyId`; unrelated local rows are left alone.
            </s-text>
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              <div>
                <strong>Status</strong>
                <div>{catalogSynced ? "Catalog synced" : "Initial catalog sync still pending"}</div>
              </div>
              <div>
                <strong>Last completed sync</strong>
                <div>{formatSyncDate(latestCatalogSync?.completedAt ?? null)}</div>
              </div>
            </div>
            {syncFetcher.data?.ok ? (
              <s-banner tone="success">
                <s-text>{syncFetcher.data.message}</s-text>
              </s-banner>
            ) : null}
            {syncFetcher.data && !syncFetcher.data.ok ? (
              <s-banner tone="critical">
                <s-text>{syncFetcher.data.message}</s-text>
              </s-banner>
            ) : null}
            <syncFetcher.Form method="post">
              <input type="hidden" name="intent" value="sync-catalog" />
              <s-button type="submit" variant="primary" disabled={syncFetcher.state !== "idle"}>
                Sync catalog now
              </s-button>
            </syncFetcher.Form>
          </div>
        </s-section>

        {products.length === 0 ? (
          <s-section heading="No synced products">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text>Catalog sync must complete before product-level Cause assignments can be configured.</s-text>
              <s-text color="subdued">
                Use the sync action above to import your Shopify catalog while keeping any seed data you already have.
              </s-text>
            </div>
          </s-section>
        ) : (
          <s-section padding="none">
            <s-table>
              <div
                slot="filters"
                style={{
                  display: "grid",
                  gap: "0.2rem",
                  padding: "1rem",
                }}
              >
                <strong>Product Donations</strong>
                <s-text color="subdued">Assign Causes and allocation percentages at the product level.</s-text>
              </div>

              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Variants</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Cause assignments</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {products.map((product: ProductRow) => (
                  <s-table-row key={product.id}>
                    <s-table-cell>
                      <div style={{ display: "grid", gap: "0.2rem" }}>
                        <strong>{product.title}</strong>
                        <s-text color="subdued">/{product.handle}</s-text>
                      </div>
                    </s-table-cell>
                    <s-table-cell>{product.variantCount}</s-table-cell>
                    <s-table-cell>{product.causeAssignmentCount}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={product.status === "active" ? "success" : product.status === "draft" ? "warning" : "enabled"}>
                        {product.status === "active" ? "Active" : product.status === "draft" ? "Draft" : "Archived"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <Link
                        to={`/app/products/${product.id}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0.55rem 0.9rem",
                          borderRadius: "999px",
                          border: "1px solid var(--p-color-border, #d2d5d8)",
                          color: "inherit",
                          textDecoration: "none",
                          fontWeight: 600,
                        }}
                      >
                        Manage donations
                      </Link>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        )}
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Products] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Products" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading Products. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
