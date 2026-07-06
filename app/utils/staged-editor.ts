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
  usageBasis: string;
  hourlyRate: string | null;
  perUseCost: string | null;
  usageMode: string;
  minutes: string | null;
  uses: string | null;
  yieldDurationMinutes: string | null;
  yieldUses: string | null;
  yieldQuantity: string | null;
};

export type TemplateDraft = {
  name: string;
  description: string;
  defaultShippingTemplateId?: string | null;
  defaultLaborMinutes: string;
  defaultLaborRate: string;
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
  usageBasis: string;
  usageMode: string;
  minutes: string | null;
  uses: string | null;
  yieldDurationMinutes: string | null;
  yieldUses: string | null;
  yieldQuantity: string | null;
};

export type TemplateCatalogEntry = {
  id: string;
  name: string;
  type?: string | null;
  defaultShippingTemplateId?: string | null;
  defaultLaborMinutes?: string | null;
  defaultLaborRate?: string | null;
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
  overrideUsageMode: string | null;
  overrideMinutes: string | null;
  overrideUses: string | null;
  overrideYieldDurationMinutes: string | null;
  overrideYieldUses: string | null;
  overrideYieldQuantity: string | null;
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
  usageBasis: string;
  hourlyRate: string | null;
  perUseCost: string | null;
  usageMode: string;
  minutes: string | null;
  uses: string | null;
  yieldDurationMinutes: string | null;
  yieldUses: string | null;
  yieldQuantity: string | null;
};

export type VariantDraft = {
  productionTemplateId?: string | null;
  shippingTemplateId?: string | null;
  preferredPackageId?: string | null;
  packedLength: string;
  packedWidth: string;
  packedHeight: string;
  packedWeightGrams: string;
  canSharePackage: boolean;
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
    defaultShippingTemplateId: draft.defaultShippingTemplateId ?? "",
    defaultLaborMinutes: draft.defaultLaborMinutes.trim(),
    defaultLaborRate: draft.defaultLaborRate.trim(),
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
      usageMode: line.usageMode ?? "direct",
      minutes: line.minutes ?? "",
      uses: line.uses ?? "",
      yieldDurationMinutes: line.yieldDurationMinutes ?? "",
      yieldUses: line.yieldUses ?? "",
      yieldQuantity: line.yieldQuantity ?? "",
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
    usageMode: line.usageMode ?? "direct",
    yieldDurationMinutes: line.yieldDurationMinutes ?? null,
    yieldUses: line.yieldUses ?? null,
    yieldQuantity: line.yieldQuantity ?? null,
    hasOverride: false,
    overrideUsageMode: null,
    overrideMinutes: null,
    overrideUses: null,
    overrideYieldDurationMinutes: null,
    overrideYieldUses: null,
    overrideYieldQuantity: null,
  }));
}

export function applyTemplateSelectionToVariantDraft(
  draft: VariantDraft,
  template: TemplateCatalogEntry | null,
): VariantDraft {
  return {
    ...draft,
    productionTemplateId: template?.id ?? null,
    templateMaterialLines: buildVariantTemplateMaterialDraftLines(template),
    templateEquipmentLines: buildVariantTemplateEquipmentDraftLines(template),
  };
}

export function applyShippingTemplateSelectionToVariantDraft(
  draft: VariantDraft,
  template: TemplateCatalogEntry | null,
): VariantDraft {
  return {
    ...draft,
    shippingTemplateId: template?.id ?? null,
  };
}

export function normalizeVariantDraft(draft: VariantDraft) {
  return {
    productionTemplateId: draft.productionTemplateId ?? "",
    shippingTemplateId: draft.shippingTemplateId ?? "",
    preferredPackageId: draft.preferredPackageId ?? "",
    packedLength: draft.packedLength,
    packedWidth: draft.packedWidth,
    packedHeight: draft.packedHeight,
    packedWeightGrams: draft.packedWeightGrams,
    canSharePackage: draft.canSharePackage,
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
      overrideUsageMode: line.overrideUsageMode ?? "",
      overrideMinutes: line.overrideMinutes ?? "",
      overrideUses: line.overrideUses ?? "",
      overrideYieldDurationMinutes: line.overrideYieldDurationMinutes ?? "",
      overrideYieldUses: line.overrideYieldUses ?? "",
      overrideYieldQuantity: line.overrideYieldQuantity ?? "",
    })),
    materialLines: draft.materialLines.map((line) => ({
      materialId: line.materialId,
      quantity: line.quantity,
      yield: line.yield ?? "",
      usesPerVariant: line.usesPerVariant ?? "",
    })),
    equipmentLines: draft.equipmentLines.map((line) => ({
      equipmentId: line.equipmentId,
      usageMode: line.usageMode ?? "direct",
      minutes: line.minutes ?? "",
      uses: line.uses ?? "",
      yieldDurationMinutes: line.yieldDurationMinutes ?? "",
      yieldUses: line.yieldUses ?? "",
      yieldQuantity: line.yieldQuantity ?? "",
    })),
  };
}

export function hasMeaningfulVariantDraft(draft: VariantDraft) {
  return Boolean(
    draft.productionTemplateId ||
      draft.shippingTemplateId ||
      draft.preferredPackageId ||
      draft.packedLength ||
      draft.packedWidth ||
      draft.packedHeight ||
      draft.packedWeightGrams ||
      draft.canSharePackage === false ||
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
