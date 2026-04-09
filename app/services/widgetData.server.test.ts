import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveCosts } = vi.hoisted(() => ({
  resolveCosts: vi.fn(),
}));

vi.mock("./costEngine.server", () => ({
  resolveCosts,
}));

import { buildWidgetProductPayload } from "./widgetData.server";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("buildWidgetProductPayload", () => {
  beforeEach(() => {
    resolveCosts.mockReset();
  });

  it("returns preload payloads with display-safe variant data for low-line products", async () => {
    resolveCosts.mockResolvedValue({
      laborCost: decimal("3"),
      materialCost: decimal("0.18"),
      packagingCost: decimal("0.15"),
      equipmentCost: decimal("0.03"),
      mistakeBufferAmount: decimal("0.01"),
      podCost: decimal("0"),
      totalCost: decimal("3.37"),
      materialLines: [
        {
          materialId: "mat-prod",
          name: "Sticker Paper",
          type: "production",
          costingModel: "yield",
          quantity: decimal("1"),
          yield: decimal("20"),
          usesPerVariant: null,
          lineCost: decimal("0.18"),
        },
        {
          materialId: "mat-ship",
          name: "Mailer",
          type: "shipping",
          costingModel: null,
          quantity: decimal("1"),
          yield: null,
          usesPerVariant: null,
          lineCost: decimal("0.15"),
        },
      ],
      equipmentLines: [
        {
          equipmentId: "eq-1",
          name: "Printer",
          minutes: decimal("2"),
          uses: null,
          lineCost: decimal("0.03"),
        },
      ],
    });

    const db = {
      product: {
        findFirst: vi.fn().mockResolvedValue({
          id: "prod-1",
          shopifyId: "gid://shopify/Product/1",
          variants: [
            {
              id: "var-1",
              shopifyId: "gid://shopify/ProductVariant/1",
              price: decimal("20.00"),
              costConfig: { lineItemCount: 12 },
            },
          ],
        }),
      },
      productCauseAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            causeId: "cause-1",
            percentage: decimal("60"),
            cause: {
              id: "cause-1",
              name: "Neighborhood Arts",
              is501c3: false,
              iconUrl: "https://example.com/icon.png",
              donationLink: "https://example.com/donate",
            },
          },
          {
            causeId: "cause-2",
            percentage: decimal("40"),
            cause: {
              id: "cause-2",
              name: "Community Library",
              is501c3: true,
              iconUrl: null,
              donationLink: null,
            },
          },
        ]),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          currency: "USD",
          paymentRate: decimal("0.029"),
          effectiveTaxRate: decimal("0.25"),
          taxDeductionMode: "non_501c3_only",
        }),
      },
      taxOffsetCache: {
        findUnique: vi.fn().mockResolvedValue({
          widgetTaxSuppressed: false,
        }),
      },
    };

    const result = await buildWidgetProductPayload(
      "shop-1",
      "gid://shopify/Product/1",
      db as never,
    );

    expect(result).toMatchObject({
      productId: "gid://shopify/Product/1",
      deliveryMode: "preload",
      visible: true,
      totalLineItemCount: 12,
      variants: [
        {
          variantId: "gid://shopify/ProductVariant/1",
          price: "20.00",
          currencyCode: "USD",
          laborCost: "3.00",
          podCostTotal: "0.00",
          mistakeBufferAmount: "0.01",
          shopifyFees: {
            processingRate: "2.90",
            processingFlatFee: "0.30",
            managedMarketsRate: "0.00",
            managedMarketsApplicable: false,
          },
          taxReserve: {
            suppressed: false,
            estimatedRate: "25.00",
            estimatedAmount: "2.49",
          },
        },
      ],
    });

    expect(result?.variants[0].materialLines).toEqual([
      {
        name: "Sticker Paper",
        type: "production",
        lineCost: "0.18",
      },
    ]);
    expect(result?.variants[0].shippingMaterialLines).toEqual([
      {
        name: "Mailer",
        lineCost: "0.15",
      },
    ]);
    expect(result?.variants[0].equipmentLines).toEqual([
      {
        name: "Printer",
        lineCost: "0.03",
      },
    ]);

    expect(result?.variants[0].causes).toEqual([
      {
        causeId: "cause-1",
        name: "Neighborhood Arts",
        iconUrl: "https://example.com/icon.png",
        donationPercentage: "60.00",
        estimatedDonationAmount: "9.98",
        donationCurrencyCode: "USD",
        donationLink: "https://example.com/donate",
      },
      {
        causeId: "cause-2",
        name: "Community Library",
        iconUrl: null,
        donationPercentage: "40.00",
        estimatedDonationAmount: "6.65",
        donationCurrencyCode: "USD",
        donationLink: null,
      },
    ]);

    const payloadJson = JSON.stringify(result);
    expect(payloadJson).not.toContain("netContribution");
    expect(payloadJson).not.toContain("purchasePrice");
    expect(payloadJson).not.toContain("purchaseQty");
    expect(payloadJson).not.toContain("perUnitCost");
    expect(payloadJson).not.toContain("laborRate");
    expect(payloadJson).not.toContain("hourlyRate");
    expect(payloadJson).not.toContain("perUseCost");
  });

  it("returns lazy delivery mode for high-line products", async () => {
    resolveCosts.mockResolvedValue({
      laborCost: decimal("0"),
      materialCost: decimal("0"),
      packagingCost: decimal("0"),
      equipmentCost: decimal("0"),
      mistakeBufferAmount: decimal("0"),
      podCost: decimal("0"),
      totalCost: decimal("0"),
      materialLines: [],
      equipmentLines: [],
    });

    const db = {
      product: {
        findFirst: vi.fn().mockResolvedValue({
          id: "prod-1",
          shopifyId: "gid://shopify/Product/1",
          variants: [
            {
              id: "var-1",
              shopifyId: "gid://shopify/ProductVariant/1",
              price: decimal("20.00"),
              costConfig: { lineItemCount: 120 },
            },
            {
              id: "var-2",
              shopifyId: "gid://shopify/ProductVariant/2",
              price: decimal("20.00"),
              costConfig: { lineItemCount: 90 },
            },
          ],
        }),
      },
      productCauseAssignment: {
        findMany: vi.fn().mockResolvedValue([
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
        ]),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          currency: "USD",
          paymentRate: decimal("0.029"),
          effectiveTaxRate: decimal("0.25"),
          taxDeductionMode: "non_501c3_only",
        }),
      },
      taxOffsetCache: {
        findUnique: vi.fn().mockResolvedValue({
          widgetTaxSuppressed: false,
        }),
      },
    };

    const result = await buildWidgetProductPayload("shop-1", "gid://shopify/Product/1", db as never);

    expect(result?.deliveryMode).toBe("lazy");
    expect(result?.totalLineItemCount).toBe(210);
  });

  it("uses the tax suppression flag from TaxOffsetCache", async () => {
    resolveCosts.mockResolvedValue({
      laborCost: decimal("2"),
      materialCost: decimal("1"),
      packagingCost: decimal("0"),
      equipmentCost: decimal("0"),
      mistakeBufferAmount: decimal("0"),
      podCost: decimal("0"),
      totalCost: decimal("3"),
      materialLines: [],
      equipmentLines: [],
    });

    const db = {
      product: {
        findFirst: vi.fn().mockResolvedValue({
          id: "prod-1",
          shopifyId: "gid://shopify/Product/1",
          variants: [
            {
              id: "var-1",
              shopifyId: "gid://shopify/ProductVariant/1",
              price: decimal("20.00"),
              costConfig: { lineItemCount: 3 },
            },
          ],
        }),
      },
      productCauseAssignment: {
        findMany: vi.fn().mockResolvedValue([
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
        ]),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          currency: "USD",
          paymentRate: decimal("0.029"),
          effectiveTaxRate: decimal("0.25"),
          taxDeductionMode: "all_causes",
        }),
      },
      taxOffsetCache: {
        findUnique: vi.fn().mockResolvedValue({
          widgetTaxSuppressed: true,
        }),
      },
    };

    const result = await buildWidgetProductPayload("shop-1", "gid://shopify/Product/1", db as never);

    expect(result?.variants[0].taxReserve).toEqual({
      suppressed: true,
      estimatedRate: "25.00",
      estimatedAmount: "0.00",
    });
  });
});
