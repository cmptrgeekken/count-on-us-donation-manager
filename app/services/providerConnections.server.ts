import { prisma } from "../db.server";
import { encryptProviderCredential } from "./providerCredentials.server";
import { validatePrintifyApiKey, PrintifyValidationError } from "./printify.server";

type ProviderDbClient = Pick<
  typeof prisma,
  | "providerConnection"
  | "providerVariantMapping"
  | "providerCatalogVariant"
  | "providerCostCache"
  | "variant"
  | "auditLog"
  | "providerSyncRun"
>;

export type ProviderConnectionSummary = {
  provider: "printful" | "printify";
  authType: "oauth" | "api_key";
  status: "not_configured" | "configured" | "validated" | "sync_failed";
  configured: boolean;
  displayName: string | null;
  providerAccountName: string | null;
  credentialHint: string | null;
  credentialUpdatedAt: string | null;
  credentialExpiresAt: string | null;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  updatedAt: string | null;
  mappedVariantCount: number;
  unmappedVariantCount: number;
  latestSyncRunStatus: string | null;
  latestCachedCostCount: number | null;
  note: string;
};

export type ProviderConnectionsPageData = {
  totalVariantCount: number;
  variantsWithSkuCount: number;
  printifyDiagnostics: {
    localMissingSkuCount: number;
    localDuplicateSkuCount: number;
    providerMissingSkuCount: number;
    providerDuplicateSkuCount: number;
    providerCatalogVariantCount: number;
  };
  printifyCatalogVariants: Array<{
    id: string;
    providerProductTitle: string | null;
    providerVariantTitle: string | null;
    providerSku: string | null;
    providerVariantId: string;
    baseCost: string | null;
    currency: string;
    isMapped: boolean;
    syncedAt: string;
  }>;
  printifyUnresolvedVariants: Array<{
    variantId: string;
    productTitle: string;
    variantTitle: string;
    sku: string | null;
    reason: string;
    suggestedCatalogVariantIds: string[];
  }>;
  summaries: ProviderConnectionSummary[];
};

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  const suffix = trimmed.slice(-4);
  return suffix ? `****${suffix}` : "Stored";
}

