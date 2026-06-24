-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "sourceName" TEXT,
    "sourceType" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "OrderSnapshot" ADD COLUMN "importBatchId" TEXT,
ADD COLUMN "importedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ShopifyChargeTransaction" ADD COLUMN "importBatchId" TEXT;

-- CreateIndex
CREATE INDEX "ImportBatch_shopId_createdAt_idx" ON "ImportBatch"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportBatch_shopId_kind_createdAt_idx" ON "ImportBatch"("shopId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "OrderSnapshot_shopId_importBatchId_idx" ON "OrderSnapshot"("shopId", "importBatchId");

-- CreateIndex
CREATE INDEX "ShopifyChargeTransaction_shopId_importBatchId_idx" ON "ShopifyChargeTransaction"("shopId", "importBatchId");

-- AddForeignKey
ALTER TABLE "OrderSnapshot" ADD CONSTRAINT "OrderSnapshot_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyChargeTransaction" ADD CONSTRAINT "ShopifyChargeTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
