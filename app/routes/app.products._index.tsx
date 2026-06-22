import { jsonResponse } from "~/utils/json-response.server";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { ResourceTableHeader } from "../components/admin-ui";
import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import {
  auditProductShopifySyncFailure,
  canSyncProductToShopify,
  saveProductArtistAssignmentsLocally,
  syncProductArtistAssignmentsToShopify,
} from "../services/productArtistAssignmentService.server";
import { syncProductCauseAssignmentsMetafield } from "../services/productCauseAssignmentService.server";
import { authenticateAdminRequest, isPlaywrightBypassRequest } from "../utils/admin-auth.server";

const bulkAssignmentSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1, "Select at least one product."),
  causeId: z.string().min(1).optional(),
  artistId: z.string().min(1).optional(),
});

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const [shop, latestCatalogSync, products, causes, artists] = await Promise.all([
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
        artistAssignments: {
          where: { shopId, status: "active" },
          select: { id: true },
        },
        variants: {
          select: {
            id: true,
            providerMappings: {
              where: { status: "mapped" },
              select: { provider: true },
            },
          },
        },
      },
    }),
    prisma.cause.findMany({
      where: { shopId, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.artist.findMany({
      where: { shopId, status: "active" },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
  ]);

  return jsonResponse({
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
      artistAssignmentCount: product.artistAssignments.length,
      mappedVariantCount: product.variants.filter((variant) => variant.providerMappings.length > 0).length,
      mappedProviderCount: new Set(
        product.variants.flatMap((variant) => variant.providerMappings.map((mapping) => mapping.provider)),
      ).size,
    })),
    causes,
    artists,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "sync-catalog") {
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

    return jsonResponse({
      ok: true,
      message:
        "Catalog sync queued. Shopify products and variants will be added or refreshed without deleting your existing local seed data.",
    });
  }

  if (intent === "bulk-assign-cause") {
    const parsed = bulkAssignmentSchema.safeParse({
      productIds: formData.getAll("productId").map(String),
      causeId: formData.get("causeId")?.toString() ?? "",
    });

    if (!parsed.success) {
      return jsonResponse(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid bulk Cause assignment." },
        { status: 400 },
      );
    }

    if (!parsed.data.causeId) {
      return jsonResponse({ ok: false, message: "Choose a Cause to assign." }, { status: 400 });
    }

    const [cause, products] = await Promise.all([
      prisma.cause.findFirst({
        where: { id: parsed.data.causeId, shopId, status: "active" },
        select: { id: true, name: true, shopifyMetaobjectId: true },
      }),
      prisma.product.findMany({
        where: { id: { in: parsed.data.productIds }, shopId },
        select: { id: true, shopifyId: true, title: true },
      }),
    ]);

    if (!cause) {
      return jsonResponse({ ok: false, message: "Cause not found." }, { status: 404 });
    }
    if (products.length !== parsed.data.productIds.length) {
      return jsonResponse({ ok: false, message: "One or more selected products are unavailable." }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      for (const product of products) {
        await tx.productArtistAssignment.deleteMany({ where: { shopId, productId: product.id } });
        await tx.productCauseAssignment.deleteMany({
          where: {
            shopId,
            OR: [
              { productId: product.id },
              { shopifyProductId: product.shopifyId },
            ],
          },
        });
        await tx.productCauseAssignment.create({
          data: {
            shopId,
            shopifyProductId: product.shopifyId,
            productId: product.id,
            causeId: cause.id,
            percentage: 100,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "Product",
          action: "PRODUCT_CAUSE_ASSIGNMENTS_BULK_ASSIGNED",
          actor: "merchant",
          payload: {
            causeId: cause.id,
            causeName: cause.name,
            productCount: products.length,
            productIds: products.map((product) => product.id),
          },
        },
      });
    });

    const syncFailures: string[] = [];
    const syncSkipped: string[] = [];
    if (admin) {
      for (const product of products) {
        if (!canSyncProductToShopify(product.shopifyId)) {
          syncSkipped.push(product.title);
          continue;
        }

        try {
          await syncProductCauseAssignmentsMetafield(admin, product.shopifyId, [
            {
              causeId: cause.id,
              metaobjectId: cause.shopifyMetaobjectId ?? null,
              percentage: "100.00",
            },
          ]);
        } catch (error) {
          console.error("[Products] Shopify sync failed after bulk Cause assignment:", {
            productId: product.id,
            productTitle: product.title,
            shopifyProductId: product.shopifyId,
            error,
          });
          await auditProductShopifySyncFailure(shopId, product.id, product.shopifyId, error);
          syncFailures.push(product.title);
        }
      }
    }

    const messageParts = [`${cause.name} assigned to ${products.length} product${products.length === 1 ? "" : "s"}.`];
    if (syncSkipped.length > 0) {
      messageParts.push(`Skipped storefront sync for ${syncSkipped.length} local-only product${syncSkipped.length === 1 ? "" : "s"}.`);
    }
    if (syncFailures.length > 0) {
      messageParts.push(`Shopify storefront sync failed for ${syncFailures.length} product${syncFailures.length === 1 ? "" : "s"}; run a dev catalog sync and retry.`);
    }

    return jsonResponse({ ok: true, message: messageParts.join(" ") });
  }

  if (intent === "bulk-assign-artist") {
    const parsed = bulkAssignmentSchema.safeParse({
      productIds: formData.getAll("productId").map(String),
      artistId: formData.get("artistId")?.toString() ?? "",
    });

    if (!parsed.success) {
      return jsonResponse(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid bulk Artist assignment." },
        { status: 400 },
      );
    }

    if (!parsed.data.artistId) {
      return jsonResponse({ ok: false, message: "Choose an Artist to assign." }, { status: 400 });
    }

    const [artist, products] = await Promise.all([
      prisma.artist.findFirst({
        where: { id: parsed.data.artistId, shopId, status: "active" },
        select: { id: true, displayName: true },
      }),
      prisma.product.findMany({
        where: { id: { in: parsed.data.productIds }, shopId },
        select: { id: true, shopifyId: true, title: true },
      }),
    ]);

    if (!artist) {
      return jsonResponse({ ok: false, message: "Artist not found." }, { status: 404 });
    }
    if (products.length !== parsed.data.productIds.length) {
      return jsonResponse({ ok: false, message: "One or more selected products are unavailable." }, { status: 404 });
    }

    const syncFailures: string[] = [];
    const syncSkipped: string[] = [];

    try {
      for (const product of products) {
        const derivedAssignments = await prisma.$transaction(async (tx) => {
          return saveProductArtistAssignmentsLocally({
            db: tx,
            shopId,
            product,
            artistAssignments: [{
              artistId: artist.id,
              collaborationShare: "100",
              creditOverride: "",
              payoutEnabledOverride: "inherit",
              payoutRateOverride: "",
            }],
            auditSource: "products_bulk_editor",
          });
        });

        if (!admin) continue;

        if (!canSyncProductToShopify(product.shopifyId)) {
          syncSkipped.push(product.title);
          continue;
        }

        try {
          await syncProductArtistAssignmentsToShopify({ admin, product, derivedAssignments });
        } catch (error) {
          console.error("[Products] Shopify sync failed after bulk Artist assignment:", {
            productId: product.id,
            productTitle: product.title,
            shopifyProductId: product.shopifyId,
            error,
          });
          await auditProductShopifySyncFailure(shopId, product.id, product.shopifyId, error);
          syncFailures.push(product.title);
        }
      }
    } catch (error) {
      console.error("[Products] Bulk Artist assignment failed:", error);
      return jsonResponse(
        { ok: false, message: error instanceof Error ? error.message : "Unable to bulk assign Artist." },
        { status: 400 },
      );
    }

    const messageParts = [`${artist.displayName} assigned to ${products.length} product${products.length === 1 ? "" : "s"}.`];
    if (syncSkipped.length > 0) {
      messageParts.push(`Skipped storefront sync for ${syncSkipped.length} local-only product${syncSkipped.length === 1 ? "" : "s"}.`);
    }
    if (syncFailures.length > 0) {
      messageParts.push(`Shopify storefront sync failed for ${syncFailures.length} product${syncFailures.length === 1 ? "" : "s"}; run a dev catalog sync and retry.`);
    }

    return jsonResponse({ ok: true, message: messageParts.join(" ") });
  }

  return jsonResponse({ ok: false, message: "Unknown action." }, { status: 400 });
};

type ProductRow = {
  id: string;
  title: string;
  handle: string;
  status: string;
  variantCount: number;
  causeAssignmentCount: number;
  artistAssignmentCount: number;
  mappedVariantCount: number;
  mappedProviderCount: number;
};

type SyncActionData = {
  ok: boolean;
  message: string;
};

type BulkActionData = {
  ok: boolean;
  message: string;
};

type BulkMode = "cause" | "artist";

type CauseOption = {
  id: string;
  name: string;
};

type ArtistOption = {
  id: string;
  displayName: string;
};

function formatSyncDate(value: string | null) {
  if (!value) return "Not yet completed";
  return new Date(value).toLocaleString();
}

export default function ProductsPage() {
  const { catalogSynced, latestCatalogSync, products, causes, artists } = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<SyncActionData>();
  const bulkFetcher = useFetcher<BulkActionData>();
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState<BulkMode>("artist");
  const [selectedCauseId, setSelectedCauseId] = useState(causes[0]?.id ?? "");
  const [selectedArtistId, setSelectedArtistId] = useState(artists[0]?.id ?? "");
  const allSelected = products.length > 0 && selectedProductIds.length === products.length;
  const isBulkSubmitting = bulkFetcher.state !== "idle";

  useEffect(() => {
    setSelectedProductIds((current) => current.filter((id) => products.some((product: ProductRow) => product.id === id)));
  }, [products]);

  useEffect(() => {
    if (causes.length > 0 && !causes.some((cause: CauseOption) => cause.id === selectedCauseId)) {
      setSelectedCauseId(causes[0].id);
    }
  }, [causes, selectedCauseId]);

  useEffect(() => {
    if (artists.length > 0 && !artists.some((artist: ArtistOption) => artist.id === selectedArtistId)) {
      setSelectedArtistId(artists[0].id);
    }
  }, [artists, selectedArtistId]);

  function updateSelection(id: string, checked: boolean) {
    setSelectedProductIds((current) =>
      checked ? (current.includes(id) ? current : [...current, id]) : current.filter((value) => value !== id),
    );
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedProductIds(checked ? products.map((product: ProductRow) => product.id) : []);
  }

  function clearSelection() {
    setSelectedProductIds([]);
  }

  function submitBulkAssignment() {
    if (selectedProductIds.length === 0) return;

    const formData = new FormData();
    formData.append("intent", bulkMode === "cause" ? "bulk-assign-cause" : "bulk-assign-artist");
    selectedProductIds.forEach((id) => formData.append("productId", id));

    if (bulkMode === "cause") {
      formData.append("causeId", selectedCauseId);
    } else {
      formData.append("artistId", selectedArtistId);
    }

    bulkFetcher.submit(formData, { method: "post" });
    clearSelection();
  }

  return (
    <>
      <ui-title-bar title="Products" />
      <s-page>
        {bulkFetcher.data && !bulkFetcher.data.ok ? (
          <s-banner tone="critical">
            <s-text>{bulkFetcher.data.message}</s-text>
          </s-banner>
        ) : null}
        {bulkFetcher.data?.ok && bulkFetcher.data.message ? (
          <s-banner tone="success">
            <s-text>{bulkFetcher.data.message}</s-text>
          </s-banner>
        ) : null}

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
          <>
            {selectedProductIds.length > 0 ? (
              <s-section>
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <strong>{selectedProductIds.length} product{selectedProductIds.length === 1 ? "" : "s"} selected</strong>
                      <s-text color="subdued">Bulk assignment replaces each selected product&apos;s current donation routing.</s-text>
                    </div>
                    <s-button variant="secondary" onClick={clearSelection}>Clear selection</s-button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
                      gap: "1rem",
                      alignItems: "end",
                    }}
                  >
                    <div style={{ display: "grid", gap: "0.35rem" }}>
                      <label htmlFor="bulk-assignment-mode">Assign as</label>
                      <select
                        id="bulk-assignment-mode"
                        value={bulkMode}
                        onChange={(event) => setBulkMode(event.currentTarget.value as BulkMode)}
                        style={fieldStyle}
                      >
                        <option value="artist">Artist</option>
                        <option value="cause">Cause</option>
                      </select>
                    </div>

                    {bulkMode === "artist" ? (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor="bulk-artist">Artist</label>
                        <select
                          id="bulk-artist"
                          value={selectedArtistId}
                          onChange={(event) => setSelectedArtistId(event.currentTarget.value)}
                          style={fieldStyle}
                        >
                          {artists.map((artist: ArtistOption) => (
                            <option key={artist.id} value={artist.id}>{artist.displayName}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor="bulk-cause">Cause</label>
                        <select
                          id="bulk-cause"
                          value={selectedCauseId}
                          onChange={(event) => setSelectedCauseId(event.currentTarget.value)}
                          style={fieldStyle}
                        >
                          {causes.map((cause: CauseOption) => (
                            <option key={cause.id} value={cause.id}>{cause.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                      <s-button
                        variant="primary"
                        disabled={
                          isBulkSubmitting ||
                          selectedProductIds.length === 0 ||
                          (bulkMode === "artist" ? artists.length === 0 : causes.length === 0)
                        }
                        onClick={submitBulkAssignment}
                      >
                        Apply assignment
                      </s-button>
                    </div>
                  </div>
                </div>
              </s-section>
            ) : null}

            <s-section padding="none">
              <s-table>
              <ResourceTableHeader
                title="Product Donations"
                description="Assign Causes and Artists at the product level."
                action={
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => toggleSelectAll(event.currentTarget.checked)}
                    />
                    <span>Select all visible</span>
                  </label>
                }
              />

              <s-table-header-row>
                <s-table-header>Select</s-table-header>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Variants</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Artists</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Cause assignments</s-table-header>
                <s-table-header listSlot="secondary">POD coverage</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {products.map((product: ProductRow) => (
                  <s-table-row key={product.id}>
                    <s-table-cell>
                      <input
                        type="checkbox"
                        checked={selectedProductIds.includes(product.id)}
                        onChange={(event) => updateSelection(product.id, event.currentTarget.checked)}
                        aria-label={`Select ${product.title}`}
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <div style={{ display: "grid", gap: "0.2rem" }}>
                        <strong>{product.title}</strong>
                        <s-text color="subdued">/{product.handle}</s-text>
                      </div>
                    </s-table-cell>
                    <s-table-cell>{product.variantCount}</s-table-cell>
                    <s-table-cell>{product.artistAssignmentCount}</s-table-cell>
                    <s-table-cell>{product.causeAssignmentCount}</s-table-cell>
                    <s-table-cell>
                      {product.mappedVariantCount > 0 ? (
                        <div style={{ display: "grid", gap: "0.2rem" }}>
                          <strong>
                            {product.mappedVariantCount} of {product.variantCount}
                          </strong>
                          <s-text color="subdued">
                            {product.mappedProviderCount === 1 ? "1 provider mapped" : `${product.mappedProviderCount} providers mapped`}
                          </s-text>
                        </div>
                      ) : (
                        <s-text color="subdued">Manual only</s-text>
                      )}
                    </s-table-cell>
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
          </>
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