export async function getProviderConnectionsPageData(
  shopId: string,
  db: ProviderDbClient = prisma,
): Promise<ProviderConnectionsPageData> {
  const [connections, totalVariantCount, variantsWithSkuCount, variants, printifyMappings, printifyCatalogVariants] = await Promise.all([
    db.providerConnection.findMany({
      where: { shopId },
      select: {
        provider: true,
        authType: true,
        status: true,
        displayName: true,
        providerAccountName: true,
        credentialHint: true,
        credentialUpdatedAt: true,
        credentialExpiresAt: true,
        lastValidatedAt: true,
        lastValidationError: true,
        lastSyncedAt: true,
        lastSyncError: true,
        updatedAt: true,
        _count: {
          select: {
            mappings: true,
          },
        },
      },
      orderBy: { provider: "asc" },
    }),
    db.variant.count({ where: { shopId } }),
    db.variant.count({
      where: {
        shopId,
        sku: {
          not: null,
        },
      },
    }),
    db.variant.findMany({
      where: { shopId },
      select: {
        id: true,
        title: true,
        sku: true,
        product: {
          select: {
            title: true,
          },
        },
      },
    }),
    db.providerVariantMapping.findMany({
      where: {
        shopId,
        provider: "printify",
      },
      select: {
        variantId: true,
        status: true,
        lastSyncError: true,
        providerSku: true,
        providerVariantId: true,
      },
    }),
    db.providerCatalogVariant.findMany({
      where: {
        shopId,
        provider: "printify",
      },
      orderBy: [
        { providerProductTitle: "asc" },
        { providerVariantTitle: "asc" },
        { providerVariantId: "asc" },
      ],
      select: {
        id: true,
        providerProductTitle: true,
        providerVariantTitle: true,
        providerSku: true,
        providerVariantId: true,
        baseCost: true,
        currency: true,
        syncedAt: true,
      },
    }),
  ]);

  const connectionMap = new Map(connections.map((connection) => [connection.provider, connection]));

  const summaries: ProviderConnectionSummary[] = [
    {
      provider: "printful",
      authType: "oauth",
      status: connectionMap.has("printful") ? "configured" : "not_configured",
      configured: connectionMap.has("printful"),
      displayName: connectionMap.get("printful")?.displayName ?? null,
      providerAccountName: connectionMap.get("printful")?.providerAccountName ?? null,
      credentialHint: connectionMap.get("printful")?.credentialHint ?? null,
      credentialUpdatedAt: toIsoString(connectionMap.get("printful")?.credentialUpdatedAt),
      credentialExpiresAt: toIsoString(connectionMap.get("printful")?.credentialExpiresAt),
      lastValidatedAt: toIsoString(connectionMap.get("printful")?.lastValidatedAt),
      lastValidationError: connectionMap.get("printful")?.lastValidationError ?? null,
      lastSyncedAt: toIsoString(connectionMap.get("printful")?.lastSyncedAt),
      lastSyncError: connectionMap.get("printful")?.lastSyncError ?? null,
      updatedAt: toIsoString(connectionMap.get("printful")?.updatedAt),
      mappedVariantCount: connectionMap.get("printful")?._count.mappings ?? 0,
      unmappedVariantCount: Math.max(variantsWithSkuCount - (connectionMap.get("printful")?._count.mappings ?? 0), 0),
      latestSyncRunStatus: null,
      latestCachedCostCount: null,
      note: "Printful OAuth is not wired yet. This page will expose that flow in a later provider tranche.",
    },
    {
      provider: "printify",
      authType: "api_key",
      status: (connectionMap.get("printify")?.status as ProviderConnectionSummary["status"] | undefined) ?? "not_configured",
      configured: connectionMap.has("printify"),
      displayName: connectionMap.get("printify")?.displayName ?? null,
      providerAccountName: connectionMap.get("printify")?.providerAccountName ?? null,
      credentialHint: connectionMap.get("printify")?.credentialHint ?? null,
      credentialUpdatedAt: toIsoString(connectionMap.get("printify")?.credentialUpdatedAt),
      credentialExpiresAt: toIsoString(connectionMap.get("printify")?.credentialExpiresAt),
      lastValidatedAt: toIsoString(connectionMap.get("printify")?.lastValidatedAt),
      lastValidationError: connectionMap.get("printify")?.lastValidationError ?? null,
      lastSyncedAt: toIsoString(connectionMap.get("printify")?.lastSyncedAt),
      lastSyncError: connectionMap.get("printify")?.lastSyncError ?? null,
      updatedAt: toIsoString(connectionMap.get("printify")?.updatedAt),
      mappedVariantCount: connectionMap.get("printify")?._count.mappings ?? 0,
      unmappedVariantCount: Math.max(variantsWithSkuCount - (connectionMap.get("printify")?._count.mappings ?? 0), 0),
      latestSyncRunStatus: null,
      latestCachedCostCount: null,
      note: getPrintifyNote(connectionMap.get("printify")?.status),
    },
  ];

  const latestRuns = await db.providerSyncRun.findMany({
    where: { shopId },
    distinct: ["provider"],
    orderBy: [{ provider: "asc" }, { createdAt: "desc" }],
    select: {
      provider: true,
      status: true,
      mappedCount: true,
      unmappedCount: true,
      cachedCostCount: true,
    },
  });

  const latestRunMap = new Map(latestRuns.map((run) => [run.provider, run]));

  for (const summary of summaries) {
    const latestRun = latestRunMap.get(summary.provider);
    summary.latestSyncRunStatus = latestRun?.status ?? null;

    if (summary.provider === "printify" && latestRun) {
      summary.mappedVariantCount = latestRun.mappedCount;
      summary.unmappedVariantCount = latestRun.unmappedCount;
      summary.latestCachedCostCount = latestRun.cachedCostCount;
    }
  }

  const printifyMappingByVariantId = new Map(
    printifyMappings.map((mapping) => [mapping.variantId, mapping]),
  );
  const localSkuCounts = new Map<string, number>();
  const providerSkuCounts = new Map<string, number>();
  const mappedProviderVariantIds = new Set<string>();

  for (const variant of variants) {
    const sku = variant.sku?.trim();
    if (!sku) continue;

    localSkuCounts.set(sku, (localSkuCounts.get(sku) ?? 0) + 1);
  }

  for (const mapping of printifyMappings) {
    const providerVariantId = mapping.providerVariantId?.trim();
    if (mapping.status === "mapped" && providerVariantId) {
      mappedProviderVariantIds.add(providerVariantId);
    }
  }

  for (const variant of printifyCatalogVariants) {
    const sku = variant.providerSku?.trim();
    if (!sku) continue;

    providerSkuCounts.set(sku, (providerSkuCounts.get(sku) ?? 0) + 1);
  }

  const printifyUnresolvedVariants = variants.flatMap((variant) => {
    const sku = variant.sku?.trim();
    const mapping = printifyMappingByVariantId.get(variant.id);
    if (mapping?.status === "mapped") {
      return [];
    }

    let reason = mapping?.lastSyncError?.trim() || "No Printify SKU match found in the latest sync.";
    if (!sku) {
      reason = "This variant is missing a Shopify SKU, so it cannot be auto-matched. Manual mapping is required for provider-backed POD costs.";
    } else if ((localSkuCounts.get(sku) ?? 0) > 1) {
      reason = "Duplicate Shopify SKU prevents automatic Printify matching for this variant.";
    } else if ((providerSkuCounts.get(sku) ?? 0) > 1) {
      reason = "Multiple Printify variants share this SKU, so the match needs merchant review.";
    }

    const suggestedCatalogVariantIds = printifyCatalogVariants
      .filter((catalogVariant) => {
        if (mappedProviderVariantIds.has(catalogVariant.providerVariantId)) {
          return false;
        }

        const providerSku = catalogVariant.providerSku?.trim() || null;
        if (!sku || !providerSku) {
          return true;
        }

        return providerSku === sku;
      })
      .slice(0, 25)
      .map((catalogVariant) => catalogVariant.id);

    return [
      {
        variantId: variant.id,
        productTitle: variant.product.title,
        variantTitle: variant.title,
        sku: sku ?? null,
        reason,
        suggestedCatalogVariantIds,
      },
    ];
  });

  return {
    totalVariantCount,
    variantsWithSkuCount,
    printifyDiagnostics: {
      localMissingSkuCount: totalVariantCount - variantsWithSkuCount,
      localDuplicateSkuCount: Array.from(localSkuCounts.values()).filter((count) => count > 1).length,
      providerMissingSkuCount: printifyCatalogVariants.filter((variant) => !variant.providerSku?.trim()).length,
      providerDuplicateSkuCount: Array.from(providerSkuCounts.values()).filter((count) => count > 1).length,
      providerCatalogVariantCount: printifyCatalogVariants.length,
    },
    printifyCatalogVariants: printifyCatalogVariants.map((variant) => ({
      id: variant.id,
      providerProductTitle: variant.providerProductTitle,
      providerVariantTitle: variant.providerVariantTitle,
      providerSku: variant.providerSku,
      providerVariantId: variant.providerVariantId,
      baseCost: variant.baseCost?.toString() ?? null,
      currency: variant.currency,
      isMapped: mappedProviderVariantIds.has(variant.providerVariantId),
      syncedAt: variant.syncedAt.toISOString(),
    })),
    printifyUnresolvedVariants,
    summaries,
  };
}

