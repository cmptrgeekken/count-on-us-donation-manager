import { describe, expect, it } from "vitest";

import { findWidgetVariant, scaleWidgetVariantForQuantity } from "./widget-display";

describe("scaleWidgetVariantForQuantity", () => {
  it("scales quantity-sensitive rows while leaving shipping lines fixed", () => {
    const result = scaleWidgetVariantForQuantity(
      {
        variantId: "gid://shopify/ProductVariant/1",
        price: "20.00",
        currencyCode: "USD",
        laborCost: "3.00",
        materialLines: [{ name: "Sticker Paper", type: "production", lineCost: "0.18" }],
        equipmentLines: [{ name: "Printer", lineCost: "0.03" }],
        shippingMaterialLines: [{ name: "Mailer", lineCost: "0.15" }],
        podCostTotal: "0.00",
        mistakeBufferAmount: "0.01",
        causes: [
          {
            causeId: "cause-1",
            name: "Neighborhood Arts",
            iconUrl: null,
            donationPercentage: "100.00",
            estimatedDonationAmount: "12.35",
            donationCurrencyCode: "USD",
            donationLink: null,
          },
        ],
        taxReserve: {
          suppressed: false,
          estimatedRate: "25.00",
          estimatedAmount: "4.15",
        },
      },
      3,
    );

    expect(result.laborCost).toBe("9.00");
    expect(result.materialLines[0].lineCost).toBe("0.54");
    expect(result.equipmentLines[0].lineCost).toBe("0.09");
    expect(result.shippingMaterialLines[0].lineCost).toBe("0.15");
    expect(result.causes[0].estimatedDonationAmount).toBe("37.05");
    expect(result.taxReserve.estimatedAmount).toBe("12.45");
  });
});

describe("findWidgetVariant", () => {
  it("returns the selected variant when present and falls back to the first variant otherwise", () => {
    const variants = [
      { variantId: "gid://shopify/ProductVariant/1", label: "Red" },
      { variantId: "gid://shopify/ProductVariant/2", label: "Blue" },
    ];

    expect(findWidgetVariant(variants, "gid://shopify/ProductVariant/2")).toEqual(variants[1]);
    expect(findWidgetVariant(variants, "gid://shopify/ProductVariant/999")).toEqual(variants[0]);
    expect(findWidgetVariant(variants, null)).toEqual(variants[0]);
  });
});
