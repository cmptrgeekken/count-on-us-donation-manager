import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveCosts } = vi.hoisted(() => ({
  resolveCosts: vi.fn(),
}));

vi.mock("./costEngine.server", () => ({
  resolveCosts,
}));

import { buildVariantEstimatePayload } from "./variantEstimate.server";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("buildVariantEstimatePayload", () => {
  beforeEach(() => {
    resolveCosts.mockReset();
  });

  it("calculates shared cost, reserve, and cause donation estimates", async () => {
    resolveCosts.mockResolvedValue({
      laborCost: decimal("3.00"),
      materialCost: decimal("2.00"),
      packagingCost: decimal("0.75"),
      equipmentCost: decimal("1.00"),
      mistakeBufferAmount: decimal("0.25"),
      podCost: decimal("0.00"),
      podCostEstimated: false,
      podCostMissing: false,
      totalCost: decimal("7.00"),
      materialLines: [
        {
          materialId: "mat-1",
          name: "Vinyl",
          type: "production",
          costingModel: "yield",
          quantity: decimal("1"),
          yield: decimal("10"),
          usesPerVariant: null,
          lineCost: decimal("2.00"),
          unitDescription: "sheet",
          purchasePrice: decimal("20"),
          purchaseQty: decimal("1"),
          totalUsesPerUnit: null,
        },
      ],
      equipmentLines: [],
    });

    const result = await buildVariantEstimatePayload({
      shopId: "shop-1",
      variant: {
        id: "variant-1",
        shopifyId: "gid://shopify/ProductVariant/1",
        price: decimal("20.00"),
      },
      causeAssignments: [
        {
          causeId: "cause-1",
          percentage: decimal("60"),
          cause: {
            id: "cause-1",
            name: "Rent Relief",
            is501c3: false,
            iconUrl: null,
            donationLink: null,
          },
        },
        {
          causeId: "cause-2",
          percentage: decimal("40"),
          cause: {
            id: "cause-2",
            name: "Mutual Aid",
            is501c3: true,
            iconUrl: null,
            donationLink: null,
          },
        },
      ],
      shop: {
        currency: "USD",
        paymentRate: decimal("0.029"),
        effectiveTaxRate: decimal("0.25"),
        taxDeductionMode: "non_501c3_only",
      },
      widgetTaxSuppressed: false,
      db: {} as never,
    });

    expect(result.reconciliation).toMatchObject({
      estimatedTotal: "20.00",
      labor: "3.00",
      materials: "2.00",
      equipment: "1.00",
      packaging: "0.75",
      mistakeBuffer: "0.25",
      shopifyFees: "0.88",
      taxReserve: "1.82",
      artistPayout: "0.00",
      allocatedDonations: "10.30",
    });
    expect(result.causes).toEqual([
      expect.objectContaining({
        causeId: "cause-1",
        estimatedDonationAmount: "6.18",
      }),
      expect.objectContaining({
        causeId: "cause-2",
        estimatedDonationAmount: "4.12",
      }),
    ]);
    expect(result.materialLines[0]).toMatchObject({
      name: "Vinyl",
      lineCost: "2.00",
      rateDetail: "10 items per purchased unit @ $20.00/purchase unit",
    });
  });

  it("suppresses tax reserve without changing pre-tax contribution math", async () => {
    resolveCosts.mockResolvedValue({
      laborCost: decimal("2.00"),
      materialCost: decimal("1.00"),
      packagingCost: decimal("0.00"),
      equipmentCost: decimal("0.00"),
      mistakeBufferAmount: decimal("0.00"),
      podCost: decimal("0.00"),
      podCostEstimated: false,
      podCostMissing: false,
      totalCost: decimal("3.00"),
      materialLines: [],
      equipmentLines: [],
    });

    const result = await buildVariantEstimatePayload({
      shopId: "shop-1",
      variant: {
        id: "variant-1",
        shopifyId: "gid://shopify/ProductVariant/1",
        price: decimal("20.00"),
      },
      causeAssignments: [
        {
          causeId: "cause-1",
          percentage: decimal("100"),
          cause: {
            id: "cause-1",
            name: "Neighborhood Arts",
            is501c3: false,
            iconUrl: null,
            donationLink: null,
          },
        },
      ],
      shop: {
        currency: "USD",
        paymentRate: decimal("0.029"),
        effectiveTaxRate: decimal("0.25"),
        taxDeductionMode: "all_causes",
      },
      widgetTaxSuppressed: true,
      db: {} as never,
    });

    expect(result.taxReserve).toMatchObject({
      suppressed: true,
      estimatedAmount: "0.00",
    });
    expect(result.reconciliation.allocatedDonations).toBe("16.12");
  });

  it("subtracts artist payouts and routes remaining donations through artist causes", async () => {
    resolveCosts.mockResolvedValue({
      laborCost: decimal("2.00"),
      materialCost: decimal("1.00"),
      packagingCost: decimal("0.00"),
      equipmentCost: decimal("0.00"),
      mistakeBufferAmount: decimal("0.00"),
      podCost: decimal("0.00"),
      podCostEstimated: false,
      podCostMissing: false,
      totalCost: decimal("3.00"),
      materialLines: [],
      equipmentLines: [],
    });

    const result = await buildVariantEstimatePayload({
      shopId: "shop-1",
      variant: {
        id: "variant-1",
        shopifyId: "gid://shopify/ProductVariant/1",
        price: decimal("20.00"),
      },
      causeAssignments: [],
      artistAssignments: [
        {
          collaborationShare: decimal("100"),
          payoutEnabledOverride: null,
          payoutRateOverride: decimal("10"),
          artist: {
            paymentEnabled: true,
            defaultPayoutRate: decimal("15"),
            causeAssignments: [
              {
                causeId: "cause-artist",
                percentage: decimal("100"),
                cause: {
                  id: "cause-artist",
                  name: "Artist Cause",
                  is501c3: false,
                  iconUrl: null,
                  donationLink: null,
                },
              },
            ],
          },
        },
      ],
      shop: {
        currency: "USD",
        paymentRate: decimal("0.029"),
        effectiveTaxRate: decimal("0.25"),
        taxDeductionMode: "all_causes",
      },
      widgetTaxSuppressed: true,
      db: {} as never,
    });

    expect(result.reconciliation).toMatchObject({
      estimatedTotal: "20.00",
      artistPayout: "2.00",
      allocatedDonations: "14.12",
      retainedByShop: "0.00",
    });
    expect(result.causes).toEqual([
      expect.objectContaining({
        causeId: "cause-artist",
        donationPercentage: "100.00",
        estimatedDonationAmount: "14.12",
      }),
    ]);
  });

  it("keeps Artist payouts but uses product Causes when an override is active", async () => {
    resolveCosts.mockResolvedValue({
      laborCost: decimal("2.00"),
      materialCost: decimal("1.00"),
      packagingCost: decimal("0.00"),
      equipmentCost: decimal("0.00"),
      mistakeBufferAmount: decimal("0.00"),
      podCost: decimal("0.00"),
      podCostEstimated: false,
      podCostMissing: false,
      totalCost: decimal("3.00"),
      materialLines: [],
      equipmentLines: [],
    });

    const result = await buildVariantEstimatePayload({
      shopId: "shop-1",
      variant: { id: "variant-1", shopifyId: "gid://shopify/ProductVariant/1", price: decimal("20.00") },
      donationRoutingMode: "product_override",
      causeAssignments: [{
        causeId: "override-cause",
        percentage: decimal("25"),
        cause: {
          id: "override-cause",
          name: "Override Cause",
          is501c3: true,
          iconUrl: null,
          donationLink: null,
        },
      }],
      artistAssignments: [{
        collaborationShare: decimal("100"),
        payoutEnabledOverride: null,
        payoutRateOverride: decimal("10"),
        artist: {
          paymentEnabled: true,
          defaultPayoutRate: decimal("15"),
          causeAssignments: [{
            causeId: "artist-cause",
            percentage: decimal("100"),
            cause: {
              id: "artist-cause",
              name: "Artist Cause",
              is501c3: false,
              iconUrl: null,
              donationLink: null,
            },
          }],
        },
      }],
      shop: {
        currency: "USD",
        paymentRate: decimal("0.029"),
        effectiveTaxRate: decimal("0.25"),
        taxDeductionMode: "all_causes",
      },
      widgetTaxSuppressed: true,
      db: {} as never,
    });

    expect(result.reconciliation.artistPayout).toBe("2.00");
    expect(result.causes).toEqual([
      expect.objectContaining({
        causeId: "override-cause",
        donationPercentage: "25.00",
        estimatedDonationAmount: "3.53",
      }),
    ]);
    expect(result.causes.some((cause) => cause.causeId === "artist-cause")).toBe(false);
  });
});