function getPrintifyNote(status: string | undefined) {
  switch (status) {
    case "validated":
      return "Printify credentials have been validated. Run a sync to import Printify SKUs, auto-match unique overlaps, and refresh cached POD fulfillment costs.";
    case "sync_failed":
      return "The most recent Printify sync failed. Credential state is preserved, and manual cost fallbacks remain active where configured.";
    case "configured":
      return "Printify credentials are stored, but have not been validated yet.";
    default:
      return "Connect Printify to import provider SKUs, auto-match unique SKU overlaps, and cache POD fulfillment costs for mapped variants.";
  }
}

export async function savePrintifyConnection(
  input: {
    shopId: string;
    apiKey: string;
    displayName?: string | null;
  },
  db: ProviderDbClient = prisma,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string }> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Response("Printify API key is required.", { status: 400 });
  }

  if (apiKey.length < 8) {
    throw new Response("Printify API key looks too short.", { status: 400 });
  }

  const displayName = input.displayName?.trim() || null;
  let validatedConnection;
  try {
    validatedConnection = await validatePrintifyApiKey(apiKey, fetchImpl);
  } catch (error) {
    if (error instanceof PrintifyValidationError) {
      throw new Response(error.message, { status: error.status });
    }
    throw error;
  }

  const credentialsEncrypted = encryptProviderCredential(apiKey);
  const credentialHint = maskApiKey(apiKey);
  const validatedAt = new Date();
  const credentialExpiresAt = new Date(validatedAt);
  credentialExpiresAt.setFullYear(credentialExpiresAt.getFullYear() + 1);

  const connection = await db.providerConnection.upsert({
    where: {
      shopId_provider: {
        shopId: input.shopId,
        provider: "printify",
      },
    },
    update: {
      authType: "api_key",
      status: "validated",
      displayName: displayName ?? validatedConnection.primaryShop?.title ?? null,
      providerAccountId: validatedConnection.primaryShop?.id ?? null,
      providerAccountName: validatedConnection.primaryShop?.title ?? null,
      credentialsEncrypted,
      credentialHint,
      credentialUpdatedAt: validatedAt,
      credentialExpiresAt,
      lastValidatedAt: validatedAt,
      lastValidationError: null,
      lastSyncError: null,
    },
    create: {
      shopId: input.shopId,
      provider: "printify",
      authType: "api_key",
      status: "validated",
      displayName: displayName ?? validatedConnection.primaryShop?.title ?? null,
      providerAccountId: validatedConnection.primaryShop?.id ?? null,
      providerAccountName: validatedConnection.primaryShop?.title ?? null,
      credentialsEncrypted,
      credentialHint,
      credentialUpdatedAt: validatedAt,
      credentialExpiresAt,
      lastValidatedAt: validatedAt,
      lastValidationError: null,
      lastSyncError: null,
    },
    select: {
      id: true,
    },
  });

  await db.auditLog.create({
    data: {
      shopId: input.shopId,
      entity: "ProviderConnection",
      entityId: connection.id,
      action: "PRINTIFY_CONNECTION_CONFIGURED",
      actor: "merchant",
      payload: {
        provider: "printify",
        status: "validated",
        displayName: displayName ?? validatedConnection.primaryShop?.title ?? null,
        providerAccountId: validatedConnection.primaryShop?.id ?? null,
        providerAccountName: validatedConnection.primaryShop?.title ?? null,
        shopCount: validatedConnection.shopCount,
      },
    },
  });

  return connection;
}

