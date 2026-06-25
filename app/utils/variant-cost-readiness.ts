type VariantCostReadinessConfig = {
  productionTemplateId?: string | null;
  shippingTemplateId?: string | null;
  _count?: {
    materialLines?: number;
    equipmentLines?: number;
  };
} | null;

export function isVariantCostConfigured(costConfig: VariantCostReadinessConfig) {
  if (!costConfig) return false;
  return Boolean(
    costConfig.productionTemplateId ||
      costConfig.shippingTemplateId ||
      (costConfig._count?.materialLines ?? 0) > 0 ||
      (costConfig._count?.equipmentLines ?? 0) > 0,
  );
}
