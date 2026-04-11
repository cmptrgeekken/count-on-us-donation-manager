-- AlterTable
ALTER TABLE "ProviderConnection" ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastValidatedAt" TIMESTAMP(3),
ADD COLUMN     "lastValidationError" TEXT,
ADD COLUMN     "providerAccountId" TEXT,
ADD COLUMN     "providerAccountName" TEXT;

-- AlterTable
ALTER TABLE "ProviderCostCache" ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "staleReason" TEXT;

-- AlterTable
ALTER TABLE "ProviderVariantMapping" ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "providerProductId" TEXT,
ADD COLUMN     "providerProductTitle" TEXT,
ADD COLUMN     "providerVariantTitle" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'mapped';

-- CreateTable
CREATE TABLE "ProviderSyncRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "mappedCount" INTEGER NOT NULL DEFAULT 0,
    "unmappedCount" INTEGER NOT NULL DEFAULT 0,
    "cachedCostCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderSyncRun_shopId_provider_createdAt_idx" ON "ProviderSyncRun"("shopId", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderSyncRun_connectionId_createdAt_idx" ON "ProviderSyncRun"("connectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProviderSyncRun" ADD CONSTRAINT "ProviderSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
