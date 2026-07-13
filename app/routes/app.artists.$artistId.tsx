import { jsonResponse } from "~/utils/json-response.server";
import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useActionData, useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { AssignmentPicker, CompactAssignmentList } from "../components/AssignmentControls";
import { ArtistProfileForm } from "../components/ArtistProfileForm";
import { prisma } from "../db.server";
import { upsertArtistMetaobject } from "../services/artistMetaobjectService.server";
import {
  auditProductShopifySyncFailure,
  canSyncProductToShopify,
  saveProductArtistAssignmentsLocally,
  syncFullProductPublicAssignmentsToShopify,
  type ProductArtistAssignmentInput,
} from "../services/productArtistAssignmentService.server";
import { saveArtistProfileFromForm, type ArtistProfileActionData } from "../services/artistProfile.server";
import { syncProductDescriptionDonationSummary } from "../services/productDescriptionSummary.server";
import {
  deletePublicIcon,
  getPublicIconUrl,
  getUploadedIconFile,
  PublicIconUploadError,
  uploadPublicIcon,
} from "../services/publicIconStorage.server";
import { syncPublicIconToShopifyFile } from "../services/shopifyIconFileService.server";
import { authenticateAdminRequest, isPlaywrightBypassRequest } from "../utils/admin-auth.server";

const productMappingSchema = z.object({
  artistId: z.string().trim().min(1),
  mappings: z.array(
    z.object({
      productId: z.string().min(1),
      collaborationShare: z.string().min(1),
      creditOverride: z.string().optional(),
      payoutEnabledOverride: z.enum(["inherit", "true", "false"]),
      payoutRateOverride: z.string().optional(),
    }),
  ),
});

type ProductMappingActionData = {
  ok: boolean;
  message: string;
};

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

function buildArtistPublicIconUrl(shopId: string, artistId: string, iconStorageKey: string | null | undefined) {
  return iconStorageKey
    ? getPublicIconUrl({
        type: "artist",
        id: artistId,
        shopDomain: shopId,
        version: iconStorageKey,
      })
    : null;
}

type ProductMappingRow = {
  productId: string;
  productTitle: string;
  productHandle: string;
  productStatus: string;
  collaborationShare: string;
  creditOverride: string;
  payoutEnabledOverride: "inherit" | "true" | "false";
  payoutRateOverride: string;
  otherArtistShares: Array<{
    artistId: string;
    artistName: string;
    collaborationShare: string;
  }>;
};

