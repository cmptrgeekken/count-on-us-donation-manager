import { describe, expect, it } from "vitest";

import { resolveEffectiveTemplateSelection } from "./effective-template-selection";

describe("resolveEffectiveTemplateSelection", () => {
  it("inherits the default shipping template from the production template", () => {
    const result = resolveEffectiveTemplateSelection(
      { productionTemplateId: "template-production" },
      [
        {
          id: "template-production",
          type: "production",
          defaultShippingTemplateId: "template-shipping-default",
        },
        { id: "template-shipping-default", type: "shipping" },
      ],
    );

    expect(result).toEqual({
      productionTemplateId: "template-production",
      shippingTemplateId: "template-shipping-default",
      shippingSource: "production-default",
    });
  });

  it("prefers an explicit shipping template over the production default", () => {
    const result = resolveEffectiveTemplateSelection(
      {
        productionTemplateId: "template-production",
        shippingTemplateId: "template-shipping-override",
      },
      [
        {
          id: "template-production",
          type: "production",
          defaultShippingTemplateId: "template-shipping-default",
        },
        { id: "template-shipping-default", type: "shipping" },
        { id: "template-shipping-override", type: "shipping" },
      ],
    );

    expect(result).toEqual({
      productionTemplateId: "template-production",
      shippingTemplateId: "template-shipping-override",
      shippingSource: "explicit",
    });
  });

  it("returns no shipping template when neither explicit nor inherited shipping exists", () => {
    const result = resolveEffectiveTemplateSelection(
      { productionTemplateId: "template-production" },
      [{ id: "template-production", type: "production" }],
    );

    expect(result).toEqual({
      productionTemplateId: "template-production",
      shippingTemplateId: null,
      shippingSource: "none",
    });
  });
});
