import { Prisma } from "@prisma/client";

import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import {
  createArtistMetaobject,
  upsertArtistMetaobject,
} from "./artistMetaobjectService.server";
import {
  createCauseMetaobject,
  ensureCauseMetaobjectDefinition,
  updateCauseMetaobject,
} from "./causeMetaobjectService.server";
import { syncProductDescriptionDonationSummary } from "./productDescriptionSummary.server";
import { canWriteShopifyProducts, syncProductPublicDonationMetafields } from "./productPublicMetafieldService.server";
import { getPublicIconUrl } from "./publicIconStorage.server";
import { canSyncShopifyFiles, syncPublicIconToShopifyFile } from "./shopifyIconFileService.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type SyncResult = {
  total: number;
  synced: number;
  failed: number;
  skipped: number;
  skippedMissingShopifyResource: number;
  failureMessages: Record<string, number>;
};

export type CustomerMerchandisingSyncTarget = "artists" | "causes" | "products" | "all";

export type CustomerMerchandisingSyncResult = {
  artists?: SyncResult;
  causes?: SyncResult;
  products?: SyncResult;
};

type SyncPhase = "artists" | "causes" | "products";

type SyncProgress = {
  phase: SyncPhase;
  result: SyncResult;
};

type SyncOptions = {
  onProgress?: (progress: SyncProgress) => Promise<void>;
  shouldCancel?: () => Promise<boolean>;
};

class CustomerMerchandisingSyncCanceledError extends Error {
  constructor() {
    super("Customer merchandising sync was canceled.");
    this.name = "CustomerMerchandisingSyncCanceledError";
  }
}

function emptyResult(total: number): SyncResult {
  return {
    total,
    synced: 0,
    failed: 0,
    skipped: 0,
    skippedMissingShopifyResource: 0,
    failureMessages: {},
  };
}

function isRecordNotFoundError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("record not found");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Shopify sync failure";
}

function isSyncCanceledError(error: unknown) {
  return error instanceof CustomerMerchandisingSyncCanceledError;
}

function isMissingShopifyResourceError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("record not found") ||
    message.includes("was not found") ||
    message.includes("not found in this shop")
  );
}

function summarizeFailureMessages(failureMessages: Record<string, number>): string | null {
  const entries = Object.entries(failureMessages).sort(([, leftCount], [, rightCount]) => rightCount - leftCount);
  if (entries.length === 0) return null;

  return entries
    .slice(0, 3)
    .map(([message, count]) => (count > 1 ? `${message} (${count}x)` : message))
    .join("; ");
}

function buildSyncErrorSummary(result: SyncResult): string | null {
  if (result.failed === 0) return null;

  const failureSummary = summarizeFailureMessages(result.failureMessages);
  const prefix = `${result.failed} item${result.failed === 1 ? "" : "s"} failed.`;
  return failureSummary ? `${prefix} ${failureSummary}` : prefix;
}

function recordItemError(
  result: SyncResult,
  error: unknown,
  context: {
    phase: SyncPhase;
    shopId: string;
    itemId: string;
    itemLabel: string;
  },
) {
  if (isMissingShopifyResourceError(error)) {
    result.skipped += 1;
    result.skippedMissingShopifyResource += 1;
    console.warn("[CustomerMerchandisingSync] Skipped missing Shopify resource.", {
      ...context,
      message: getErrorMessage(error),
    });
    return;
  }

  result.failed += 1;
  const message = getErrorMessage(error);
  const itemType = context.phase === "artists" ? "Artist" : context.phase === "causes" ? "Cause" : "Product";
  const contextualMessage = `${itemType} "${context.itemLabel}": ${message}`;
  result.failureMessages[contextualMessage] = (result.failureMessages[contextualMessage] ?? 0) + 1;
  console.error("[CustomerMerchandisingSync] Item sync failed.", {
    ...context,
    error,
  });
}