type ProductSearchOption = {
  id: string;
  title: string;
  handle: string;
  status: string;
  artistShares: Array<{ artistId: string; artistName: string; collaborationShare: string }>;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const artistId = params.artistId ?? "";

  const [artist, causes, products] = await Promise.all([
    prisma.artist.findFirst({
      where: { id: artistId, shopId },
      include: {
        causeAssignments: {
          include: {
            cause: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { productAssignments: true, lineAllocations: true },
        },
        productAssignments: {
          where: { shopId, status: "active" },
          orderBy: [{ product: { title: "asc" } }, { createdAt: "asc" }],
          select: {
            productId: true,
            collaborationShare: true,
            creditOverride: true,
            payoutEnabledOverride: true,
            payoutRateOverride: true,
            product: {
              select: {
                id: true,
                title: true,
                handle: true,
                status: true,
                artistAssignments: {
                  where: { shopId, status: "active" },
                  orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
                  select: {
                    artistId: true,
                    collaborationShare: true,
                    artist: {
                      select: {
                        displayName: true,
                      },
                    },
                  },
                },
              },
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
    prisma.product.findMany({
      where: { shopId },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        handle: true,
        status: true,
        artistAssignments: {
          where: { shopId, status: "active" },
          select: {
            artistId: true,
            collaborationShare: true,
            artist: {
              select: { displayName: true },
            },
          },
        },
      },
    }),
  ]);

  if (!artist) {
    throw new Response("Not found", { status: 404 });
  }

  return jsonResponse({
    artist: {
      id: artist.id,
      displayName: artist.displayName,
      creditName: artist.creditName,
      creditPreference: artist.creditPreference,
      publicBio: artist.publicBio ?? "",
      iconPreviewUrl: artist.iconStorageKey ? buildArtistPublicIconUrl(shopId, artist.id, artist.iconStorageKey) ?? "" : "",
      websiteUrl: artist.websiteUrl ?? "",
      instagramUrl: artist.instagramUrl ?? "",
      contactName: artist.contactName ?? "",
      contactEmail: artist.contactEmail ?? "",
      status: artist.status,
      paymentEnabled: artist.paymentEnabled,
      defaultPayoutRate: artist.defaultPayoutRate.toString(),
      taxStatus: artist.taxStatus,
      paymentNotes: artist.paymentNotes ?? "",
      restrictedChannels: artist.restrictedChannels ?? "",
      restrictedFormats: artist.restrictedFormats ?? "",
      internalNotes: artist.internalNotes ?? "",
      productAssignmentCount: artist._count.productAssignments,
      historicalLineCount: artist._count.lineAllocations,
      causeAssignments: artist.causeAssignments.map((assignment) => ({
        causeId: assignment.causeId,
        causeName: assignment.cause.name,
        percentage: assignment.percentage.toString(),
      })),
      productMappings: artist.productAssignments.map((assignment) => ({
        productId: assignment.productId,
        productTitle: assignment.product.title,
        productHandle: assignment.product.handle,
        productStatus: assignment.product.status,
        collaborationShare: assignment.collaborationShare.toString(),
        creditOverride: assignment.creditOverride ?? "",
        payoutEnabledOverride:
          assignment.payoutEnabledOverride === null
            ? "inherit"
            : assignment.payoutEnabledOverride
              ? "true"
              : "false",
        payoutRateOverride: assignment.payoutRateOverride?.toString() ?? "",
        otherArtistShares: assignment.product.artistAssignments
          .filter((productAssignment) => productAssignment.artistId !== artist.id)
          .map((productAssignment) => ({
            artistId: productAssignment.artistId,
            artistName: productAssignment.artist.displayName,
            collaborationShare: productAssignment.collaborationShare.toString(),
          })),
      })),
    },
    causes,
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      artistShares: product.artistAssignments.map((assignment) => ({
        artistId: assignment.artistId,
        artistName: assignment.artist.displayName,
        collaborationShare: assignment.collaborationShare.toString(),
      })),
    })),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "update") {
    const result = await saveArtistProfileFromForm({
      shopId,
      formData,
      intent: "update",
    });

    if (result.ok) {
      const artist = await prisma.artist.findFirst({
        where: { id: result.artistId, shopId },
        select: {
          id: true,
          shopifyMetaobjectId: true,
          displayName: true,
          creditName: true,
          publicBio: true,
          iconUrl: true,
          iconStorageKey: true,
          shopifyIconMediaImageId: true,
          shopifyIconStorageKey: true,
          websiteUrl: true,
          instagramUrl: true,
          status: true,
        },
      });

      let artistForSync = artist;
      if (artist) {
        const iconFile = getUploadedIconFile(formData);
        if (iconFile) {
          try {
            const icon = await uploadPublicIcon({
              shopId,
              ownerType: "artist",
              ownerId: artist.id,
              file: iconFile,
            });
            await prisma.artist.update({
              where: { id: artist.id, shopId },
              data: {
                iconStorageKey: icon.key,
                iconUrl: null,
              },
            });
            if (artist.iconStorageKey) {
              await deletePublicIcon(artist.iconStorageKey);
            }
            artistForSync = { ...artist, iconUrl: null, iconStorageKey: icon.key };
          } catch (error) {
            if (error instanceof PublicIconUploadError) {
              return jsonResponse(
                { ok: false, message: error.message, fieldErrors: { iconFile: [error.message] } } satisfies ArtistProfileActionData,
                { status: 400 },
              );
            }
            throw error;
          }
        }
      }

      if (artistForSync && admin) {
        try {
          const iconImageId = await syncPublicIconToShopifyFile({
            admin,
            shopId,
            ownerType: "artist",
            ownerId: artistForSync.id,
            label: artistForSync.creditName || artistForSync.displayName,
            iconStorageKey: artistForSync.iconStorageKey,
            existingMediaImageId: artistForSync.shopifyIconMediaImageId,
            syncedStorageKey: artistForSync.shopifyIconStorageKey,
          });
          const artistMetaobjectInput = {
            ...artistForSync,
            iconUrl: artistForSync.iconStorageKey
              ? buildArtistPublicIconUrl(shopId, artistForSync.id, artistForSync.iconStorageKey)
              : artistForSync.iconUrl,
            iconImageId,
          };
          const metaobjectId = await upsertArtistMetaobject({
            admin,
            existingMetaobjectId: artistForSync.shopifyMetaobjectId,
            input: artistMetaobjectInput,
          });
          await prisma.artist.update({
            where: { id: artistForSync.id, shopId },
            data: {
              shopifyMetaobjectId: metaobjectId,
              shopifyIconMediaImageId: iconImageId,
              shopifyIconStorageKey: iconImageId ? artistForSync.iconStorageKey : null,
            },
          });
          await prisma.auditLog.create({
            data: {
              shopId,
              entity: "Artist",
              entityId: artistForSync.id,
              action: "ARTIST_SHOPIFY_SYNCED",
              actor: "merchant",
              payload: { shopifyMetaobjectId: metaobjectId },
            },
          });
        } catch (error) {
          await prisma.auditLog.create({
            data: {
              shopId,
              entity: "Artist",
              entityId: artistForSync.id,
              action: "ARTIST_SHOPIFY_SYNC_FAILED",
              actor: "merchant",
              payload: { message: error instanceof Error ? error.message : "Unknown Shopify sync failure" },
            },
          });
          return jsonResponse(
            {
              ok: true,
              message: `${result.message} Shopify storefront sync failed; save again later to retry.`,
            },
            { status: 200 },
          );
        }
      }
    }

    return jsonResponse(result, { status: result.ok ? 200 : 400 });
  }

  if (intent !== "save-product-mappings") {
    return jsonResponse({ ok: false, message: "Unsupported action." }, { status: 400 });
  }

  const isPlaywrightBypass = isPlaywrightBypassRequest(request);
  if (!admin && !isPlaywrightBypass) {
    return jsonResponse({ ok: false, message: "Shopify admin context is required." }, { status: 500 });
  }

  const rawMappings = formData.get("productMappings")?.toString() ?? "[]";
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawMappings);
  } catch {
    return jsonResponse({ ok: false, message: "Invalid product mappings." }, { status: 400 });
  }

  const parsed = productMappingSchema.safeParse({
    artistId: formData.get("artistId")?.toString() ?? params.artistId ?? "",
    mappings: parsedJson,
  });

  if (!parsed.success) {
    return jsonResponse(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid product mappings." },
      { status: 400 },
    );
  }

  const artist = await prisma.artist.findFirst({
    where: { id: parsed.data.artistId, shopId, status: "active" },
    select: {
      id: true,
      displayName: true,
      _count: {
        select: { causeAssignments: true },
      },
    },
  });

  if (!artist) {
    return jsonResponse({ ok: false, message: "Artist must be active before assigning products." }, { status: 404 });
  }

  const productIds = parsed.data.mappings.map((mapping) => mapping.productId);
  if (new Set(productIds).size !== productIds.length) {
    return jsonResponse({ ok: false, message: "Each product can only be assigned once per Artist." }, { status: 400 });
  }

  const existingAssignments = await prisma.productArtistAssignment.findMany({
    where: { shopId, artistId: artist.id, status: "active" },
    select: { productId: true },
  });
  const touchedProductIds = Array.from(new Set([...existingAssignments.map((assignment) => assignment.productId), ...productIds]));

  const products = touchedProductIds.length
    ? await prisma.product.findMany({
        where: { id: { in: touchedProductIds }, shopId },
        select: {
          id: true,
          shopifyId: true,
          title: true,
          artistAssignments: {
            where: { shopId, status: "active" },
            orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
            select: {
              artistId: true,
              collaborationShare: true,
              creditOverride: true,
              payoutEnabledOverride: true,
              payoutRateOverride: true,
            },
          },
        },
      })
    : [];

  if (products.length !== touchedProductIds.length) {
    return jsonResponse({ ok: false, message: "One or more selected products are unavailable." }, { status: 404 });
  }

  const mappingByProductId = new Map(parsed.data.mappings.map((mapping) => [mapping.productId, mapping]));
  const syncFailures: string[] = [];
  const syncSkipped: string[] = [];
  const shop = await prisma.shop.findUnique({
    where: { shopId },
    select: { productDescriptionDonationSummaryEnabled: true },
  });

  try {
    for (const product of products) {
      const currentArtistMapping = mappingByProductId.get(product.id);
      const nextAssignments: ProductArtistAssignmentInput[] = [
        ...product.artistAssignments
          .filter((assignment) => assignment.artistId !== artist.id)
          .map((assignment) => ({
            artistId: assignment.artistId,
            collaborationShare: assignment.collaborationShare.toString(),
            creditOverride: assignment.creditOverride ?? "",
            payoutEnabledOverride:
              assignment.payoutEnabledOverride === null
                ? "inherit" as const
                : assignment.payoutEnabledOverride
                  ? "true" as const
                  : "false" as const,
            payoutRateOverride: assignment.payoutRateOverride?.toString() ?? "",
          })),
        ...(currentArtistMapping
          ? [{
              artistId: artist.id,
              collaborationShare: currentArtistMapping.collaborationShare,
              creditOverride: currentArtistMapping.creditOverride ?? "",
              payoutEnabledOverride: currentArtistMapping.payoutEnabledOverride,
              payoutRateOverride: currentArtistMapping.payoutRateOverride ?? "",
            }]
          : []),
      ];

      const derivedAssignments = await prisma.$transaction(async (tx) => {
        return saveProductArtistAssignmentsLocally({
          db: tx,
          shopId,
          product,
          artistAssignments: nextAssignments,
          auditSource: "artists_bulk_editor",
        });
      });

      if (admin) {
        if (!canSyncProductToShopify(product.shopifyId)) {
          syncSkipped.push(product.title);
          continue;
        }

        try {
          await syncFullProductPublicAssignmentsToShopify({ admin, shopId, product, derivedAssignments });
          if (shop?.productDescriptionDonationSummaryEnabled) {
            await syncProductDescriptionDonationSummary({
              admin,
              shopId,
              product,
              enabled: true,
            });
          }
        } catch (error) {
          console.error("[ArtistDetails] Shopify sync failed after saving product mappings:", {
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

    const messageParts = [`Product mappings saved for ${artist.displayName}.`];
    if (artist._count.causeAssignments === 0) {
      messageParts.push(
        "Add at least one Cause to this Artist before product descriptions can show Cause names or estimated donations.",
      );
    }
    if (syncSkipped.length > 0) {
      messageParts.push(
        `Skipped Shopify storefront sync for ${syncSkipped.length} local-only product${syncSkipped.length === 1 ? "" : "s"}.`,
      );
    }
    if (syncFailures.length > 0) {
      messageParts.push(
        `Shopify storefront sync failed for ${syncFailures.length} product${syncFailures.length === 1 ? "" : "s"}; run a dev catalog sync and save again to retry.`,
      );
    }

    return jsonResponse({
      ok: true,
      message: messageParts.join(" "),
    });
  } catch (error) {
    console.error("[ArtistDetails] Failed to save product mappings:", error);
    return jsonResponse(
      { ok: false, message: error instanceof Error ? error.message : "Unable to save product mappings." },
      { status: 400 },
    );
  }
};

function ProductMappingsEditor({
  artist,
  products,
}: {
  artist: { id: string; productMappings: ProductMappingRow[] };
  products: ProductSearchOption[];
}) {
  const mappingFetcher = useFetcher<ProductMappingActionData>();
  const [rows, setRows] = useState<ProductMappingRow[]>(() => artist.productMappings);
  const selectedProductIds = useMemo(() => new Set(rows.map((row) => row.productId)), [rows]);
  const isSubmitting = mappingFetcher.state !== "idle";

  function addProducts(productIds: string[]) {
    const productsToAdd = productIds
      .map((productId) => products.find((product) => product.id === productId))
      .filter((product): product is ProductSearchOption => Boolean(product));
    setRows((current) => [
      ...current,
      ...productsToAdd
        .filter((product) => !current.some((row) => row.productId === product.id))
        .map((product) => {
          const otherArtistShares = product.artistShares.filter((share) => share.artistId !== artist.id);
          const otherShareTotal = otherArtistShares.reduce((sum, share) => sum + (Number(share.collaborationShare) || 0), 0);
          return {
            productId: product.id,
            productTitle: product.title,
            productHandle: product.handle,
            productStatus: product.status,
            collaborationShare: Math.max(0, 100 - otherShareTotal).toString(),
            creditOverride: "",
            payoutEnabledOverride: "inherit" as const,
            payoutRateOverride: "",
            otherArtistShares,
          };
        }),
    ]);
  }

  function updateRow(index: number, patch: Partial<ProductMappingRow>) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function saveProductMappings() {
    const formData = new FormData();
    formData.append("intent", "save-product-mappings");
    formData.append("artistId", artist.id);
    formData.append(
      "productMappings",
      JSON.stringify(rows.map((row) => ({
        productId: row.productId,
        collaborationShare: row.collaborationShare,
        creditOverride: row.creditOverride,
        payoutEnabledOverride: row.payoutEnabledOverride,
        payoutRateOverride: row.payoutRateOverride,
      }))),
    );
    mappingFetcher.submit(formData, { method: "post" });
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {mappingFetcher.data && !mappingFetcher.data.ok ? (
        <s-banner tone="critical">
          <s-text>{mappingFetcher.data.message}</s-text>
        </s-banner>
      ) : null}
      {mappingFetcher.data?.ok && mappingFetcher.data.message ? (
        <s-banner tone="success">
          <s-text>{mappingFetcher.data.message}</s-text>
        </s-banner>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "var(--p-color-text-subdued, #6d7175)" }}>{rows.length} selected</span>
        <AssignmentPicker
          id={`product-picker-${artist.id}`}
          label="Add products"
          triggerLabel="Add products"
          options={products.map((product) => {
            const otherArtistShares = product.artistShares.filter((share) => share.artistId !== artist.id);
            const otherShareTotal = otherArtistShares.reduce((sum, share) => sum + (Number(share.collaborationShare) || 0), 0);
            return {
              id: product.id,
              label: product.title,
              description: `/${product.handle}`,
              meta: [
                product.status,
                ...(otherArtistShares.length > 0 ? [`${otherShareTotal.toFixed(2)}% already assigned`] : []),
              ],
            };
          })}
          selectedIds={selectedProductIds}
          onAdd={addProducts}
          searchPlaceholder="Search products by title, handle, or status"
          emptyText="No products match that search."
        />
      </div>

      <CompactAssignmentList
        emptyText="No products are assigned to this Artist."
        searchPlaceholder="Filter selected products"
        items={rows.map((row, index) => {
          const otherShareTotal = row.otherArtistShares.reduce((sum, share) => sum + (Number(share.collaborationShare) || 0), 0);
          const productTotal = otherShareTotal + (Number(row.collaborationShare) || 0);
          return {
            id: row.productId,
            title: row.productTitle,
            subtitle: `/${row.productHandle} · ${row.productStatus}`,
            searchText: `${row.productTitle} ${row.productHandle} ${row.productStatus}`,
            summary: (
              <span style={{ color: productTotal !== 100 ? "var(--p-color-text-critical, #8e1f1f)" : "var(--p-color-text-subdued, #6d7175)" }}>
                {Number(row.collaborationShare || 0).toFixed(2)}% share
              </span>
            ),
            tone: productTotal !== 100 ? "critical" as const : "default" as const,
            details: (
              <div
                style={{
                  display: "grid",
                  gap: "0.75rem",
                  gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
                }}
              >
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor={`product-share-${artist.id}-${index}`}>Share</label>
                  <input
                    id={`product-share-${artist.id}-${index}`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={row.collaborationShare}
                    onChange={(event) => updateRow(index, { collaborationShare: event.currentTarget.value })}
                    style={fieldStyle}
                  />
                  <span style={{ color: "var(--p-color-text-subdued, #6d7175)" }}>
                    Product total: {productTotal.toFixed(2)}%
                  </span>
                </div>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor={`product-credit-${artist.id}-${index}`}>Credit override</label>
                  <input
                    id={`product-credit-${artist.id}-${index}`}
                    type="text"
                    value={row.creditOverride}
                    onChange={(event) => updateRow(index, { creditOverride: event.currentTarget.value })}
                    style={fieldStyle}
                  />
                </div>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor={`product-payout-enabled-${artist.id}-${index}`}>Payout rule</label>
                  <select
                    id={`product-payout-enabled-${artist.id}-${index}`}
                    value={row.payoutEnabledOverride}
                    onChange={(event) => updateRow(index, { payoutEnabledOverride: event.currentTarget.value as ProductMappingRow["payoutEnabledOverride"] })}
                    style={fieldStyle}
                  >
                    <option value="inherit">Artist default</option>
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                </div>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor={`product-payout-rate-${artist.id}-${index}`}>Payout rate override</label>
                  <input
                    id={`product-payout-rate-${artist.id}-${index}`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="Use Artist default"
                    value={row.payoutRateOverride}
                    onChange={(event) => updateRow(index, { payoutRateOverride: event.currentTarget.value })}
                    style={fieldStyle}
                  />
                </div>
                <div style={{ color: "var(--p-color-text-subdued, #6d7175)" }}>
                  {row.otherArtistShares.length > 0
                    ? `Other Artists: ${row.otherArtistShares.map((share) => `${share.artistName} ${Number(share.collaborationShare).toFixed(2)}%`).join(", ")}`
                    : "No other Artists assigned"}
                </div>
              </div>
            ),
            actions: (
              <button type="button" onClick={() => removeRow(index)} style={{ ...fieldStyle, width: "auto", padding: "0.55rem 0.75rem", color: "var(--p-color-text-critical, #8e1f1f)" }}>
                Remove
              </button>
            ),
          };
        })}
      />

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <s-button type="button" variant="primary" disabled={isSubmitting} onClick={saveProductMappings}>
          Save product mappings
        </s-button>
      </div>
    </div>
  );
}

export default function ArtistDetailsPage() {
  const { artist, causes, products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ArtistProfileActionData | undefined;

  return (
    <>
      <ui-title-bar title={artist.displayName} />
      <s-page>
        <s-section heading={artist.displayName}>
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            <Link to="/app/artists">Back to Artists</Link>
            <span>Products: {artist.productAssignmentCount}</span>
            <span>Historical lines: {artist.historicalLineCount}</span>
          </div>
        </s-section>

        {actionData?.ok && actionData.message ? (
          <s-banner tone="success">
            <s-text>{actionData.message}</s-text>
          </s-banner>
        ) : null}

        <s-section heading="Artist profile">
          <ArtistProfileForm
            artist={artist}
            causes={causes}
            intent="update"
            actionData={actionData?.ok === false ? actionData : undefined}
          />
        </s-section>

        <s-section heading="Product mappings">
          <ProductMappingsEditor artist={artist} products={products} />
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[ArtistDetails] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Artist" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading the Artist. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
