-- CreateTable
CREATE TABLE "ProviderCatalogVariant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerProductId" TEXT NOT NULL,
    "providerProductTitle" TEXT,
    "providerVariantId" TEXT NOT NULL,
    "providerVariantTitle" TEXT,
    "providerSku" TEXT,
    "blueprintId" TEXT,
    "printProviderId" TEXT,
    "baseCost" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sourceUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCatalogVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCatalogVariant_connectionId_providerVariantId_key" ON "ProviderCatalogVariant"("connectionId", "providerVariantId");

-- CreateIndex
CREATE INDEX "ProviderCatalogVariant_shopId_provider_idx" ON "ProviderCatalogVariant"("shopId", "provider");

-- CreateIndex
CREATE INDEX "ProviderCatalogVariant_shopId_providerSku_idx" ON "ProviderCatalogVariant"("shopId", "providerSku");

-- AddForeignKey
ALTER TABLE "ProviderCatalogVariant" ADD CONSTRAINT "ProviderCatalogVariant_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
