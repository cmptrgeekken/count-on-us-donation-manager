import { describe, expect, it } from "vitest";

import { aggregateCartCauseTotals } from "./cart-summary";

describe("aggregateCartCauseTotals", () => {
  it("aggregates per-cause donation totals across cart lines", () => {
    const result = aggregateCartCauseTotals(
      [
        {
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 2,
        },
        {
          productId: "gid://shopify/Product/2",
          variantId: "gid://shopify/ProductVariant/2",
          quantity: 1,
        },
      ],
      [
        {
          productId: "gid://shopify/Product/1",
          visible: true,
          variants: [
            {
              variantId: "gid://shopify/ProductVariant/1",
              price: "20.00",
              currencyCode: "USD",
              laborCost: "3.00",
              materialLines: [],
              equipmentLines: [],
              shippingMaterialLines: [],
              podCostTotal: "0.00",
              mistakeBufferAmount: "0.00",
              shopifyFees: {
                processingRate: "2.90",
                processingFlatFee: "0.30",
                managedMarketsRate: "0.00",
                managedMarketsApplicable: false,
              },
              causes: [
                {
                  causeId: "cause-1",
                  name: "Neighborhood Arts",
                  iconUrl: null,
                  donationPercentage: "100.00",
                  estimatedDonationAmount: "5.00",
                  donationCurrencyCode: "USD",
                  donationLink: null,
                },
              ],
              taxReserve: {
                suppressed: false,
                estimatedRate: "25.00",
                estimatedAmount: "1.00",
              },
            },
          ],
        },
        {
          productId: "gid://shopify/Product/2",
          visible: true,
          variants: [
            {
              variantId: "gid://shopify/ProductVariant/2",
              price: "15.00",
              currencyCode: "USD",
              laborCost: "2.00",
              materialLines: [],
              equipmentLines: [],
              shippingMaterialLines: [],
              podCostTotal: "0.00",
              mistakeBufferAmount: "0.00",
              shopifyFees: {
                processingRate: "2.90",
                processingFlatFee: "0.30",
                managedMarketsRate: "0.00",
                managedMarketsApplicable: false,
              },
              causes: [
                {
                  causeId: "cause-1",
                  name: "Neighborhood Arts",
                  iconUrl: null,
                  donationPercentage: "50.00",
                  estimatedDonationAmount: "3.00",
                  donationCurrencyCode: "USD",
                  donationLink: null,
                },
                {
                  causeId: "cause-2",
                  name: "Community Library",
                  iconUrl: null,
                  donationPercentage: "50.00",
                  estimatedDonationAmount: "3.00",
                  donationCurrencyCode: "USD",
                  donationLink: null,
                },
              ],
              taxReserve: {
                suppressed: false,
                estimatedRate: "25.00",
                estimatedAmount: "1.00",
              },
            },
          ],
        },
      ],
    );

    expect(result).toEqual({
      hasDonationProducts: true,
      totals: [
        {
          causeId: "cause-1",
          name: "Neighborhood Arts",
          iconUrl: null,
          donationLink: null,
          donationCurrencyCode: "USD",
          amount: "13.00",
        },
        {
          causeId: "cause-2",
          name: "Community Library",
          iconUrl: null,
          donationLink: null,
          donationCurrencyCode: "USD",
          amount: "3.00",
        },
      ],
    });
  });

  it("handles carts with no visible donation products", () => {
    const result = aggregateCartCauseTotals(
      [
        {
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 1,
        },
      ],
      [
        {
          productId: "gid://shopify/Product/1",
          visible: false,
          variants: [],
        },
      ],
    );

    expect(result).toEqual({
      hasDonationProducts: false,
      totals: [],
    });
  });
});