function addResult(target: SyncResult, source: SyncResult) {
  target.total += source.total;
  target.synced += source.synced;
  target.failed += source.failed;
  target.skipped += source.skipped;
  target.skippedMissingShopifyResource += source.skippedMissingShopifyResource;
  for (const [message, count] of Object.entries(source.failureMessages)) {
    target.failureMessages[message] = (target.failureMessages[message] ?? 0) + count;
  }
}

function aggregateSyncResult(result: CustomerMerchandisingSyncResult): SyncResult {
  const aggregate = emptyResult(0);
  if (result.artists) addResult(aggregate, result.artists);
  if (result.causes) addResult(aggregate, result.causes);
  if (result.products) addResult(aggregate, result.products);
  return aggregate;
}

function getAbsoluteIconUrl(input: {
  shopId: string;
  type: "artist" | "cause";
  id: string;
  iconStorageKey: string | null;
  fallbackIconUrl: string | null;
}) {
  return input.iconStorageKey
    ? getPublicIconUrl({
        type: input.type,
        id: input.id,
        shopDomain: input.shopId,
        version: input.iconStorageKey,
      })
    : input.fallbackIconUrl;
}

export async function syncAllArtistsToShopify({
  admin,
  shopId,
  onProgress,
  shouldCancel,
}: {
  admin: AdminContext;
  shopId: string;
} & SyncOptions): Promise<SyncResult> {
  const artists = await prisma.artist.findMany({
    where: { shopId },
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
    orderBy: [{ displayName: "asc" }],
  });
  const result = emptyResult(artists.length);
  const canSyncFiles = await canSyncShopifyFiles({ admin, shopId });
  await onProgress?.({ phase: "artists", result });

  for (const artist of artists) {
    if (await shouldCancel?.()) throw new CustomerMerchandisingSyncCanceledError();
    try {
      const iconImageId = await syncPublicIconToShopifyFile({
        admin,
        shopId,
        ownerType: "artist",
        ownerId: artist.id,
        label: artist.creditName || artist.displayName,
        iconStorageKey: artist.iconStorageKey,
        existingMediaImageId: artist.shopifyIconMediaImageId,
        syncedStorageKey: artist.shopifyIconStorageKey,
        canSyncFiles,
      });
      const input = {
        displayName: artist.displayName,
        creditName: artist.creditName,
        publicBio: artist.publicBio,
        iconUrl: getAbsoluteIconUrl({
          shopId,
          type: "artist",
          id: artist.id,
          iconStorageKey: artist.iconStorageKey,
          fallbackIconUrl: artist.iconUrl,
        }),
        iconImageId,
        websiteUrl: artist.websiteUrl,
        instagramUrl: artist.instagramUrl,
        status: artist.status,
      };
      let metaobjectId: string;
      try {
        metaobjectId = await upsertArtistMetaobject({
          admin,
          existingMetaobjectId: artist.shopifyMetaobjectId,
          input,
        });
      } catch (error) {
        if (!artist.shopifyMetaobjectId || !isRecordNotFoundError(error)) throw error;
        const metaobject = await createArtistMetaobject(admin, input);
        metaobjectId = metaobject.id;
      }

      if (metaobjectId !== artist.shopifyMetaobjectId) {
        await prisma.artist.update({
          where: { id: artist.id, shopId },
          data: {
            shopifyMetaobjectId: metaobjectId,
            shopifyIconMediaImageId: iconImageId,
            shopifyIconStorageKey: iconImageId ? artist.iconStorageKey : null,
          },
        });
      } else if (iconImageId !== artist.shopifyIconMediaImageId || artist.shopifyIconStorageKey !== artist.iconStorageKey) {
        await prisma.artist.update({
          where: { id: artist.id, shopId },
          data: {
            shopifyIconMediaImageId: iconImageId,
            shopifyIconStorageKey: iconImageId ? artist.iconStorageKey : null,
          },
        });
      }
      result.synced += 1;
    } catch (error) {
      recordItemError(result, error, {
        phase: "artists",
        shopId,
        itemId: artist.id,
        itemLabel: artist.displayName,
      });
    }
    await onProgress?.({ phase: "artists", result });
  }

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Artist",
      action: "ARTISTS_SHOPIFY_BULK_SYNCED",
      actor: "merchant",
      payload: result,
    },
  });

  return result;
}

