export type TemplateDraftMaterialLine = {
  id: string;
  materialId: string;
  materialName: string;
  materialType: string;
  costingModel: string | null;
  perUnitCost: string;
  quantity: string;
  yield: string | null;
  usesPerVariant: string | null;
};

export type TemplateDraftEquipmentLine = {
  id: string;
  equipmentId: string;
  equipmentName: string;
  hourlyRate: string | null;
  perUseCost: string | null;
  minutes: string | null;
  uses: string | null;
};

export type TemplateDraft = {
  name: string;
  description: string;
  materialLines: TemplateDraftMaterialLine[];
  equipmentLines: TemplateDraftEquipmentLine[];
};

export type TemplateCatalogMaterialLine = {
  templateLineId: string;
  materialId: string;
  materialName: string;
  materialType: string;
  costingModel: string | null;
  quantity: string;
  yield: string | null;
  usesPerVariant: string | null;
};

export type TemplateCatalogEquipmentLine = {
  templateLineId: string;
  equipmentId: string;
  equipmentName: string;
  minutes: string | null;
  uses: string | null;
};

export type TemplateCatalogEntry = {
  id: string;
  name: string;
  type?: string | null;
  defaultShippingTemplateId?: string | null;
  materialLines: TemplateCatalogMaterialLine[];
  equipmentLines: TemplateCatalogEquipmentLine[];
};

export type VariantTemplateMaterialDraftLine = TemplateCatalogMaterialLine & {
  hasOverride: boolean;
  overrideQuantity: string | null;
  overrideYield: string | null;
  overrideUsesPerVariant: string | null;
};

export type VariantTemplateEquipmentDraftLine = TemplateCatalogEquipmentLine & {
  hasOverride: boolean;
  overrideMinutes: string | null;
  overrideUses: string | null;
};

export type VariantAdditionalMaterialDraftLine = {
  id: string;
  materialId: string;
  materialName: string;
  materialType: string;
  costingModel: string | null;
  perUnitCost: string;
  quantity: string;
  yield: string | null;
  usesPerVariant: string | null;
};

export type VariantAdditionalEquipmentDraftLine = {
  id: string;
  equipmentId: string;
  equipmentName: string;
  hourlyRate: string | null;
  perUseCost: string | null;
  minutes: string | null;
  uses: string | null;
};

export type VariantDraft = {
  templateId: string | null;
  productionTemplateId?: string | null;
  shippingTemplateId?: string | null;
  laborMinutes: string;
  laborRate: string;
  mistakeBuffer: string;
  templateMaterialLines: VariantTemplateMaterialDraftLine[];
  templateEquipmentLines: VariantTemplateEquipmentDraftLine[];
  materialLines: VariantAdditionalMaterialDraftLine[];
  equipmentLines: VariantAdditionalEquipmentDraftLine[];
};

export function createClientId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneDraft<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeTemplateDraft(draft: TemplateDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    materialLines: draft.materialLines.map((line) => ({
      id: line.id,
      materialId: line.materialId,
      quantity: line.quantity,
      yield: line.yield ?? "",
      usesPerVariant: line.usesPerVariant ?? "",
    })),
    equipmentLines: draft.equipmentLines.map((line) => ({
      id: line.id,
      equipmentId: line.equipmentId,
      minutes: line.minutes ?? "",
      uses: line.uses ?? "",
    })),
  };
}

export function buildVariantTemplateMaterialDraftLines(
  template: TemplateCatalogEntry | null,
): VariantTemplateMaterialDraftLine[] {
  return (template?.materialLines ?? []).map((line) => ({
    ...line,
    hasOverride: false,
    overrideQuantity: null,
    overrideYield: null,
    overrideUsesPerVariant: null,
  }));
}

export function buildVariantTemplateEquipmentDraftLines(
  template: TemplateCatalogEntry | null,
): VariantTemplateEquipmentDraftLine[] {
  return (template?.equipmentLines ?? []).map((line) => ({
    ...line,
    hasOverride: false,
    overrideMinutes: null,
    overrideUses: null,
  }));
}

export function applyTemplateSelectionToVariantDraft(
  draft: VariantDraft,
  template: TemplateCatalogEntry | null,
): VariantDraft {
  return {
    ...draft,
    templateId: template?.id ?? null,
    productionTemplateId: template?.id ?? null,
    templateMaterialLines: buildVariantTemplateMaterialDraftLines(template),
    templateEquipmentLines: buildVariantTemplateEquipmentDraftLines(template),
  };
}

export function normalizeVariantDraft(draft: VariantDraft) {
  return {
    templateId: draft.templateId ?? "",
    productionTemplateId: draft.productionTemplateId ?? "",
    shippingTemplateId: draft.shippingTemplateId ?? "",
    laborMinutes: draft.laborMinutes,
    laborRate: draft.laborRate,
    mistakeBuffer: draft.mistakeBuffer,
    templateMaterialLines: draft.templateMaterialLines.map((line) => ({
      templateLineId: line.templateLineId,
      materialId: line.materialId,
      hasOverride: line.hasOverride,
      overrideQuantity: line.overrideQuantity ?? "",
      overrideYield: line.overrideYield ?? "",
      overrideUsesPerVariant: line.overrideUsesPerVariant ?? "",
    })),
    templateEquipmentLines: draft.templateEquipmentLines.map((line) => ({
      templateLineId: line.templateLineId,
      equipmentId: line.equipmentId,
      hasOverride: line.hasOverride,
      overrideMinutes: line.overrideMinutes ?? "",
      overrideUses: line.overrideUses ?? "",
    })),
    materialLines: draft.materialLines.map((line) => ({
      materialId: line.materialId,
      quantity: line.quantity,
      yield: line.yield ?? "",
      usesPerVariant: line.usesPerVariant ?? "",
    })),
    equipmentLines: draft.equipmentLines.map((line) => ({
      equipmentId: line.equipmentId,
      minutes: line.minutes ?? "",
      uses: line.uses ?? "",
    })),
  };
}

export function hasMeaningfulVariantDraft(draft: VariantDraft) {
  return Boolean(
    draft.templateId ||
      draft.laborMinutes ||
      draft.laborRate ||
      draft.mistakeBuffer ||
      draft.materialLines.length ||
      draft.equipmentLines.length ||
      draft.templateMaterialLines.some((line) => line.hasOverride) ||
      draft.templateEquipmentLines.some((line) => line.hasOverride),
  );
}

export function getVariantAdditionalLineCount(draft: VariantDraft) {
  return draft.materialLines.length + draft.equipmentLines.length;
}
