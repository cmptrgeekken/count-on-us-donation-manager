type TemplateLike = {
  id: string;
  type?: string | null;
  defaultShippingTemplateId?: string | null;
};

type VariantTemplateConfigLike = {
  templateId?: string | null;
  productionTemplateId?: string | null;
  shippingTemplateId?: string | null;
};

export type EffectiveTemplateSelection = {
  productionTemplateId: string | null;
  shippingTemplateId: string | null;
  shippingSource: "explicit" | "production-default" | "none";
};

export function resolveEffectiveTemplateSelection(
  config: VariantTemplateConfigLike | null | undefined,
  templates: TemplateLike[],
): EffectiveTemplateSelection {
  const templatesById = new Map(templates.map((template) => [template.id, template]));

  const productionTemplateId = config?.productionTemplateId ?? config?.templateId ?? null;
  const explicitShippingTemplateId = config?.shippingTemplateId ?? null;

  if (explicitShippingTemplateId) {
    return {
      productionTemplateId,
      shippingTemplateId: explicitShippingTemplateId,
      shippingSource: "explicit",
    };
  }

  if (!productionTemplateId) {
    return {
      productionTemplateId: null,
      shippingTemplateId: null,
      shippingSource: "none",
    };
  }

  const productionTemplate = templatesById.get(productionTemplateId);
  const defaultShippingTemplateId = productionTemplate?.defaultShippingTemplateId ?? null;

  if (defaultShippingTemplateId) {
    return {
      productionTemplateId,
      shippingTemplateId: defaultShippingTemplateId,
      shippingSource: "production-default",
    };
  }

  return {
    productionTemplateId,
    shippingTemplateId: null,
    shippingSource: "none",
  };
}