export async function syncAllCausesToShopify({
  admin,
  shopId,
  onProgress,
  shouldCancel,
}: {
  admin: AdminContext;
  shopId: string;
} & SyncOptions): Promise<SyncResult> {
  const causes = await prisma.cause.findMany({
    where: { shopId },
    select: {
      id: true,
      shopifyMetaobjectId: true,
      name: true,
      legalName: true,
      is501c3: true,
      description: true,
      iconUrl: true,
      iconStorageKey: true,
      shopifyIconMediaImageId: true,
      shopifyIconStorageKey: true,
      donationLink: true,
      websiteUrl: true,
      instagramUrl: true,
      status: true,
    },
    orderBy: [{ name: "asc" }],
  });
  const result = emptyResult(causes.length);
  const canSyncFiles = await canSyncShopifyFiles({ admin, shopId });
  await onProgress?.({ phase: "causes", result });

  await ensureCauseMetaobjectDefinition(admin);

  for (const cause of causes) {
    if (await shouldCancel?.()) throw new CustomerMerchandisingSyncCanceledError();
    try {
      const iconImageId = await syncPublicIconToShopifyFile({
        admin,
        shopId,
        ownerType: "cause",
        ownerId: cause.id,
        label: cause.name,
        iconStorageKey: cause.iconStorageKey,
        existingMediaImageId: cause.shopifyIconMediaImageId,
        syncedStorageKey: cause.shopifyIconStorageKey,
        canSyncFiles,
      });
      const input = {
        name: cause.name,
        legalName: cause.legalName,
        is501c3: cause.is501c3,
        description: cause.description,
        iconUrl: getAbsoluteIconUrl({
          shopId,
          type: "cause",
          id: cause.id,
          iconStorageKey: cause.iconStorageKey,
          fallbackIconUrl: cause.iconUrl,
        }),
        iconImageId,
        donationLink: cause.donationLink,
        websiteUrl: cause.websiteUrl,
        instagramUrl: cause.instagramUrl,
        status: cause.status,
      };
      let metaobjectId = cause.shopifyMetaobjectId;
      if (metaobjectId) {
        try {
          await updateCauseMetaobject(admin, metaobjectId, input);
        } catch (error) {
          if (!isRecordNotFoundError(error)) throw error;
          metaobjectId = null;
        }
      }
      if (!metaobjectId) {
        const metaobject = await createCauseMetaobject(admin, input);
        metaobjectId = metaobject.id;
      }

      if (metaobjectId !== cause.shopifyMetaobjectId) {
        await prisma.cause.update({
          where: { id: cause.id, shopId },
          data: {
            shopifyMetaobjectId: metaobjectId,
            shopifyIconMediaImageId: iconImageId,
            shopifyIconStorageKey: iconImageId ? cause.iconStorageKey : null,
          },
        });
      } else if (iconImageId !== cause.shopifyIconMediaImageId || cause.shopifyIconStorageKey !== cause.iconStorageKey) {
        await prisma.cause.update({
          where: { id: cause.id, shopId },
          data: {
            shopifyIconMediaImageId: iconImageId,
            shopifyIconStorageKey: iconImageId ? cause.iconStorageKey : null,
          },
        });
      }
      result.synced += 1;
    } catch (error) {
      recordItemError(result, error, {
        phase: "causes",
        shopId,
        itemId: cause.id,
        itemLabel: cause.name,
      });
    }
    await onProgress?.({ phase: "causes", result });
  }

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Cause",
      action: "CAUSES_SHOPIFY_BULK_SYNCED",
      actor: "merchant",
      payload: result,
    },
  });

  return result;
}

