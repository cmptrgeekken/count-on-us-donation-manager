ALTER TABLE "VariantMaterialLine"
ADD COLUMN "templateLineId" TEXT;

ALTER TABLE "VariantEquipmentLine"
ADD COLUMN "templateLineId" TEXT;

CREATE UNIQUE INDEX "VariantMaterialLine_configId_templateLineId_key"
ON "VariantMaterialLine"("configId", "templateLineId");

CREATE UNIQUE INDEX "VariantEquipmentLine_configId_templateLineId_key"
ON "VariantEquipmentLine"("configId", "templateLineId");

ALTER TABLE "VariantMaterialLine"
ADD CONSTRAINT "VariantMaterialLine_templateLineId_fkey"
FOREIGN KEY ("templateLineId") REFERENCES "CostTemplateMaterialLine"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VariantEquipmentLine"
ADD CONSTRAINT "VariantEquipmentLine_templateLineId_fkey"
FOREIGN KEY ("templateLineId") REFERENCES "CostTemplateEquipmentLine"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
