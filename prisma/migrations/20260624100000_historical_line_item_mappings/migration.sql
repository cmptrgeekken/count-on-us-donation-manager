-- CreateTable
CREATE TABLE "HistoricalLineItemMapping" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "mappingKey" TEXT NOT NULL,
    "lineTitle" TEXT NOT NULL,
    "normalizedLineTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "normalizedVariantTitle" TEXT,
    "sku" TEXT,
    "variantId" TEXT NOT NULL,
    "firstImportBatchId" TEXT,
    "lastImportBatchId" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalLineItemMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalLineItemMapping_shopId_mappingKey_key" ON "HistoricalLineItemMapping"("shopId", "mappingKey");

-- CreateIndex
CREATE INDEX "HistoricalLineItemMapping_shopId_idx" ON "HistoricalLineItemMapping"("shopId");

-- CreateIndex
CREATE INDEX "HistoricalLineItemMapping_shopId_variantId_idx" ON "HistoricalLineItemMapping"("shopId", "variantId");

-- AddForeignKey
ALTER TABLE "HistoricalLineItemMapping" ADD CONSTRAINT "HistoricalLineItemMapping_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
