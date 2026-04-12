import { prisma } from "../db.server";
import { encryptProviderCredential } from "./providerCredentials.server";
import { validatePrintifyApiKey, PrintifyValidationError } from "./printify.server";

type ProviderDbClient = Pick<
  typeof prisma,
  "providerConnection" | "providerVariantMapping" | "variant" | "auditLog" | "providerSyncRun"
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
  printifyUnresolvedVariants: Array<{
    variantId: string;
    productTitle: string;
    variantTitle: string;
    sku: string;
    reason: string;
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
  const [connections, totalVariantCount, variantsWithSkuCount, variants, printifyMappings] = await Promise.all([
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
  const skuCounts = new Map<string, number>();

  for (const variant of variants) {
    const sku = variant.sku?.trim();
    if (!sku) continue;

    skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  }

  const printifyUnresolvedVariants = variants.flatMap((variant) => {
    const sku = variant.sku?.trim();
    if (!sku) {
      return [];
    }

    const mapping = printifyMappingByVariantId.get(variant.id);
    if (mapping?.status === "mapped") {
      return [];
    }

    const reason =
      (skuCounts.get(sku) ?? 0) > 1
        ? "Duplicate SKU prevents automatic Printify matching for this variant."
        : mapping?.lastSyncError?.trim() || "No Printify SKU match found in the latest sync.";

    return [
      {
        variantId: variant.id,
        productTitle: variant.product.title,
        variantTitle: variant.title,
        sku,
        reason,
      },
    ];
  });

  return {
    totalVariantCount,
    variantsWithSkuCount,
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
