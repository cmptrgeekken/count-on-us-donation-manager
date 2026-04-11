CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "authType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "displayName" TEXT,
    "credentialsEncrypted" TEXT,
    "credentialHint" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderVariantMapping" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerVariantId" TEXT,
    "providerSku" TEXT,
    "matchMethod" TEXT,
    "lastCostSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderVariantMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderCostCache" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "costLineType" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCostCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderConnection_shopId_provider_key" ON "ProviderConnection"("shopId", "provider");
CREATE INDEX "ProviderConnection_shopId_status_idx" ON "ProviderConnection"("shopId", "status");

CREATE UNIQUE INDEX "ProviderVariantMapping_connectionId_variantId_key" ON "ProviderVariantMapping"("connectionId", "variantId");
CREATE INDEX "ProviderVariantMapping_shopId_provider_idx" ON "ProviderVariantMapping"("shopId", "provider");
CREATE INDEX "ProviderVariantMapping_variantId_idx" ON "ProviderVariantMapping"("variantId");

CREATE INDEX "ProviderCostCache_mappingId_syncedAt_idx" ON "ProviderCostCache"("mappingId", "syncedAt");

ALTER TABLE "ProviderVariantMapping" ADD CONSTRAINT "ProviderVariantMapping_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderVariantMapping" ADD CONSTRAINT "ProviderVariantMapping_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderCostCache" ADD CONSTRAINT "ProviderCostCache_mappingId_fkey"
FOREIGN KEY ("mappingId") REFERENCES "ProviderVariantMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
