-- AlterTable
ALTER TABLE "OrderSnapshot" ADD COLUMN     "periodId" TEXT;

-- CreateTable
CREATE TABLE "ReportingPeriod" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "shopifyPayoutId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CauseAllocation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "causeId" TEXT NOT NULL,
    "causeName" TEXT NOT NULL,
    "is501c3" BOOLEAN NOT NULL,
    "allocated" DECIMAL(10,4) NOT NULL,
    "disbursed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CauseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "causeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "referenceId" TEXT,
    "receiptFileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxTrueUp" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "estimatedTax" DECIMAL(10,2) NOT NULL,
    "actualTax" DECIMAL(10,2) NOT NULL,
    "delta" DECIMAL(10,2) NOT NULL,
    "redistributionNotes" TEXT,
    "filedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxTrueUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyChargeTransaction" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyTransactionId" TEXT NOT NULL,
    "periodId" TEXT,
    "shopifyPayoutId" TEXT,
    "transactionType" TEXT,
    "description" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyChargeTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportingPeriod_shopId_status_idx" ON "ReportingPeriod"("shopId", "status");

-- CreateIndex
CREATE INDEX "ReportingPeriod_shopId_startDate_endDate_idx" ON "ReportingPeriod"("shopId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReportingPeriod_shopId_shopifyPayoutId_key" ON "ReportingPeriod"("shopId", "shopifyPayoutId");

-- CreateIndex
CREATE INDEX "CauseAllocation_shopId_idx" ON "CauseAllocation"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "CauseAllocation_periodId_causeId_key" ON "CauseAllocation"("periodId", "causeId");

-- CreateIndex
CREATE INDEX "Disbursement_shopId_idx" ON "Disbursement"("shopId");

-- CreateIndex
CREATE INDEX "Disbursement_periodId_causeId_idx" ON "Disbursement"("periodId", "causeId");

-- CreateIndex
CREATE INDEX "TaxTrueUp_shopId_idx" ON "TaxTrueUp"("shopId");

-- CreateIndex
CREATE INDEX "TaxTrueUp_periodId_idx" ON "TaxTrueUp"("periodId");

-- CreateIndex
CREATE INDEX "ShopifyChargeTransaction_shopId_idx" ON "ShopifyChargeTransaction"("shopId");

-- CreateIndex
CREATE INDEX "ShopifyChargeTransaction_shopId_shopifyPayoutId_idx" ON "ShopifyChargeTransaction"("shopId", "shopifyPayoutId");

-- CreateIndex
CREATE INDEX "ShopifyChargeTransaction_periodId_idx" ON "ShopifyChargeTransaction"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyChargeTransaction_shopId_shopifyTransactionId_key" ON "ShopifyChargeTransaction"("shopId", "shopifyTransactionId");

-- CreateIndex
CREATE INDEX "OrderSnapshot_shopId_periodId_idx" ON "OrderSnapshot"("shopId", "periodId");

-- AddForeignKey
ALTER TABLE "OrderSnapshot" ADD CONSTRAINT "OrderSnapshot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CauseAllocation" ADD CONSTRAINT "CauseAllocation_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CauseAllocation" ADD CONSTRAINT "CauseAllocation_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "Cause"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "Cause"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxTrueUp" ADD CONSTRAINT "TaxTrueUp_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyChargeTransaction" ADD CONSTRAINT "ShopifyChargeTransaction_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
