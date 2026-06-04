-- App-managed package registry and cartonization audit trail.

CREATE TABLE "ShippingPackage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shopifyPackageId" TEXT,
    "length" DECIMAL(10,3) NOT NULL,
    "width" DECIMAL(10,3) NOT NULL,
    "height" DECIMAL(10,3) NOT NULL,
    "emptyWeightGrams" DECIMAL(10,3),
    "maxWeightGrams" DECIMAL(10,3),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShippingPackageMaterialLine" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "ShippingPackageMaterialLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderPackageAllocation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "packageId" TEXT,
    "packageName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "materialCost" DECIMAL(10,4) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'cartonization',
    "confidence" TEXT NOT NULL DEFAULT 'high',
    "reason" TEXT,
    "allocationSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPackageAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackagingReviewItem" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "payload" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingReviewItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "VariantCostConfig"
ADD COLUMN "preferredPackageId" TEXT,
ADD COLUMN "packedLength" DECIMAL(10,3),
ADD COLUMN "packedWidth" DECIMAL(10,3),
ADD COLUMN "packedHeight" DECIMAL(10,3),
ADD COLUMN "packedWeightGrams" DECIMAL(10,3),
ADD COLUMN "canSharePackage" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "ShippingPackage_shopId_shopifyPackageId_key" ON "ShippingPackage"("shopId", "shopifyPackageId");
CREATE INDEX "ShippingPackage_shopId_status_idx" ON "ShippingPackage"("shopId", "status");
CREATE UNIQUE INDEX "ShippingPackageMaterialLine_packageId_materialId_key" ON "ShippingPackageMaterialLine"("packageId", "materialId");
CREATE INDEX "ShippingPackageMaterialLine_shopId_idx" ON "ShippingPackageMaterialLine"("shopId");
CREATE INDEX "VariantCostConfig_shopId_preferredPackageId_idx" ON "VariantCostConfig"("shopId", "preferredPackageId");
CREATE INDEX "OrderPackageAllocation_shopId_idx" ON "OrderPackageAllocation"("shopId");
CREATE INDEX "OrderPackageAllocation_snapshotId_idx" ON "OrderPackageAllocation"("snapshotId");
CREATE UNIQUE INDEX "OrderPackageAllocation_snapshotId_allocationSignature_key" ON "OrderPackageAllocation"("snapshotId", "allocationSignature");
CREATE INDEX "PackagingReviewItem_shopId_status_idx" ON "PackagingReviewItem"("shopId", "status");
CREATE INDEX "PackagingReviewItem_snapshotId_idx" ON "PackagingReviewItem"("snapshotId");

ALTER TABLE "VariantCostConfig" ADD CONSTRAINT "VariantCostConfig_preferredPackageId_fkey" FOREIGN KEY ("preferredPackageId") REFERENCES "ShippingPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShippingPackageMaterialLine" ADD CONSTRAINT "ShippingPackageMaterialLine_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ShippingPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShippingPackageMaterialLine" ADD CONSTRAINT "ShippingPackageMaterialLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "MaterialLibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderPackageAllocation" ADD CONSTRAINT "OrderPackageAllocation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OrderSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderPackageAllocation" ADD CONSTRAINT "OrderPackageAllocation_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ShippingPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PackagingReviewItem" ADD CONSTRAINT "PackagingReviewItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OrderSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