export async function disconnectProviderConnection(
  input: {
    shopId: string;
    provider: "printful" | "printify";
  },
  db: ProviderDbClient = prisma,
): Promise<void> {
  const existing = await db.providerConnection.findUnique({
    where: {
      shopId_provider: {
        shopId: input.shopId,
        provider: input.provider,
      },
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    throw new Response("Provider connection not found.", { status: 404 });
  }

  await db.providerConnection.delete({
    where: {
      shopId_provider: {
        shopId: input.shopId,
        provider: input.provider,
      },
    },
  });

  await db.auditLog.create({
    data: {
      shopId: input.shopId,
      entity: "ProviderConnection",
      entityId: existing.id,
      action: "PROVIDER_CONNECTION_DISCONNECTED",
      actor: "merchant",
      payload: {
        provider: input.provider,
      },
    },
  });
}

export async function savePrintifyManualMapping(
  input: {
    shopId: string;
    variantId: string;
    catalogVariantId: string;
  },
  db: ProviderDbClient = prisma,
): Promise<{ mappingId: string }> {
  const [connection, variant, catalogVariant] = await Promise.all([
    db.providerConnection.findUnique({
      where: {
        shopId_provider: {
          shopId: input.shopId,
          provider: "printify",
        },
      },
      select: {
        id: true,
        status: true,
      },
    }),
    db.variant.findFirst({
      where: {
        shopId: input.shopId,
        id: input.variantId,
      },
      select: {
        id: true,
        shopId: true,
      },
    }),
    db.providerCatalogVariant.findFirst({
      where: {
        shopId: input.shopId,
        id: input.catalogVariantId,
      },
      select: {
        id: true,
        shopId: true,
        connectionId: true,
        provider: true,
        providerProductId: true,
        providerProductTitle: true,
        providerVariantId: true,
        providerVariantTitle: true,
        providerSku: true,
        baseCost: true,
        currency: true,
        sourceUpdatedAt: true,
        syncedAt: true,
      },
    }),
  ]);

  if (!connection) {
    throw new Response("Printify connection not found.", { status: 404 });
  }

  if (!variant || variant.shopId !== input.shopId) {
    throw new Response("Variant not found.", { status: 404 });
  }

  if (
    !catalogVariant ||
    catalogVariant.shopId !== input.shopId ||
    catalogVariant.connectionId !== connection.id ||
    catalogVariant.provider !== "printify"
  ) {
    throw new Response("Printify catalog variant not found.", { status: 404 });
  }

  const mapping = await db.providerVariantMapping.upsert({
    where: {
      connectionId_variantId: {
        connectionId: connection.id,
        variantId: variant.id,
      },
    },
    update: {
      provider: "printify",
      status: "mapped",
      providerProductId: catalogVariant.providerProductId,
      providerProductTitle: catalogVariant.providerProductTitle,
      providerVariantId: catalogVariant.providerVariantId,
      providerVariantTitle: catalogVariant.providerVariantTitle,
      providerSku: catalogVariant.providerSku,
      matchMethod: "manual",
      lastCostSyncedAt: catalogVariant.syncedAt,
      lastSyncError: null,
    },
    create: {
      shopId: input.shopId,
      connectionId: connection.id,
      variantId: variant.id,
      provider: "printify",
      status: "mapped",
      providerProductId: catalogVariant.providerProductId,
      providerProductTitle: catalogVariant.providerProductTitle,
      providerVariantId: catalogVariant.providerVariantId,
      providerVariantTitle: catalogVariant.providerVariantTitle,
      providerSku: catalogVariant.providerSku,
      matchMethod: "manual",
      lastCostSyncedAt: catalogVariant.syncedAt,
      lastSyncError: null,
    },
    select: {
      id: true,
    },
  });

  if (catalogVariant.baseCost) {
    await db.providerCostCache.createMany({
      data: [
        {
          mappingId: mapping.id,
          costLineType: "base_fulfillment",
          description:
            catalogVariant.providerVariantTitle ??
            catalogVariant.providerProductTitle ??
            "Printify fulfillment cost",
          amount: catalogVariant.baseCost,
          currency: catalogVariant.currency,
          syncedAt: catalogVariant.syncedAt,
          sourceUpdatedAt: catalogVariant.sourceUpdatedAt,
          staleReason: null,
        },
      ],
    });
  }

  await db.auditLog.create({
    data: {
      shopId: input.shopId,
      entity: "ProviderVariantMapping",
      entityId: mapping.id,
      action: "PRINTIFY_MAPPING_SAVED",
      actor: "merchant",
      payload: {
        provider: "printify",
        variantId: input.variantId,
        providerVariantId: catalogVariant.providerVariantId,
        providerSku: catalogVariant.providerSku,
        matchMethod: "manual",
      },
    },
  });

  return { mappingId: mapping.id };
}
