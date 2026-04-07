-- Enforce whole-number count fields at the database boundary.
-- Minutes, purchase quantities, percentages, and money remain decimal-valued by design.

ALTER TABLE "CostTemplateMaterialLine"
  ADD CONSTRAINT "CostTemplateMaterialLine_quantity_whole_nonnegative"
    CHECK ("quantity" >= 0 AND "quantity" = trunc("quantity")),
  ADD CONSTRAINT "CostTemplateMaterialLine_yield_whole_nonnegative"
    CHECK ("yield" IS NULL OR ("yield" >= 0 AND "yield" = trunc("yield"))),
  ADD CONSTRAINT "CostTemplateMaterialLine_usesPerVariant_whole_nonnegative"
    CHECK ("usesPerVariant" IS NULL OR ("usesPerVariant" >= 0 AND "usesPerVariant" = trunc("usesPerVariant")));

ALTER TABLE "CostTemplateEquipmentLine"
  ADD CONSTRAINT "CostTemplateEquipmentLine_uses_whole_nonnegative"
    CHECK ("uses" IS NULL OR ("uses" >= 0 AND "uses" = trunc("uses")));

ALTER TABLE "VariantMaterialLine"
  ADD CONSTRAINT "VariantMaterialLine_quantity_whole_nonnegative"
    CHECK ("quantity" >= 0 AND "quantity" = trunc("quantity")),
  ADD CONSTRAINT "VariantMaterialLine_yield_whole_nonnegative"
    CHECK ("yield" IS NULL OR ("yield" >= 0 AND "yield" = trunc("yield"))),
  ADD CONSTRAINT "VariantMaterialLine_usesPerVariant_whole_nonnegative"
    CHECK ("usesPerVariant" IS NULL OR ("usesPerVariant" >= 0 AND "usesPerVariant" = trunc("usesPerVariant")));

ALTER TABLE "VariantEquipmentLine"
  ADD CONSTRAINT "VariantEquipmentLine_uses_whole_nonnegative"
    CHECK ("uses" IS NULL OR ("uses" >= 0 AND "uses" = trunc("uses")));