export async function syncAllProductsToShopify({
  admin,
  shopId,
  onProgress,
  shouldCancel,
}: {
  admin: AdminContext;
  shopId: string;
} & SyncOptions): Promise<SyncResult> {
  const [products, shop] = await Promise.all([
    prisma.product.findMany({
      where: { shopId },
      select: {
        id: true,
        shopifyId: true,
        title: true,
        causeAssignments: {
          where: { shopId, cause: { status: "active" } },
          select: {
            causeId: true,
            percentage: true,
            cause: {
              select: {
                name: true,
                shopifyMetaobjectId: true,
              },
            },
          },
        },
        artistAssignments: {
          where: { shopId, status: "active", artist: { status: "active" } },
          orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
          select: {
            creditOverride: true,
            artist: {
              select: {
                id: true,
                creditName: true,
                displayName: true,
                shopifyMetaobjectId: true,
              },
            },
          },
        },
      },
      orderBy: [{ title: "asc" }],
    }),
    prisma.shop.findUnique({
      where: { shopId },
      select: { productDescriptionDonationSummaryEnabled: true },
    }),
  ]);
  const result = emptyResult(products.length);
  const descriptionSummariesEnabled = shop?.productDescriptionDonationSummaryEnabled ?? false;
  const canWriteProducts = await canWriteShopifyProducts({ admin, shopId });
  await onProgress?.({ phase: "products", result });

  if (!canWriteProducts) {
    result.skipped = products.length;
    await onProgress?.({ phase: "products", result });
    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Product",
        action: "PRODUCTS_SHOPIFY_PUBLIC_DATA_BULK_SYNC_SKIPPED",
        actor: "merchant",
        payload: {
          ...result,
          reason: "missing_write_products_scope",
          productDescriptionDonationSummaryEnabled: descriptionSummariesEnabled,
        },
      },
    });
    return result;
  }

  for (const product of products) {
    if (await shouldCancel?.()) throw new CustomerMerchandisingSyncCanceledError();
    try {
      await syncProductPublicDonationMetafields({
        admin,
        shopId,
        productGid: product.shopifyId,
        causes: product.causeAssignments.map((assignment) => ({
          causeId: assignment.causeId,
          name: assignment.cause.name,
          metaobjectId: assignment.cause.shopifyMetaobjectId,
          percentage: Number(assignment.percentage).toFixed(2),
        })),
        artists: product.artistAssignments.map((assignment) => ({
          artistId: assignment.artist.id,
          creditName:
            assignment.creditOverride?.trim() ||
            assignment.artist.creditName ||
            assignment.artist.displayName,
          metaobjectId: assignment.artist.shopifyMetaobjectId,
        })),
        canWriteProducts,
      });
      await syncProductDescriptionDonationSummary({
        admin,
        shopId,
        product: { id: product.id, shopifyId: product.shopifyId },
        enabled: descriptionSummariesEnabled,
        canWriteProducts,
      });
      result.synced += 1;
    } catch (error) {
      recordItemError(result, error, {
        phase: "products",
        shopId,
        itemId: product.id,
        itemLabel: product.title,
      });
    }
    await onProgress?.({ phase: "products", result });
  }

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Product",
      action: "PRODUCTS_SHOPIFY_PUBLIC_DATA_BULK_SYNCED",
      actor: "merchant",
      payload: {
        ...result,
        productDescriptionDonationSummaryEnabled: descriptionSummariesEnabled,
      },
    },
  });

  return result;
}

