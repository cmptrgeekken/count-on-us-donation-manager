-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "mistakeBuffer" DECIMAL(5,4);

-- CreateTable
CREATE TABLE "MaterialLibraryItem" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "costingModel" TEXT,
    "purchasePrice" DECIMAL(10,4) NOT NULL,
    "purchaseQty" DECIMAL(10,4) NOT NULL,
    "perUnitCost" DECIMAL(10,6) NOT NULL,
    "totalUsesPerUnit" DECIMAL(10,4),
    "unitDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentLibraryItem" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourlyRate" DECIMAL(10,4),
    "perUseCost" DECIMAL(10,4),
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostTemplate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostTemplateMaterialLine" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "yield" DECIMAL(10,4),
    "quantity" DECIMAL(10,4) NOT NULL,
    "usesPerVariant" DECIMAL(10,4),

    CONSTRAINT "CostTemplateMaterialLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostTemplateEquipmentLine" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "minutes" DECIMAL(10,4),
    "uses" DECIMAL(10,4),

    CONSTRAINT "CostTemplateEquipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantCostConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "templateId" TEXT,
    "laborMinutes" DECIMAL(10,4),
    "laborRate" DECIMAL(10,4),
    "mistakeBuffer" DECIMAL(5,4),
    "lineItemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantCostConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantMaterialLine" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "yield" DECIMAL(10,4),
    "quantity" DECIMAL(10,4) NOT NULL,
    "usesPerVariant" DECIMAL(10,4),

    CONSTRAINT "VariantMaterialLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantEquipmentLine" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "minutes" DECIMAL(10,4),
    "uses" DECIMAL(10,4),

    CONSTRAINT "VariantEquipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialLibraryItem_shopId_status_idx" ON "MaterialLibraryItem"("shopId", "status");

-- CreateIndex
CREATE INDEX "EquipmentLibraryItem_shopId_status_idx" ON "EquipmentLibraryItem"("shopId", "status");

-- CreateIndex
CREATE INDEX "CostTemplate_shopId_status_idx" ON "CostTemplate"("shopId", "status");

-- CreateIndex
CREATE INDEX "Product_shopId_idx" ON "Product"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopId_shopifyId_key" ON "Product"("shopId", "shopifyId");

-- CreateIndex
CREATE INDEX "Variant_shopId_idx" ON "Variant"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_shopId_shopifyId_key" ON "Variant"("shopId", "shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantCostConfig_variantId_key" ON "VariantCostConfig"("variantId");

-- CreateIndex
CREATE INDEX "VariantCostConfig_shopId_idx" ON "VariantCostConfig"("shopId");

-- CreateIndex
CREATE INDEX "VariantMaterialLine_shopId_idx" ON "VariantMaterialLine"("shopId");

-- CreateIndex
CREATE INDEX "VariantEquipmentLine_shopId_idx" ON "VariantEquipmentLine"("shopId");

-- AddForeignKey
ALTER TABLE "CostTemplateMaterialLine" ADD CONSTRAINT "CostTemplateMaterialLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CostTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostTemplateMaterialLine" ADD CONSTRAINT "CostTemplateMaterialLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "MaterialLibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostTemplateEquipmentLine" ADD CONSTRAINT "CostTemplateEquipmentLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CostTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostTemplateEquipmentLine" ADD CONSTRAINT "CostTemplateEquipmentLine_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "EquipmentLibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantCostConfig" ADD CONSTRAINT "VariantCostConfig_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantCostConfig" ADD CONSTRAINT "VariantCostConfig_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CostTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMaterialLine" ADD CONSTRAINT "VariantMaterialLine_configId_fkey" FOREIGN KEY ("configId") REFERENCES "VariantCostConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMaterialLine" ADD CONSTRAINT "VariantMaterialLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "MaterialLibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantEquipmentLine" ADD CONSTRAINT "VariantEquipmentLine_configId_fkey" FOREIGN KEY ("configId") REFERENCES "VariantCostConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantEquipmentLine" ADD CONSTRAINT "VariantEquipmentLine_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "EquipmentLibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
