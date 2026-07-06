CREATE TABLE "OrderSettlement" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "snapshotId" TEXT,
  "periodId" TEXT,
  "shopifyOrderId" TEXT NOT NULL,
  "orderNumber" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'needs_review',
  "grossOrderAmount" DECIMAL(10,2) NOT NULL,
  "shopifyPaidAmount" DECIMAL(10,2),
  "amountReceived" DECIMAL(10,2),
  "feeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "paidAt" TIMESTAMP(3),
  "referenceId" TEXT,
  "notes" TEXT,
  "detectedReason" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmedBy" TEXT,
  "ignoredAt" TIMESTAMP(3),
  "ignoredBy" TEXT,
  "ignoreReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderSettlement_shopId_shopifyOrderId_key" ON "OrderSettlement"("shopId", "shopifyOrderId");
CREATE INDEX "OrderSettlement_shopId_status_idx" ON "OrderSettlement"("shopId", "status");
CREATE INDEX "OrderSettlement_shopId_periodId_idx" ON "OrderSettlement"("shopId", "periodId");
CREATE INDEX "OrderSettlement_snapshotId_idx" ON "OrderSettlement"("snapshotId");

ALTER TABLE "OrderSettlement"
  ADD CONSTRAINT "OrderSettlement_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "OrderSnapshot"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderSettlement"
  ADD CONSTRAINT "OrderSettlement_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
