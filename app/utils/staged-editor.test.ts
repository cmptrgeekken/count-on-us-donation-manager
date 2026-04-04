import { describe, expect, it } from "vitest";
import {
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
    },
  ],
  equipmentLines: [
    {
      templateLineId: "eq-line-1",
      equipmentId: "eq-1",
      equipmentName: "Press",
      minutes: "12",
      uses: null,
    },
  ],
};

describe("staged editor helpers", () => {
  it("normalizes template drafts for stable dirty-state comparisons", () => {
    const draft: TemplateDraft = {
      name: " Example ",
      description: " Test ",
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
      templateId: "old-template",
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
        },
      ],
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
      templateId: "template-1",
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
          hasOverride: false,
          overrideQuantity: null,
          overrideYield: null,
          overrideUsesPerVariant: null,
        },
      ],
      templateEquipmentLines: [
        {
          templateLineId: "eq-line-1",
          equipmentId: "eq-1",
          equipmentName: "Press",
          minutes: "12",
          uses: null,
          hasOverride: false,
          overrideMinutes: null,
          overrideUses: null,
        },
      ],
    });
  });

  it("detects meaningful variant state and derives additional line counts", () => {
    const emptyDraft: VariantDraft = {
      templateId: null,
      laborMinutes: "",
      laborRate: "",
      mistakeBuffer: "",
      templateMaterialLines: [],
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
});