export async function syncCustomerMerchandisingToShopify({
  admin,
  shopId,
  target,
  onProgress,
  shouldCancel,
}: {
  admin: AdminContext;
  shopId: string;
  target: CustomerMerchandisingSyncTarget;
} & SyncOptions): Promise<CustomerMerchandisingSyncResult> {
  const result: CustomerMerchandisingSyncResult = {};

  if (await shouldCancel?.()) throw new CustomerMerchandisingSyncCanceledError();
  if (target === "artists" || target === "all") {
    result.artists = await syncAllArtistsToShopify({ admin, shopId, onProgress, shouldCancel });
  }
  if (await shouldCancel?.()) throw new CustomerMerchandisingSyncCanceledError();
  if (target === "causes" || target === "all") {
    result.causes = await syncAllCausesToShopify({ admin, shopId, onProgress, shouldCancel });
  }
  if (await shouldCancel?.()) throw new CustomerMerchandisingSyncCanceledError();
  if (target === "products" || target === "all") {
    result.products = await syncAllProductsToShopify({ admin, shopId, onProgress, shouldCancel });
  }

  return result;
}

async function countCustomerMerchandisingSyncTarget({
  shopId,
  target,
}: {
  shopId: string;
  target: CustomerMerchandisingSyncTarget;
}): Promise<number> {
  const [artistCount, causeCount, productCount] = await Promise.all([
    target === "artists" || target === "all" ? prisma.artist.count({ where: { shopId } }) : Promise.resolve(0),
    target === "causes" || target === "all" ? prisma.cause.count({ where: { shopId } }) : Promise.resolve(0),
    target === "products" || target === "all" ? prisma.product.count({ where: { shopId } }) : Promise.resolve(0),
  ]);

  return artistCount + causeCount + productCount;
}

export async function queueCustomerMerchandisingSyncRun({
  shopId,
  target,
}: {
  shopId: string;
  target: CustomerMerchandisingSyncTarget;
}): Promise<{ runId: string }> {
  const activeRun = await prisma.customerMerchandisingSyncRun.findFirst({
    where: {
      shopId,
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, target: true, totalCount: true },
  });
  if (activeRun) {
    if (activeRun.totalCount === 0) {
      const totalCount = await countCustomerMerchandisingSyncTarget({
        shopId,
        target: activeRun.target as CustomerMerchandisingSyncTarget,
      });
      await prisma.customerMerchandisingSyncRun.update({
        where: { id: activeRun.id },
        data: { totalCount },
      });
    }
    return { runId: activeRun.id };
  }
  const totalCount = await countCustomerMerchandisingSyncTarget({ shopId, target });

  const run = await prisma.customerMerchandisingSyncRun.create({
    data: {
      shopId,
      target,
      status: "queued",
      totalCount,
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "CustomerMerchandisingSyncRun",
      entityId: run.id,
      action: "CUSTOMER_MERCHANDISING_SHOPIFY_SYNC_QUEUED",
      actor: "merchant",
      payload: { target },
    },
  });

  await jobQueue.send("customer-merchandising.sync", { shopId, runId: run.id });

  return { runId: run.id };
}

export async function cancelCustomerMerchandisingSyncRun({
  shopId,
  runId,
}: {
  shopId: string;
  runId: string;
}): Promise<boolean> {
  const result = await prisma.customerMerchandisingSyncRun.updateMany({
    where: {
      id: runId,
      shopId,
      status: { in: ["queued", "running"] },
    },
    data: {
      status: "canceled",
      completedAt: new Date(),
      errorSummary: "Canceled by merchant. Shopify may contain partial updates.",
    },
  });

  if (result.count === 0) return false;

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "CustomerMerchandisingSyncRun",
      entityId: runId,
      action: "CUSTOMER_MERCHANDISING_SHOPIFY_SYNC_CANCELED",
      actor: "merchant",
      payload: { warning: "Shopify may contain partial updates." },
    },
  });

  return true;
}

