ALTER TABLE "CostTemplate"
ADD COLUMN "type" TEXT NOT NULL DEFAULT 'production',
ADD COLUMN "defaultShippingTemplateId" TEXT;

ALTER TABLE "VariantCostConfig"
ADD COLUMN "productionTemplateId" TEXT,
ADD COLUMN "shippingTemplateId" TEXT;

UPDATE "VariantCostConfig"
SET "productionTemplateId" = "templateId"
WHERE "templateId" IS NOT NULL
  AND "productionTemplateId" IS NULL;

CREATE INDEX "CostTemplate_shopId_type_status_idx"
ON "CostTemplate"("shopId", "type", "status");

ALTER TABLE "CostTemplate"
ADD CONSTRAINT "CostTemplate_defaultShippingTemplateId_fkey"
FOREIGN KEY ("defaultShippingTemplateId") REFERENCES "CostTemplate"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VariantCostConfig"
ADD CONSTRAINT "VariantCostConfig_productionTemplateId_fkey"
FOREIGN KEY ("productionTemplateId") REFERENCES "CostTemplate"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VariantCostConfig"
ADD CONSTRAINT "VariantCostConfig_shippingTemplateId_fkey"
FOREIGN KEY ("shippingTemplateId") REFERENCES "CostTemplate"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
