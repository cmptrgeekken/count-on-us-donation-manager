import { prisma } from "../db.server";
import { encryptProviderCredential } from "./providerCredentials.server";

type ProviderDbClient = Pick<
  typeof prisma,
  "providerConnection" | "providerVariantMapping" | "variant" | "auditLog"
>;

export type ProviderConnectionSummary = {
  provider: "printful" | "printify";
  authType: "oauth" | "api_key";
  status: "not_configured" | "configured";
  configured: boolean;
  displayName: string | null;
  credentialHint: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
  mappedVariantCount: number;
  unmappedVariantCount: number;
  note: string;
};

export type ProviderConnectionsPageData = {
  totalVariantCount: number;
  variantsWithSkuCount: number;
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
  const [connections, totalVariantCount, variantsWithSkuCount] = await Promise.all([
    db.providerConnection.findMany({
      where: { shopId },
      select: {
        provider: true,
        authType: true,
        status: true,
        displayName: true,
        credentialHint: true,
        lastSyncedAt: true,
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
  ]);

  const connectionMap = new Map(connections.map((connection) => [connection.provider, connection]));

  const summaries: ProviderConnectionSummary[] = [
    {
      provider: "printful",
      authType: "oauth",
      status: connectionMap.has("printful") ? "configured" : "not_configured",
      configured: connectionMap.has("printful"),
      displayName: connectionMap.get("printful")?.displayName ?? null,
      credentialHint: connectionMap.get("printful")?.credentialHint ?? null,
      lastSyncedAt: toIsoString(connectionMap.get("printful")?.lastSyncedAt),
      updatedAt: toIsoString(connectionMap.get("printful")?.updatedAt),
      mappedVariantCount: connectionMap.get("printful")?._count.mappings ?? 0,
      unmappedVariantCount: Math.max(variantsWithSkuCount - (connectionMap.get("printful")?._count.mappings ?? 0), 0),
      note: "Printful OAuth is not wired yet. This page will expose that flow in a later provider tranche.",
    },
    {
      provider: "printify",
      authType: "api_key",
      status: connectionMap.has("printify") ? "configured" : "not_configured",
      configured: connectionMap.has("printify"),
      displayName: connectionMap.get("printify")?.displayName ?? null,
      credentialHint: connectionMap.get("printify")?.credentialHint ?? null,
      lastSyncedAt: toIsoString(connectionMap.get("printify")?.lastSyncedAt),
      updatedAt: toIsoString(connectionMap.get("printify")?.updatedAt),
      mappedVariantCount: connectionMap.get("printify")?._count.mappings ?? 0,
      unmappedVariantCount: Math.max(variantsWithSkuCount - (connectionMap.get("printify")?._count.mappings ?? 0), 0),
      note:
        "Printify API keys can be stored now. Live validation, variant matching, and cost sync are still pending.",
    },
  ];

  return {
    totalVariantCount,
    variantsWithSkuCount,
    summaries,
  };
}

export async function savePrintifyConnection(
  input: {
    shopId: string;
    apiKey: string;
    displayName?: string | null;
  },
  db: ProviderDbClient = prisma,
): Promise<{ id: string }> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Response("Printify API key is required.", { status: 400 });
  }

  if (apiKey.length < 8) {
    throw new Response("Printify API key looks too short.", { status: 400 });
  }

  const displayName = input.displayName?.trim() || null;
  const credentialsEncrypted = encryptProviderCredential(apiKey);
  const credentialHint = maskApiKey(apiKey);

  const connection = await db.providerConnection.upsert({
    where: {
      shopId_provider: {
        shopId: input.shopId,
        provider: "printify",
      },
    },
    update: {
      authType: "api_key",
      status: "configured",
      displayName,
      credentialsEncrypted,
      credentialHint,
    },
    create: {
      shopId: input.shopId,
      provider: "printify",
      authType: "api_key",
      status: "configured",
      displayName,
      credentialsEncrypted,
      credentialHint,
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
        status: "configured",
        displayName,
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
