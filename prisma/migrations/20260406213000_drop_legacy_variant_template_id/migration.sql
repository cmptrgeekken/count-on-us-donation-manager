ALTER TABLE "VariantCostConfig"
DROP CONSTRAINT IF EXISTS "VariantCostConfig_templateId_fkey";

ALTER TABLE "VariantCostConfig"
DROP COLUMN IF EXISTS "templateId";