export async function runCustomerMerchandisingSync({
  admin,
  shopId,
  runId,
}: {
  admin: AdminContext;
  shopId: string;
  runId: string;
}): Promise<CustomerMerchandisingSyncResult> {
  const run = await prisma.customerMerchandisingSyncRun.findFirst({
    where: { id: runId, shopId },
    select: { id: true, target: true, status: true },
  });
  if (!run) throw new Error("Customer merchandising sync run not found.");
  if (run.status === "canceled") return {};

  const startedRun = await prisma.customerMerchandisingSyncRun.updateMany({
    where: { id: run.id, shopId, status: { in: ["queued", "running"] } },
    data: {
      status: "running",
      startedAt: new Date(),
      errorSummary: null,
    },
  });
  if (startedRun.count === 0) return {};

  const phaseResults: CustomerMerchandisingSyncResult = {};
  const shouldCancel = async () => {
    const latestRun = await prisma.customerMerchandisingSyncRun.findFirst({
      where: { id: run.id, shopId },
      select: { status: true },
    });
    return latestRun?.status === "canceled";
  };
  const updateRunProgress = async ({ phase, result }: SyncProgress) => {
    if (await shouldCancel()) throw new CustomerMerchandisingSyncCanceledError();
    phaseResults[phase] = { ...result, failureMessages: { ...result.failureMessages } };
    const aggregate = aggregateSyncResult(phaseResults);
    const errorSummary = buildSyncErrorSummary(aggregate);
    await prisma.customerMerchandisingSyncRun.update({
      where: { id: run.id },
      data: {
        totalCount: aggregate.total,
        syncedCount: aggregate.synced,
        failedCount: aggregate.failed,
        skippedCount: aggregate.skipped,
        resultSummary: phaseResults as unknown as Prisma.InputJsonValue,
        errorSummary,
      },
    });
  };

  try {
    const result = await syncCustomerMerchandisingToShopify({
      admin,
      shopId,
      target: run.target as CustomerMerchandisingSyncTarget,
      onProgress: updateRunProgress,
      shouldCancel,
    });
    const finalResults: CustomerMerchandisingSyncResult =
      Object.keys(phaseResults).length > 0 ? phaseResults : result;
    const aggregate = aggregateSyncResult(finalResults);
    const errorSummary = buildSyncErrorSummary(aggregate);
    await prisma.customerMerchandisingSyncRun.update({
      where: { id: run.id },
      data: {
        status: aggregate.failed > 0 ? "completed_with_errors" : "completed",
        completedAt: new Date(),
        totalCount: aggregate.total,
        syncedCount: aggregate.synced,
        failedCount: aggregate.failed,
        skippedCount: aggregate.skipped,
        resultSummary: finalResults as unknown as Prisma.InputJsonValue,
        errorSummary,
      },
    });
    console.info("[CustomerMerchandisingSync] Completed Shopify sync.", {
      shopId,
      runId: run.id,
      target: run.target,
      total: aggregate.total,
      synced: aggregate.synced,
      skipped: aggregate.skipped,
      failed: aggregate.failed,
    });
    return result;
  } catch (error) {
    if (isSyncCanceledError(error)) {
      const aggregate = aggregateSyncResult(phaseResults);
      await prisma.customerMerchandisingSyncRun.update({
        where: { id: run.id },
        data: {
          status: "canceled",
          completedAt: new Date(),
          syncedCount: aggregate.synced,
          failedCount: aggregate.failed,
          skippedCount: aggregate.skipped,
          resultSummary: phaseResults as unknown as Prisma.InputJsonValue,
          errorSummary: "Canceled by merchant. Shopify may contain partial updates.",
        },
      });
      console.info("[CustomerMerchandisingSync] Canceled Shopify sync.", {
        shopId,
        runId: run.id,
        target: run.target,
      });
      return phaseResults;
    }

    await prisma.customerMerchandisingSyncRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorSummary: getErrorMessage(error),
      },
    });
    console.error("[CustomerMerchandisingSync] Shopify sync run failed.", {
      shopId,
      runId: run.id,
      target: run.target,
      error,
    });
    throw error;
  }
}
