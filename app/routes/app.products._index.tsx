import { jsonResponse } from "~/utils/json-response.server";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteError,
  useSearchParams,
} from "@remix-run/react";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  AssignmentFilterPicker,
  AssignmentPicker,
} from "../components/AssignmentControls";
import {
  ResourceTableHeader,
  TableColumnFilter,
  TableTextFilterFields,
} from "../components/admin-ui";
import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import {
  auditProductShopifySyncFailure,
  canSyncProductToShopify,
  saveProductArtistAssignmentsLocally,
  syncFullProductPublicAssignmentsToShopify,
} from "../services/productArtistAssignmentService.server";
import { syncProductDescriptionDonationSummary } from "../services/productDescriptionSummary.server";
import { canWriteShopifyProducts } from "../services/productPublicMetafieldService.server";
import {
  authenticateAdminRequest,
  isPlaywrightBypassRequest,
} from "../utils/admin-auth.server";
import { isVariantCostConfigured } from "../utils/variant-cost-readiness";
import { buildTextFilter, parseTextMatchMode } from "../utils/text-filter";
import { buildProductSearchFilter } from "../utils/product-search";

const bulkAssignmentSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1, "Select at least one product."),
  artistId: z.string().min(1).optional(),
});

const bulkCauseRoutingSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1, "Select at least one product."),
  assignments: z.array(
    z.object({
      causeId: z.string().min(1),
      percentage: z
        .string()
        .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid Cause percentage."),
    }),
  ),
  confirmNoCauseOverride: z.boolean(),
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
  const url = new URL(request.url);
  const filterProduct = url.searchParams.get("productQuery")?.trim() ?? "";
  const filterPodProvider = url.searchParams.get("podProvider")?.trim() ?? "";
  const filterStatus = url.searchParams.get("status")?.trim() ?? "";
  const filterTags = [
    ...new Set(
      url.searchParams
        .getAll("tag")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const filterCollectionIds = [
    ...new Set(
      url.searchParams
        .getAll("collection")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const filterProductMatch = parseTextMatchMode(
    url.searchParams.get("productQueryMatch"),
  );
  const filterPodProviderMatch = parseTextMatchMode(
    url.searchParams.get("podProviderMatch"),
    true,
  );

  const [
    shop,
    latestCatalogSync,
    products,
    causes,
    artists,
    availableTags,
    availableCollections,
  ] = await Promise.all([
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
      where: {
        shopId,
        ...(filterProduct
          ? buildProductSearchFilter(filterProduct, filterProductMatch)
          : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterTags.length > 0
          ? { tags: { some: { shopId, value: { in: filterTags } } } }
          : {}),
        ...(filterCollectionIds.length > 0
          ? {
              collections: {
                some: { shopId, collectionId: { in: filterCollectionIds } },
              },
            }
          : {}),
        ...(filterPodProviderMatch !== "empty" && filterPodProvider
          ? {
              variants: {
                some: {
                  providerMappings: {
                    some: {
                      status: "mapped",
                      provider: buildTextFilter(
                        filterPodProvider,
                        filterPodProviderMatch,
                      ),
                    },
                  },
                },
              },
            }
          : {}),
        ...(filterPodProviderMatch === "empty"
          ? {
              variants: {
                none: { providerMappings: { some: { status: "mapped" } } },
              },
            }
          : {}),
      },
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
            costConfig: {
              select: {
                productionTemplateId: true,
                shippingTemplateId: true,
                _count: {
                  select: {
                    materialLines: true,
                    equipmentLines: true,
                  },
                },
              },
            },
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
    prisma.productTag.findMany({
      where: { shopId },
      distinct: ["value"],
      orderBy: { value: "asc" },
      select: { value: true },
    }),
    prisma.shopifyCollection.findMany({
      where: { shopId },
      orderBy: { title: "asc" },
      select: { id: true, title: true, handle: true },
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
      configuredVariantCount: product.variants.filter((variant) =>
        isVariantCostConfigured(variant.costConfig),
      ).length,
      causeAssignmentCount: product._count.causeAssignments,
      artistAssignmentCount: product.artistAssignments.length,
      donationRoutingMode: product.donationRoutingMode,
      mappedVariantCount: product.variants.filter(
        (variant) => variant.providerMappings.length > 0,
      ).length,
      mappedProviders: Array.from(
        new Set(
          product.variants.flatMap((variant) =>
            variant.providerMappings.map((mapping) => mapping.provider),
          ),
        ),
      ),
    })),
    causes,
    artists,
    availableTags: availableTags.map((tag) => ({
      id: tag.value,
      label: tag.value,
    })),
    availableCollections: availableCollections.map((collection) => ({
      id: collection.id,
      label: collection.title,
      description: collection.handle,
    })),
    filterProduct,
    filterTags,
    filterCollectionIds,
    filterPodProvider,
    filterStatus,
    filterPodProviderMatch,
    filterProductMatch,
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

  if (intent === "bulk-set-cause-routing") {
    let rawAssignments: unknown;
    try {
      rawAssignments = JSON.parse(
        formData.get("assignments")?.toString() ?? "[]",
      );
    } catch {
      return jsonResponse(
        { ok: false, message: "Invalid bulk Cause assignments." },
        { status: 400 },
      );
    }
    const parsed = bulkCauseRoutingSchema.safeParse({
      productIds: formData.getAll("productId").map(String),
      assignments: rawAssignments,
      confirmNoCauseOverride:
        formData.get("confirmNoCauseOverride")?.toString() === "yes",
    });

    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          message:
            parsed.error.issues[0]?.message ?? "Invalid bulk Cause routing.",
        },
        { status: 400 },
      );
    }

    const causeIds = parsed.data.assignments.map(
      (assignment) => assignment.causeId,
    );
    if (causeIds.length === 0 && !parsed.data.confirmNoCauseOverride) {
      return jsonResponse(
        { ok: false, message: "Confirm the explicit no-Cause routing choice." },
        { status: 400 },
      );
    }
    if (new Set(causeIds).size !== causeIds.length) {
      return jsonResponse(
        { ok: false, message: "Each Cause can only be included once." },
        { status: 400 },
      );
    }
    const total = parsed.data.assignments.reduce(
      (sum, assignment) => sum.add(new Prisma.Decimal(assignment.percentage)),
      new Prisma.Decimal(0),
    );
    if (
      total.gt(100) ||
      parsed.data.assignments.some((assignment) =>
        new Prisma.Decimal(assignment.percentage).lte(0),
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          message:
            "Cause percentages must be greater than 0 and total 100% or less.",
        },
        { status: 400 },
      );
    }

    const [selectedCauses, products] = await Promise.all([
      prisma.cause.findMany({
        where: { id: { in: causeIds }, shopId, status: "active" },
        select: { id: true, name: true, shopifyMetaobjectId: true },
      }),
      prisma.product.findMany({
        where: { id: { in: parsed.data.productIds }, shopId },
        select: {
          id: true,
          shopifyId: true,
          title: true,
          donationRoutingMode: true,
          _count: {
            select: { artistAssignments: { where: { status: "active" } } },
          },
        },
      }),
    ]);

    if (selectedCauses.length !== causeIds.length) {
      return jsonResponse(
        { ok: false, message: "One or more selected Causes are unavailable." },
        { status: 404 },
      );
    }
    if (products.length !== parsed.data.productIds.length) {
      return jsonResponse(
        {
          ok: false,
          message: "One or more selected products are unavailable.",
        },
        { status: 404 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.productCauseAssignment.deleteMany({
        where: {
          shopId,
          productId: { in: products.map((product) => product.id) },
        },
      });
      const assignmentRows = products.flatMap((product) =>
        parsed.data.assignments.map((assignment) => ({
          shopId,
          shopifyProductId: product.shopifyId,
          productId: product.id,
          causeId: assignment.causeId,
          percentage: new Prisma.Decimal(assignment.percentage),
        })),
      );
      if (assignmentRows.length > 0)
        await tx.productCauseAssignment.createMany({ data: assignmentRows });
      const artistProductIds = products
        .filter((product) => product._count.artistAssignments > 0)
        .map((product) => product.id);
      const directProductIds = products
        .filter((product) => product._count.artistAssignments === 0)
        .map((product) => product.id);
      if (artistProductIds.length > 0) {
        await tx.product.updateMany({
          where: { shopId, id: { in: artistProductIds } },
          data: { donationRoutingMode: "product_override" },
        });
      }
      if (directProductIds.length > 0) {
        await tx.product.updateMany({
          where: { shopId, id: { in: directProductIds } },
          data: { donationRoutingMode: "automatic" },
        });
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "Product",
          action: "PRODUCT_CAUSE_ROUTING_BULK_SET",
          actor: "merchant",
          payload: {
            causeIds,
            productCount: products.length,
            productIds: products.map((product) => product.id),
          },
        },
      });
    });

    const syncFailures: string[] = [];
    const syncSkipped: string[] = [];
    const shop = await prisma.shop.findUnique({
      where: { shopId },
      select: { productDescriptionDonationSummaryEnabled: true },
    });
    if (admin) {
      const canWriteProducts = await canWriteShopifyProducts({ admin, shopId });
      for (const product of products) {
        if (!canSyncProductToShopify(product.shopifyId)) {
          syncSkipped.push(product.title);
          continue;
        }

        try {
          const causeMap = new Map(
            selectedCauses.map((cause) => [cause.id, cause]),
          );
          await syncFullProductPublicAssignmentsToShopify({
            admin,
            shopId,
            product,
            canWriteProducts,
            derivedAssignments: parsed.data.assignments.map((assignment) => ({
              causeId: assignment.causeId,
              name:
                causeMap.get(assignment.causeId)?.name ?? assignment.causeId,
              metaobjectId:
                causeMap.get(assignment.causeId)?.shopifyMetaobjectId ?? null,
              percentage: new Prisma.Decimal(assignment.percentage),
            })),
          });
          if (shop?.productDescriptionDonationSummaryEnabled) {
            await syncProductDescriptionDonationSummary({
              admin,
              shopId,
              product,
              enabled: true,
              canWriteProducts,
            });
          }
        } catch (error) {
          console.error(
            "[Products] Shopify sync failed after bulk Cause assignment:",
            {
              productId: product.id,
              productTitle: product.title,
              shopifyProductId: product.shopifyId,
              error,
            },
          );
          await auditProductShopifySyncFailure(
            shopId,
            product.id,
            product.shopifyId,
            error,
          );
          syncFailures.push(product.title);
        }
      }
    }

    const messageParts = [
      `Cause routing updated for ${products.length} product${products.length === 1 ? "" : "s"} without removing Artists.`,
    ];
    if (syncSkipped.length > 0) {
      messageParts.push(
        `Skipped storefront sync for ${syncSkipped.length} local-only product${syncSkipped.length === 1 ? "" : "s"}.`,
      );
    }
    if (syncFailures.length > 0) {
      messageParts.push(
        `Shopify storefront sync failed for ${syncFailures.length} product${syncFailures.length === 1 ? "" : "s"}; run a dev catalog sync and retry.`,
      );
    }

    return jsonResponse({ ok: true, message: messageParts.join(" ") });
  }

  if (intent === "bulk-clear-cause-overrides") {
    const productIds = formData.getAll("productId").map(String);
    if (productIds.length === 0) {
      return jsonResponse(
        { ok: false, message: "Select at least one product." },
        { status: 400 },
      );
    }
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, shopId },
      select: {
        id: true,
        shopifyId: true,
        title: true,
        donationRoutingMode: true,
        artistAssignments: {
          where: { shopId, status: "active" },
          orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
          select: {
            collaborationShare: true,
            artist: {
              select: {
                causeAssignments: {
                  select: {
                    causeId: true,
                    percentage: true,
                    cause: {
                      select: { name: true, shopifyMetaobjectId: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (products.length !== productIds.length) {
      return jsonResponse(
        {
          ok: false,
          message: "One or more selected products are unavailable.",
        },
        { status: 404 },
      );
    }

    const changedProducts = products.filter(
      (product) =>
        product.donationRoutingMode === "product_override" &&
        product.artistAssignments.length > 0,
    );
    const rollups = new Map<
      string,
      Array<{
        causeId: string;
        name: string;
        metaobjectId: string | null;
        percentage: Prisma.Decimal;
      }>
    >();
    for (const product of changedProducts) {
      const byCause = new Map<
        string,
        {
          causeId: string;
          name: string;
          metaobjectId: string | null;
          percentage: Prisma.Decimal;
        }
      >();
      for (const assignment of product.artistAssignments) {
        for (const causeAssignment of assignment.artist.causeAssignments) {
          const weighted = assignment.collaborationShare
            .mul(causeAssignment.percentage)
            .div(100);
          const current = byCause.get(causeAssignment.causeId);
          if (current) current.percentage = current.percentage.add(weighted);
          else
            byCause.set(causeAssignment.causeId, {
              causeId: causeAssignment.causeId,
              name: causeAssignment.cause.name,
              metaobjectId: causeAssignment.cause.shopifyMetaobjectId,
              percentage: weighted,
            });
        }
      }
      rollups.set(product.id, Array.from(byCause.values()));
    }

    if (changedProducts.length > 0) {
      await prisma.$transaction(async (tx) => {
        const changedIds = changedProducts.map((product) => product.id);
        await tx.productCauseAssignment.deleteMany({
          where: { shopId, productId: { in: changedIds } },
        });
        const rows = changedProducts.flatMap((product) =>
          (rollups.get(product.id) ?? []).map((assignment) => ({
            shopId,
            productId: product.id,
            shopifyProductId: product.shopifyId,
            causeId: assignment.causeId,
            percentage: assignment.percentage,
          })),
        );
        if (rows.length > 0)
          await tx.productCauseAssignment.createMany({ data: rows });
        await tx.product.updateMany({
          where: { shopId, id: { in: changedIds } },
          data: { donationRoutingMode: "automatic" },
        });
        await tx.auditLog.create({
          data: {
            shopId,
            entity: "Product",
            action: "PRODUCT_CAUSE_OVERRIDES_BULK_CLEARED",
            actor: "merchant",
            payload: {
              productIds: changedIds,
              productCount: changedIds.length,
            },
          },
        });
      });
    }

    if (admin) {
      const canWriteProducts = await canWriteShopifyProducts({ admin, shopId });
      const shop = await prisma.shop.findUnique({
        where: { shopId },
        select: { productDescriptionDonationSummaryEnabled: true },
      });
      for (const product of changedProducts) {
        if (!canSyncProductToShopify(product.shopifyId)) continue;
        const derivedAssignments = rollups.get(product.id) ?? [];
        try {
          await syncFullProductPublicAssignmentsToShopify({
            admin,
            shopId,
            product,
            derivedAssignments,
            canWriteProducts,
          });
          if (shop?.productDescriptionDonationSummaryEnabled) {
            await syncProductDescriptionDonationSummary({
              admin,
              shopId,
              product,
              enabled: true,
              canWriteProducts,
            });
          }
        } catch (error) {
          await auditProductShopifySyncFailure(
            shopId,
            product.id,
            product.shopifyId,
            error,
          );
        }
      }
    }

    return jsonResponse({
      ok: true,
      message: `${changedProducts.length} product override${changedProducts.length === 1 ? "" : "s"} cleared; ${products.length - changedProducts.length} selected product${products.length - changedProducts.length === 1 ? " was" : "s were"} unchanged.`,
    });
  }

  if (intent === "bulk-assign-artist") {
    const parsed = bulkAssignmentSchema.safeParse({
      productIds: formData.getAll("productId").map(String),
      artistId: formData.get("artistId")?.toString() ?? "",
    });

    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          message:
            parsed.error.issues[0]?.message ??
            "Invalid bulk Artist assignment.",
        },
        { status: 400 },
      );
    }

    if (!parsed.data.artistId) {
      return jsonResponse(
        { ok: false, message: "Choose an Artist to assign." },
        { status: 400 },
      );
    }

    const [artist, products] = await Promise.all([
      prisma.artist.findFirst({
        where: { id: parsed.data.artistId, shopId, status: "active" },
        select: { id: true, displayName: true },
      }),
      prisma.product.findMany({
        where: { id: { in: parsed.data.productIds }, shopId },
        select: {
          id: true,
          shopifyId: true,
          title: true,
          donationRoutingMode: true,
          _count: {
            select: {
              causeAssignments: true,
              artistAssignments: { where: { status: "active" } },
            },
          },
        },
      }),
    ]);

    if (!artist) {
      return jsonResponse(
        { ok: false, message: "Artist not found." },
        { status: 404 },
      );
    }
    if (products.length !== parsed.data.productIds.length) {
      return jsonResponse(
        {
          ok: false,
          message: "One or more selected products are unavailable.",
        },
        { status: 404 },
      );
    }

    const syncFailures: string[] = [];
    const syncSkipped: string[] = [];
    const shop = await prisma.shop.findUnique({
      where: { shopId },
      select: { productDescriptionDonationSummaryEnabled: true },
    });

    try {
      const canWriteProducts = admin
        ? await canWriteShopifyProducts({ admin, shopId })
        : false;
      for (const product of products) {
        const derivedAssignments = await prisma.$transaction(async (tx) => {
          const preserveDirectRouting =
            product.donationRoutingMode === "automatic" &&
            product._count.artistAssignments === 0 &&
            product._count.causeAssignments > 0;
          if (preserveDirectRouting) {
            await tx.product.update({
              where: { id: product.id, shopId },
              data: { donationRoutingMode: "product_override" },
            });
          }
          return saveProductArtistAssignmentsLocally({
            db: tx,
            shopId,
            product: {
              ...product,
              donationRoutingMode: preserveDirectRouting
                ? "product_override"
                : product.donationRoutingMode,
            },
            artistAssignments: [
              {
                artistId: artist.id,
                collaborationShare: "100",
                creditOverride: "",
                payoutEnabledOverride: "inherit",
                payoutRateOverride: "",
              },
            ],
            auditSource: "products_bulk_editor",
          });
        });

        if (!admin) continue;

        if (!canSyncProductToShopify(product.shopifyId)) {
          syncSkipped.push(product.title);
          continue;
        }

        try {
          await syncFullProductPublicAssignmentsToShopify({
            admin,
            shopId,
            product,
            derivedAssignments,
            canWriteProducts,
          });
          if (shop?.productDescriptionDonationSummaryEnabled) {
            await syncProductDescriptionDonationSummary({
              admin,
              shopId,
              product,
              enabled: true,
              canWriteProducts,
            });
          }
        } catch (error) {
          console.error(
            "[Products] Shopify sync failed after bulk Artist assignment:",
            {
              productId: product.id,
              productTitle: product.title,
              shopifyProductId: product.shopifyId,
              error,
            },
          );
          await auditProductShopifySyncFailure(
            shopId,
            product.id,
            product.shopifyId,
            error,
          );
          syncFailures.push(product.title);
        }
      }
    } catch (error) {
      console.error("[Products] Bulk Artist assignment failed:", error);
      return jsonResponse(
        {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Unable to bulk assign Artist.",
        },
        { status: 400 },
      );
    }

    const messageParts = [
      `${artist.displayName} assigned to ${products.length} product${products.length === 1 ? "" : "s"}.`,
    ];
    if (syncSkipped.length > 0) {
      messageParts.push(
        `Skipped storefront sync for ${syncSkipped.length} local-only product${syncSkipped.length === 1 ? "" : "s"}.`,
      );
    }
    if (syncFailures.length > 0) {
      messageParts.push(
        `Shopify storefront sync failed for ${syncFailures.length} product${syncFailures.length === 1 ? "" : "s"}; run a dev catalog sync and retry.`,
      );
    }

    return jsonResponse({ ok: true, message: messageParts.join(" ") });
  }

  return jsonResponse(
    { ok: false, message: "Unknown action." },
    { status: 400 },
  );
};

type ProductRow = {
  id: string;
  title: string;
  handle: string;
  status: string;
  variantCount: number;
  configuredVariantCount: number;
  causeAssignmentCount: number;
  artistAssignmentCount: number;
  donationRoutingMode: string;
  mappedVariantCount: number;
  mappedProviders: string[];
};

type SyncActionData = {
  ok: boolean;
  message: string;
};

type BulkActionData = {
  ok: boolean;
  message: string;
};

type BulkMode = "cause" | "artist" | "clear_override";

type BulkCauseRow = { causeId: string; percentage: string };

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

function formatProviderLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function variantCostReadinessTitle(product: ProductRow) {
  if (product.variantCount === 0) {
    return "No variants are synced for this product yet.";
  }
  if (product.configuredVariantCount === product.variantCount) {
    return `All ${product.variantCount} variants have cost information configured.`;
  }
  const remaining = product.variantCount - product.configuredVariantCount;
  return `${product.configuredVariantCount} of ${product.variantCount} variants have cost information configured. Configure ${remaining} remaining variant${remaining === 1 ? "" : "s"} before relying on estimates.`;
}

function donationRoutingLabel(product: ProductRow) {
  if (product.donationRoutingMode === "product_override")
    return "Product override";
  if (product.artistAssignmentCount > 0) return "Artist preferences";
  if (product.causeAssignmentCount > 0) return "Direct product";
  return "Not configured";
}

export default function ProductsPage() {
  const {
    catalogSynced,
    latestCatalogSync,
    products,
    causes,
    artists,
    availableTags,
    availableCollections,
    filterProduct,
    filterTags,
    filterCollectionIds,
    filterPodProvider,
    filterStatus,
    filterPodProviderMatch,
    filterProductMatch,
  } = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<SyncActionData>();
  const bulkFetcher = useFetcher<BulkActionData>();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState<BulkMode>("artist");
  const [bulkCauseRows, setBulkCauseRows] = useState<BulkCauseRow[]>([]);
  const [bulkNoCauseOverride, setBulkNoCauseOverride] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState(
    artists[0]?.id ?? "",
  );
  const allSelected =
    products.length > 0 && selectedProductIds.length === products.length;
  const isBulkSubmitting = bulkFetcher.state !== "idle";
  const selectedArtist =
    artists.find((artist: ArtistOption) => artist.id === selectedArtistId) ??
    null;
  const hasProductFilters = Boolean(
    filterProduct ||
    filterTags.length > 0 ||
    filterCollectionIds.length > 0 ||
    filterPodProvider ||
    filterStatus ||
    filterPodProviderMatch === "empty",
  );

  useEffect(() => {
    setSelectedProductIds((current) =>
      current.filter((id) =>
        products.some((product: ProductRow) => product.id === id),
      ),
    );
  }, [products]);

  useEffect(() => {
    if (
      artists.length > 0 &&
      !artists.some((artist: ArtistOption) => artist.id === selectedArtistId)
    ) {
      setSelectedArtistId(artists[0].id);
    }
  }, [artists, selectedArtistId]);

  function updateSelection(id: string, checked: boolean) {
    setSelectedProductIds((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((value) => value !== id),
    );
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedProductIds(
      checked ? products.map((product: ProductRow) => product.id) : [],
    );
  }

  function clearSelection() {
    setSelectedProductIds([]);
  }

  function submitBulkAssignment() {
    if (selectedProductIds.length === 0) return;

    const formData = new FormData();
    formData.append(
      "intent",
      bulkMode === "cause"
        ? "bulk-set-cause-routing"
        : bulkMode === "clear_override"
          ? "bulk-clear-cause-overrides"
          : "bulk-assign-artist",
    );
    selectedProductIds.forEach((id) => formData.append("productId", id));

    if (bulkMode === "cause") {
      formData.append("assignments", JSON.stringify(bulkCauseRows));
      if (bulkNoCauseOverride) {
        if (
          !window.confirm(
            "Apply explicit no-Cause routing to all selected products? Artist attribution and payouts remain active, but no Cause obligation will be created.",
          )
        )
          return;
        formData.append("confirmNoCauseOverride", "yes");
      }
    } else if (bulkMode === "artist") {
      formData.append("artistId", selectedArtistId);
    }

    if (
      bulkMode === "clear_override" &&
      !window.confirm(
        "Clear Cause overrides for selected Artist-routed products? Products without overrides will be unchanged.",
      )
    )
      return;

    bulkFetcher.submit(formData, { method: "post" });
    clearSelection();
  }

  const bulkCauseTotal = bulkCauseRows.reduce(
    (sum, row) => sum + (Number(row.percentage) || 0),
    0,
  );
  const invalidBulkCauseRouting =
    bulkMode === "cause" &&
    !bulkNoCauseOverride &&
    (bulkCauseRows.length === 0 ||
      bulkCauseTotal > 100 ||
      bulkCauseRows.some((row) => !row.percentage));

  function variantsUrl(productId: string) {
    const params = new URLSearchParams(search);
    params.set("product", productId);
    const query = params.toString();
    return `/app/variants${query ? `?${query}` : ""}`;
  }

  function applyProductFilters(form: HTMLFormElement) {
    const formData = new FormData(form);
    const params = new URLSearchParams(searchParams);
    for (const name of ["productQuery", "podProvider", "status"]) {
      if (!formData.has(name)) continue;
      const value = formData.get(name)?.toString().trim() ?? "";
      if (value) params.set(name, value);
      else params.delete(name);
    }
    for (const name of ["productQueryMatch", "podProviderMatch"]) {
      if (!formData.has(name)) continue;
      const value = formData.get(name)?.toString() ?? "contains";
      if (value !== "contains") params.set(name, value);
      else params.delete(name);
    }
    for (const name of ["tag", "collection"]) {
      if (!formData.has(name)) {
        params.delete(name);
        continue;
      }
      params.delete(name);
      for (const value of formData.getAll(name).map(String).filter(Boolean))
        params.append(name, value);
    }
    navigate(`?${params.toString()}`);
  }

  function clearProductFilterNames(names: string[]): void {
    const params = new URLSearchParams(searchParams);
    for (const name of names) params.delete(name);
    navigate(`?${params.toString()}`);
  }

  function clearProductFilters() {
    const params = new URLSearchParams(searchParams);
    params.delete("productQuery");
    params.delete("podProvider");
    params.delete("status");
    params.delete("podProviderMatch");
    params.delete("productQueryMatch");
    params.delete("tag");
    params.delete("collection");
    navigate(`?${params.toString()}`);
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
              Sync products and variants from Shopify without removing locally
              seeded test data. Existing Shopify-backed rows are refreshed in
              place by `shopifyId`; unrelated local rows are left alone.
            </s-text>
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              <div>
                <strong>Status</strong>
                <div>
                  {catalogSynced
                    ? "Catalog synced"
                    : "Initial catalog sync still pending"}
                </div>
              </div>
              <div>
                <strong>Last completed sync</strong>
                <div>
                  {formatSyncDate(latestCatalogSync?.completedAt ?? null)}
                </div>
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
              <s-button
                type="submit"
                variant="primary"
                disabled={syncFetcher.state !== "idle"}
              >
                Sync catalog now
              </s-button>
            </syncFetcher.Form>
          </div>
        </s-section>

        {products.length === 0 ? (
          <s-section
            heading={
              hasProductFilters
                ? "No products match these filters"
                : "No synced products"
            }
          >
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {hasProductFilters ? (
                <div
                  style={{
                    display: "grid",
                    gap: "0.75rem",
                    justifyItems: "start",
                  }}
                >
                  <s-text>
                    Try a different product, POD provider, or status filter.
                  </s-text>
                  <s-button variant="secondary" onClick={clearProductFilters}>
                    Clear filters
                  </s-button>
                </div>
              ) : (
                <>
                  <s-text>
                    Catalog sync must complete before product-level Cause
                    assignments can be configured.
                  </s-text>
                  <s-text color="subdued">
                    Use the sync action above to import your Shopify catalog
                    while keeping any seed data you already have.
                  </s-text>
                </>
              )}
            </div>
          </s-section>
        ) : (
          <>
            {selectedProductIds.length > 0 ? (
              <s-section>
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "1rem",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <strong>
                        {selectedProductIds.length} product
                        {selectedProductIds.length === 1 ? "" : "s"} selected
                      </strong>
                      <s-text color="subdued">
                        Cause routing changes preserve Artist attribution and
                        payout settings.
                      </s-text>
                    </div>
                    <s-button variant="secondary" onClick={clearSelection}>
                      Clear selection
                    </s-button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(13rem, 1fr))",
                      gap: "1rem",
                      alignItems: "end",
                    }}
                  >
                    <div style={{ display: "grid", gap: "0.35rem" }}>
                      <label htmlFor="bulk-assignment-mode">Bulk action</label>
                      <select
                        id="bulk-assignment-mode"
                        value={bulkMode}
                        onChange={(event) =>
                          setBulkMode(event.currentTarget.value as BulkMode)
                        }
                        style={fieldStyle}
                      >
                        <option value="artist">Artist</option>
                        <option value="cause">Set product Cause routing</option>
                        <option value="clear_override">
                          Clear Cause overrides
                        </option>
                      </select>
                    </div>

                    {bulkMode === "artist" ? (
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <strong>Artist</strong>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "0.75rem",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              color: selectedArtist
                                ? "inherit"
                                : "var(--p-color-text-subdued, #6d7175)",
                            }}
                          >
                            {selectedArtist?.displayName ??
                              "No Artist selected"}
                          </span>
                          <AssignmentPicker
                            id="products-bulk-artist-picker"
                            label="Choose Artist"
                            triggerLabel={
                              selectedArtist ? "Change Artist" : "Choose Artist"
                            }
                            options={artists.map((artist: ArtistOption) => ({
                              id: artist.id,
                              label: artist.displayName,
                            }))}
                            selectedIds={
                              selectedArtistId
                                ? new Set([selectedArtistId])
                                : new Set()
                            }
                            onAdd={(ids) => setSelectedArtistId(ids[0] ?? "")}
                            multi={false}
                            hideSelected={false}
                            searchPlaceholder="Search Artists"
                            emptyText="No Artists match that search."
                          />
                        </div>
                      </div>
                    ) : bulkMode === "cause" ? (
                      <div
                        style={{
                          display: "grid",
                          gap: "0.65rem",
                          gridColumn: "span 2",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "0.75rem",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <strong>
                            Cause routing ({bulkCauseTotal.toFixed(2)}%)
                          </strong>
                          <AssignmentPicker
                            id="products-bulk-cause-picker"
                            label="Add Causes"
                            triggerLabel="Add Causes"
                            options={causes.map((cause: CauseOption) => ({
                              id: cause.id,
                              label: cause.name,
                            }))}
                            selectedIds={
                              new Set(bulkCauseRows.map((row) => row.causeId))
                            }
                            onAdd={(ids) =>
                              setBulkCauseRows((current) => [
                                ...current,
                                ...ids
                                  .filter(
                                    (id) =>
                                      !current.some(
                                        (row) => row.causeId === id,
                                      ),
                                  )
                                  .map((causeId) => ({
                                    causeId,
                                    percentage:
                                      current.length === 0 && ids.length === 1
                                        ? "100"
                                        : "",
                                  })),
                              ])
                            }
                            searchPlaceholder="Search Causes"
                            emptyText="No Causes match that search."
                            disabled={bulkNoCauseOverride}
                          />
                        </div>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={bulkNoCauseOverride}
                            onChange={(event) => {
                              setBulkNoCauseOverride(
                                event.currentTarget.checked,
                              );
                              if (event.currentTarget.checked)
                                setBulkCauseRows([]);
                            }}
                          />
                          <span>Explicitly allocate 0% to Causes</span>
                        </label>
                        {bulkCauseRows.map((row, index) => (
                          <div
                            key={row.causeId}
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "minmax(10rem, 1fr) 8rem auto",
                              gap: "0.5rem",
                              alignItems: "center",
                            }}
                          >
                            <span>
                              {causes.find(
                                (cause: CauseOption) =>
                                  cause.id === row.causeId,
                              )?.name ?? "Unknown Cause"}
                            </span>
                            <input
                              aria-label={`Percentage for ${causes.find((cause: CauseOption) => cause.id === row.causeId)?.name ?? "Cause"}`}
                              type="number"
                              min="0.01"
                              max="100"
                              step="0.01"
                              value={row.percentage}
                              onChange={(event) => {
                                const percentage = event.currentTarget.value;
                                setBulkCauseRows((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, percentage }
                                      : item,
                                  ),
                                );
                              }}
                              style={fieldStyle}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setBulkCauseRows((current) =>
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                )
                              }
                              style={{
                                ...fieldStyle,
                                width: "auto",
                                color: "var(--p-color-text-critical, #8e1f1f)",
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <s-banner tone="info">
                        <s-text>
                          Selected products with an active override and Artists
                          will return to Artist Cause preferences. Other
                          products remain unchanged.
                        </s-text>
                      </s-banner>
                    )}

                    <div
                      style={{
                        display: "flex",
                        gap: "0.75rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <s-button
                        variant="primary"
                        disabled={
                          isBulkSubmitting ||
                          selectedProductIds.length === 0 ||
                          (bulkMode === "artist" && artists.length === 0) ||
                          invalidBulkCauseRouting
                        }
                        onClick={submitBulkAssignment}
                      >
                        {bulkMode === "clear_override"
                          ? "Clear overrides"
                          : "Apply assignment"}
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
                    <>
                      {hasProductFilters ? (
                        <s-button
                          variant="secondary"
                          onClick={clearProductFilters}
                        >
                          Clear filters
                        </s-button>
                      ) : null}
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(event) =>
                            toggleSelectAll(event.currentTarget.checked)
                          }
                        />
                        <span>Select all visible</span>
                      </label>
                    </>
                  }
                />

                <s-table-header-row>
                  <s-table-header>Select</s-table-header>
                  <s-table-header listSlot="primary">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>Product</span>
                      <TableColumnFilter
                        title="Product"
                        active={Boolean(
                          filterProduct ||
                          filterTags.length > 0 ||
                          filterCollectionIds.length > 0,
                        )}
                        onApply={applyProductFilters}
                        onClear={() =>
                          clearProductFilterNames([
                            "productQuery",
                            "productQueryMatch",
                            "tag",
                            "collection",
                          ])
                        }
                      >
                        <TableTextFilterFields
                          id="products-product-filter"
                          name="productQuery"
                          label="Product title or handle"
                          value={filterProduct}
                          matchId="products-product-match-filter"
                          matchName="productQueryMatch"
                          matchValue={filterProductMatch}
                          fieldStyle={fieldStyle}
                        />
                        <AssignmentFilterPicker
                          id="products-tag-filter"
                          name="tag"
                          label="Tags"
                          options={availableTags}
                          values={filterTags}
                          searchPlaceholder="Search tags"
                          emptyText="No matching tags."
                        />
                        <AssignmentFilterPicker
                          id="products-collection-filter"
                          name="collection"
                          label="Collections"
                          options={availableCollections}
                          values={filterCollectionIds}
                          searchPlaceholder="Search collections"
                          emptyText="No matching collections."
                        />
                      </TableColumnFilter>
                    </div>
                  </s-table-header>
                  <s-table-header listSlot="secondary" format="numeric">
                    Variant costs
                  </s-table-header>
                  <s-table-header listSlot="secondary" format="numeric">
                    Artists
                  </s-table-header>
                  <s-table-header listSlot="secondary" format="numeric">
                    Cause assignments
                  </s-table-header>
                  <s-table-header listSlot="secondary">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>POD coverage</span>
                      <TableColumnFilter
                        title="POD coverage"
                        active={Boolean(
                          filterPodProvider ||
                          filterPodProviderMatch === "empty",
                        )}
                        onApply={applyProductFilters}
                        onClear={() =>
                          clearProductFilterNames([
                            "podProvider",
                            "podProviderMatch",
                          ])
                        }
                      >
                        <TableTextFilterFields
                          id="products-pod-provider-filter"
                          name="podProvider"
                          label="POD provider"
                          value={filterPodProvider}
                          matchId="products-pod-provider-match-filter"
                          matchName="podProviderMatch"
                          matchValue={filterPodProviderMatch}
                          allowEmpty
                          fieldStyle={fieldStyle}
                        />
                      </TableColumnFilter>
                    </div>
                  </s-table-header>
                  <s-table-header listSlot="inline">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>Status</span>
                      <TableColumnFilter
                        title="Status"
                        active={Boolean(filterStatus)}
                        onApply={applyProductFilters}
                        onClear={() => clearProductFilterNames(["status"])}
                      >
                        <label htmlFor="products-status-filter">Status</label>
                        <select
                          id="products-status-filter"
                          name="status"
                          defaultValue={filterStatus}
                          style={fieldStyle}
                        >
                          <option value="">All statuses</option>
                          <option value="active">Active</option>
                          <option value="draft">Draft</option>
                          <option value="archived">Archived</option>
                        </select>
                      </TableColumnFilter>
                    </div>
                  </s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {products.map((product: ProductRow) => (
                    <s-table-row key={product.id}>
                      <s-table-cell>
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(product.id)}
                          onChange={(event) =>
                            updateSelection(
                              product.id,
                              event.currentTarget.checked,
                            )
                          }
                          aria-label={`Select ${product.title}`}
                        />
                      </s-table-cell>
                      <s-table-cell>
                        <div style={{ display: "grid", gap: "0.2rem" }}>
                          <strong>{product.title}</strong>
                          <s-text color="subdued">/{product.handle}</s-text>
                        </div>
                      </s-table-cell>
                      <s-table-cell>
                        <Link
                          to={variantsUrl(product.id)}
                          title={variantCostReadinessTitle(product)}
                          style={{
                            display: "inline-flex",
                            textDecoration: "none",
                          }}
                        >
                          <span>
                            <s-badge
                              tone={
                                product.variantCount > 0 &&
                                product.configuredVariantCount ===
                                  product.variantCount
                                  ? "success"
                                  : "critical"
                              }
                            >
                              {product.configuredVariantCount}/
                              {product.variantCount}
                            </s-badge>
                          </span>
                        </Link>
                      </s-table-cell>
                      <s-table-cell>
                        {product.artistAssignmentCount}
                      </s-table-cell>
                      <s-table-cell>
                        <div style={{ display: "grid", gap: "0.2rem" }}>
                          <span>{product.causeAssignmentCount}</span>
                          <s-badge
                            tone={
                              product.donationRoutingMode === "product_override"
                                ? "info"
                                : product.causeAssignmentCount > 0
                                  ? "success"
                                  : "warning"
                            }
                          >
                            {donationRoutingLabel(product)}
                          </s-badge>
                        </div>
                      </s-table-cell>
                      <s-table-cell>
                        {product.mappedVariantCount > 0 ? (
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            <strong>
                              {product.mappedVariantCount} of{" "}
                              {product.variantCount}
                            </strong>
                            <s-text color="subdued">
                              {product.mappedProviders
                                .map(formatProviderLabel)
                                .join(", ")}
                            </s-text>
                          </div>
                        ) : (
                          <s-text color="subdued">Manual only</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge
                          tone={
                            product.status === "active"
                              ? "success"
                              : product.status === "draft"
                                ? "warning"
                                : "enabled"
                          }
                        >
                          {product.status === "active"
                            ? "Active"
                            : product.status === "draft"
                              ? "Draft"
                              : "Archived"}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <Link
                          to={`/app/products/${product.id}`}
                          style={{
                            display: "inline-block",
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <s-button variant="secondary">Manage</s-button>
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
          <s-text>
            Something went wrong loading Products. Please refresh the page.
          </s-text>
        </s-banner>
      </s-page>
    </>
  );
}
