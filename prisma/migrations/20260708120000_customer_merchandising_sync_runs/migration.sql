CREATE TABLE "CustomerMerchandisingSyncRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "syncedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "resultSummary" JSONB,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMerchandisingSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerMerchandisingSyncRun_shopId_createdAt_idx"
ON "CustomerMerchandisingSyncRun"("shopId", "createdAt");

CREATE INDEX "CustomerMerchandisingSyncRun_shopId_status_createdAt_idx"
ON "CustomerMerchandisingSyncRun"("shopId", "status", "createdAt");
