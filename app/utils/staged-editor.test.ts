import { describe, expect, it } from "vitest";
import {
  applyShippingTemplateSelectionToVariantDraft,
  applyTemplateSelectionToVariantDraft,
  buildVariantTemplateEquipmentDraftLines,
  buildVariantTemplateMaterialDraftLines,
  getVariantAdditionalLineCount,
  hasMeaningfulVariantDraft,
  normalizeTemplateDraft,
  normalizeVariantDraft,
  type TemplateCatalogEntry,
  type TemplateDraft,
  type VariantDraft,
} from "./staged-editor";

const catalogEntry: TemplateCatalogEntry = {
  id: "template-1",
  name: "Starter",
  defaultLaborMinutes: "12",
  defaultLaborRate: "30.00",
  materialLines: [
    {
      templateLineId: "mat-line-1",
      materialId: "mat-1",
      materialName: "Cotton",
      materialType: "production",
      costingModel: "yield",
      quantity: "2",
      yield: "10",
      usesPerVariant: null,
      lineCost: "2.00",
    },
  ],
  equipmentLines: [
    {
      templateLineId: "eq-line-1",
      equipmentId: "eq-1",
      equipmentName: "Press",
      usageBasis: "time_and_unit",
      usageMode: "direct",
      minutes: "12",
      uses: null,
      yieldDurationMinutes: null,
      yieldUses: null,
      yieldQuantity: null,
      lineCost: "2.40",
    },
  ],
};

describe("staged editor helpers", () => {
  it("normalizes template drafts for stable dirty-state comparisons", () => {
    const draft: TemplateDraft = {
      name: " Example ",
      description: " Test ",
      defaultShippingTemplateId: "ship-1",
      defaultLaborMinutes: " 12 ",
      defaultLaborRate: "30.00",
      mistakeBuffer: " 7.50 ",
      materialLines: [
        {
          id: "line-1",
          materialId: "mat-1",
          materialName: "Cotton",
          materialType: "production",
          costingModel: "yield",
          perUnitCost: "3.00",
          quantity: "2",
          yield: null,
          usesPerVariant: null,
        },
      ],
      equipmentLines: [],
    };

    expect(normalizeTemplateDraft(draft)).toEqual({
      name: "Example",
      description: "Test",
      defaultShippingTemplateId: "ship-1",
      defaultLaborMinutes: "12",
      defaultLaborRate: "30.00",
      mistakeBuffer: "7.50",
      materialLines: [
        {
          id: "line-1",
          materialId: "mat-1",
          quantity: "2",
          yield: "",
          usesPerVariant: "",
        },
      ],
      equipmentLines: [],
    });
  });

  it("rebuilds template-backed variant sections when the template changes", () => {
    const draft: VariantDraft = {
      productionTemplateId: "old-template",
      preferredPackageId: null,
      templateProductYield: "7",
      packedLength: "",
      packedWidth: "",
      packedHeight: "",
      packedWeightGrams: "",
      canSharePackage: true,
      laborMinutes: "",
      laborRate: "",
      mistakeBuffer: "",
      templateMaterialLines: [
        {
          ...buildVariantTemplateMaterialDraftLines(catalogEntry)[0],
          hasOverride: true,
          overrideQuantity: "5",
          overrideYield: "8",
          overrideUsesPerVariant: null,
          overrideLineCost: null,
        },
      ],
      shippingTemplateMaterialLines: [],
      templateEquipmentLines: [
        {
          ...buildVariantTemplateEquipmentDraftLines(catalogEntry)[0],
          hasOverride: true,
          overrideMinutes: "20",
          overrideUses: null,
        },
      ],
      materialLines: [],
      equipmentLines: [],
    };

    expect(applyTemplateSelectionToVariantDraft(draft, catalogEntry)).toEqual({
      ...draft,
      productionTemplateId: "template-1",
      templateProductYield: "7",
      templateMaterialLines: [
        {
          templateLineId: "mat-line-1",
          materialId: "mat-1",
          materialName: "Cotton",
          materialType: "production",
          costingModel: "yield",
          quantity: "2",
          yield: "10",
          usesPerVariant: null,
          lineCost: "2.00",
          hasOverride: false,
          overrideQuantity: null,
          overrideYield: null,
          overrideUsesPerVariant: null,
          overrideLineCost: null,
        },
      ],
      templateEquipmentLines: [
        {
          templateLineId: "eq-line-1",
          equipmentId: "eq-1",
          equipmentName: "Press",
          usageBasis: "time_and_unit",
          usageMode: "direct",
          minutes: "12",
          uses: null,
          yieldDurationMinutes: null,
          yieldUses: null,
          yieldQuantity: null,
          lineCost: "2.40",
          hasOverride: false,
          overrideUsageMode: null,
          overrideMinutes: null,
          overrideUses: null,
          overrideYieldDurationMinutes: null,
          overrideYieldUses: null,
          overrideYieldQuantity: null,
          overrideLineCost: null,
        },
      ],
    });
  });

  it("detects meaningful variant state and derives additional line counts", () => {
    const emptyDraft: VariantDraft = {
      productionTemplateId: null,
      preferredPackageId: null,
      templateProductYield: "",
      packedLength: "",
      packedWidth: "",
      packedHeight: "",
      packedWeightGrams: "",
      canSharePackage: true,
      laborMinutes: "",
      laborRate: "",
      mistakeBuffer: "",
      templateMaterialLines: [],
      shippingTemplateMaterialLines: [],
      templateEquipmentLines: [],
      materialLines: [],
      equipmentLines: [],
    };

    expect(hasMeaningfulVariantDraft(emptyDraft)).toBe(false);
    expect(getVariantAdditionalLineCount(emptyDraft)).toBe(0);

    const configuredDraft: VariantDraft = {
      ...emptyDraft,
      laborMinutes: "12",
      materialLines: [
        {
          id: "extra-material",
          materialId: "mat-2",
          materialName: "Tape",
          materialType: "shipping",
          costingModel: "uses",
          perUnitCost: "1.00",
          quantity: "1",
          yield: null,
          usesPerVariant: "2",
          lineCost: "0.20",
        },
      ],
    };

    expect(hasMeaningfulVariantDraft(configuredDraft)).toBe(true);
    expect(getVariantAdditionalLineCount(configuredDraft)).toBe(1);
    expect(normalizeVariantDraft(configuredDraft)).toMatchObject({
      laborMinutes: "12",
      materialLines: [{ materialId: "mat-2", quantity: "1", yield: "", usesPerVariant: "2" }],
    });
  });

  it("rebuilds shipping template lines and tracks shipping overrides as meaningful state", () => {
    const emptyDraft: VariantDraft = {
      productionTemplateId: null,
      shippingTemplateId: null,
      preferredPackageId: null,
      templateProductYield: "",
      packedLength: "",
      packedWidth: "",
      packedHeight: "",
      packedWeightGrams: "",
      canSharePackage: true,
      laborMinutes: "",
      laborRate: "",
      mistakeBuffer: "",
      templateMaterialLines: [],
      shippingTemplateMaterialLines: [],
      templateEquipmentLines: [],
      materialLines: [],
      equipmentLines: [],
    };

    const selected = applyShippingTemplateSelectionToVariantDraft(emptyDraft, catalogEntry);
    expect(selected.shippingTemplateMaterialLines).toHaveLength(1);
    expect(hasMeaningfulVariantDraft({
      ...selected,
      shippingTemplateId: null,
      shippingTemplateMaterialLines: selected.shippingTemplateMaterialLines.map((line) => ({
        ...line,
        hasOverride: true,
      })),
    })).toBe(true);
  });
});
