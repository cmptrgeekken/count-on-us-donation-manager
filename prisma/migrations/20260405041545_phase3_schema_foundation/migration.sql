-- CreateTable
CREATE TABLE "Cause" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyMetaobjectId" TEXT,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "is501c3" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "iconUrl" TEXT,
    "donationLink" TEXT,
    "websiteUrl" TEXT,
    "instagramUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCauseAssignment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "causeId" TEXT NOT NULL,
    "productId" TEXT,
    "percentage" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCauseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'webhook',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSnapshotLine" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "salePrice" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "laborCost" DECIMAL(10,4) NOT NULL,
    "materialCost" DECIMAL(10,4) NOT NULL,
    "packagingCost" DECIMAL(10,4) NOT NULL,
    "equipmentCost" DECIMAL(10,4) NOT NULL,
    "podCost" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "mistakeBufferAmount" DECIMAL(10,4) NOT NULL,
    "totalCost" DECIMAL(10,4) NOT NULL,
    "netContribution" DECIMAL(10,4) NOT NULL,
    "laborMinutes" DECIMAL(10,2),
    "laborRate" DECIMAL(10,2),
    "podCostEstimated" BOOLEAN NOT NULL DEFAULT false,
    "podCostMissing" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrderSnapshotLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSnapshotMaterialLine" (
    "id" TEXT NOT NULL,
    "snapshotLineId" TEXT NOT NULL,
    "materialId" TEXT,
    "materialName" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "costingModel" TEXT,
    "purchasePrice" DECIMAL(10,2) NOT NULL,
    "purchaseQty" DECIMAL(10,4) NOT NULL,
    "perUnitCost" DECIMAL(10,4) NOT NULL,
    "yield" DECIMAL(10,4),
    "usesPerVariant" DECIMAL(10,4),
    "quantity" DECIMAL(10,4) NOT NULL,
    "lineCost" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "OrderSnapshotMaterialLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSnapshotEquipmentLine" (
    "id" TEXT NOT NULL,
    "snapshotLineId" TEXT NOT NULL,
    "equipmentId" TEXT,
    "equipmentName" TEXT NOT NULL,
    "hourlyRate" DECIMAL(10,2),
    "perUseCost" DECIMAL(10,2),
    "minutes" DECIMAL(10,2),
    "uses" DECIMAL(10,2),
    "lineCost" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "OrderSnapshotEquipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSnapshotPODLine" (
    "id" TEXT NOT NULL,
    "snapshotLineId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "costLineType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "OrderSnapshotPODLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineCauseAllocation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "snapshotLineId" TEXT NOT NULL,
    "causeId" TEXT NOT NULL,
    "causeName" TEXT NOT NULL,
    "is501c3" BOOLEAN NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "LineCauseAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adjustment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "snapshotLineId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "laborAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "materialAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "packagingAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "equipmentAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "netContribAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL DEFAULT 'system',

    CONSTRAINT "Adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessExpense" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subType" TEXT,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxOffsetCache" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "taxableExposure" DECIMAL(10,2) NOT NULL,
    "deductionPool" DECIMAL(10,2) NOT NULL,
    "cumulativeNetContrib" DECIMAL(10,2) NOT NULL,
    "widgetTaxSuppressed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxOffsetCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cause_shopId_status_idx" ON "Cause"("shopId", "status");

-- CreateIndex
CREATE INDEX "ProductCauseAssignment_shopId_idx" ON "ProductCauseAssignment"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCauseAssignment_shopId_shopifyProductId_causeId_key" ON "ProductCauseAssignment"("shopId", "shopifyProductId", "causeId");

-- CreateIndex
CREATE INDEX "OrderSnapshot_shopId_idx" ON "OrderSnapshot"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSnapshot_shopId_shopifyOrderId_key" ON "OrderSnapshot"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderSnapshotLine_shopId_idx" ON "OrderSnapshotLine"("shopId");

-- CreateIndex
CREATE INDEX "OrderSnapshotLine_snapshotId_idx" ON "OrderSnapshotLine"("snapshotId");

-- CreateIndex
CREATE INDEX "LineCauseAllocation_shopId_idx" ON "LineCauseAllocation"("shopId");

-- CreateIndex
CREATE INDEX "Adjustment_shopId_idx" ON "Adjustment"("shopId");

-- CreateIndex
CREATE INDEX "BusinessExpense_shopId_idx" ON "BusinessExpense"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxOffsetCache_shopId_key" ON "TaxOffsetCache"("shopId");

-- AddForeignKey
ALTER TABLE "ProductCauseAssignment" ADD CONSTRAINT "ProductCauseAssignment_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "Cause"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCauseAssignment" ADD CONSTRAINT "ProductCauseAssignment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSnapshotLine" ADD CONSTRAINT "OrderSnapshotLine_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OrderSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSnapshotMaterialLine" ADD CONSTRAINT "OrderSnapshotMaterialLine_snapshotLineId_fkey" FOREIGN KEY ("snapshotLineId") REFERENCES "OrderSnapshotLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSnapshotEquipmentLine" ADD CONSTRAINT "OrderSnapshotEquipmentLine_snapshotLineId_fkey" FOREIGN KEY ("snapshotLineId") REFERENCES "OrderSnapshotLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSnapshotPODLine" ADD CONSTRAINT "OrderSnapshotPODLine_snapshotLineId_fkey" FOREIGN KEY ("snapshotLineId") REFERENCES "OrderSnapshotLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineCauseAllocation" ADD CONSTRAINT "LineCauseAllocation_snapshotLineId_fkey" FOREIGN KEY ("snapshotLineId") REFERENCES "OrderSnapshotLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineCauseAllocation" ADD CONSTRAINT "LineCauseAllocation_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "Cause"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_snapshotLineId_fkey" FOREIGN KEY ("snapshotLineId") REFERENCES "OrderSnapshotLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
