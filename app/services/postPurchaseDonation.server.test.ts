import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  buildConfirmedOrderDonationSummary,
  buildPendingOrderDonationSummary,
  fetchOrderForPostPurchaseEstimate,
} from "./postPurchaseDonation.server";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("buildConfirmedOrderDonationSummary", () => {
  it("aggregates confirmed snapshot allocations by cause", async () => {
    const db = {
      shop: {
        findUnique: vi.fn().mockResolvedValue({ currency: "USD" }),
      },
      orderSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          lines: [
            {
              causeAllocations: [
                {
                  causeId: "cause-1",
                  causeName: "Neighborhood Arts",
                  amount: decimal("10.25"),
                  cause: { iconUrl: "https://example.com/icon-a.png", donationLink: "https://example.com/a" },
                },
                {
                  causeId: "cause-2",
                  causeName: "Community Library",
                  amount: decimal("4.75"),
                  cause: { iconUrl: null, donationLink: null },
                },
              ],
            },
            {
              causeAllocations: [
                {
                  causeId: "cause-1",
                  causeName: "Neighborhood Arts",
                  amount: decimal("3.00"),
                  cause: { iconUrl: "https://example.com/icon-a.png", donationLink: "https://example.com/a" },
                },
              ],
            },
          ],
        }),
      },
    };

    const result = await buildConfirmedOrderDonationSummary(
      "gid://shopify/Order/1",
      "fixture.myshopify.com",
      db as never,
    );

    expect(result).toEqual({
      orderId: "gid://shopify/Order/1",
      status: "confirmed",
      totalDonated: "18.00",
      currencyCode: "USD",
      causes: [
        {
          causeId: "cause-1",
          name: "Neighborhood Arts",
          iconUrl: "https://example.com/icon-a.png",
          donationLink: "https://example.com/a",
          amount: "13.25",
        },
        {
          causeId: "cause-2",
          name: "Community Library",
          iconUrl: null,
          donationLink: null,
          amount: "4.75",
        },
      ],
    });
  });
});

describe("fetchOrderForPostPurchaseEstimate", () => {
  it("maps Shopify Admin order data into an estimate-ready payload", async () => {
    const admin = {
      graphql: vi.fn().mockResolvedValue(
        Response.json({
          data: {
            order: {
              id: "gid://shopify/Order/1",
              name: "#1001",
              lineItems: {
                nodes: [
                  {
                    id: "gid://shopify/LineItem/1",
                    quantity: 2,
                    title: "Fixture Product",
                    variantTitle: "Blue",
                    discountedTotalSet: {
                      shopMoney: {
                        amount: "30.00",
                        currencyCode: "USD",
                      },
                    },
                    variant: { id: "gid://shopify/ProductVariant/1" },
                    product: { id: "gid://shopify/Product/1" },
                  },
                ],
              },
            },
          },
        }),
      ),
    };

    const result = await fetchOrderForPostPurchaseEstimate("gid://shopify/Order/1", admin as never);

    expect(result).toEqual({
      id: "gid://shopify/Order/1",
      name: "#1001",
      lineItems: [
        {
          id: "gid://shopify/LineItem/1",
          quantity: 2,
          title: "Fixture Product",
          variantTitle: "Blue",
          discountedTotal: decimal("30.00"),
          currencyCode: "USD",
          variantId: "gid://shopify/ProductVariant/1",
          productId: "gid://shopify/Product/1",
        },
      ],
    });
  });
});

describe("buildPendingOrderDonationSummary", () => {
  it("builds estimated donation totals from live order data when no snapshot exists yet", async () => {
    const db = {
      shop: {
        findUnique: vi.fn().mockResolvedValue({ currency: "USD" }),
      },
      variant: {
        findFirst: vi.fn().mockResolvedValue({ id: "variant-db-1" }),
      },
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: "product-db-1" }),
      },
      productCauseAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            causeId: "cause-1",
            percentage: decimal("60.00"),
            cause: {
              name: "Neighborhood Arts",
              iconUrl: null,
              donationLink: "https://example.com/a",
            },
          },
          {
            causeId: "cause-2",
            percentage: decimal("40.00"),
            cause: {
              name: "Community Library",
              iconUrl: null,
              donationLink: null,
            },
          },
        ]),
      },
    };

    const order = {
      id: "gid://shopify/Order/1",
      name: "#1001",
      lineItems: [
        {
          id: "gid://shopify/LineItem/1",
          quantity: 2,
          title: "Fixture Product",
          variantTitle: "Blue",
          discountedTotal: decimal("30.00"),
          currencyCode: "USD",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
        },
      ],
    };

    const spy = vi
      .spyOn(await import("./costEngine.server"), "resolveCosts")
      .mockResolvedValue({
        laborCost: decimal("1.00"),
        materialCost: decimal("2.00"),
        packagingCost: decimal("1.00"),
        equipmentCost: decimal("1.00"),
        mistakeBufferAmount: decimal("0.00"),
        podCost: decimal("0.00"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("5.00"),
        materialLines: [],
        equipmentLines: [],
        netContribution: decimal("10.00"),
      });

    const result = await buildPendingOrderDonationSummary(order, "fixture.myshopify.com", db as never);

    expect(result).toEqual({
      orderId: "gid://shopify/Order/1",
      status: "pending",
      estimated: {
        totalDonated: "20.00",
        currencyCode: "USD",
        causes: [
          {
            causeId: "cause-1",
            name: "Neighborhood Arts",
            iconUrl: null,
            donationLink: "https://example.com/a",
            amount: "12.00",
          },
          {
            causeId: "cause-2",
            name: "Community Library",
            iconUrl: null,
            donationLink: null,
            amount: "8.00",
          },
        ],
      },
    });

    spy.mockRestore();
  });

  it("clamps negative pending net contributions to zero cause allocations", async () => {
    const db = {
      shop: {
        findUnique: vi.fn().mockResolvedValue({ currency: "USD" }),
      },
      variant: {
        findFirst: vi.fn().mockResolvedValue({ id: "variant-db-1" }),
      },
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: "product-db-1" }),
      },
      productCauseAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            causeId: "cause-1",
            percentage: decimal("100.00"),
            cause: {
              name: "Neighborhood Arts",
              iconUrl: null,
              donationLink: null,
            },
          },
        ]),
      },
    };

    const order = {
      id: "gid://shopify/Order/1",
      name: "#1001",
      lineItems: [
        {
          id: "gid://shopify/LineItem/1",
          quantity: 1,
          title: "Discounted Product",
          variantTitle: "Pin",
          discountedTotal: decimal("1.00"),
          currencyCode: "USD",
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
        },
      ],
    };

    const spy = vi
      .spyOn(await import("./costEngine.server"), "resolveCosts")
      .mockResolvedValue({
        laborCost: decimal("2.00"),
        materialCost: decimal("2.00"),
        packagingCost: decimal("1.00"),
        equipmentCost: decimal("0.00"),
        mistakeBufferAmount: decimal("0.00"),
        podCost: decimal("0.00"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("5.00"),
        materialLines: [],
        equipmentLines: [],
        netContribution: decimal("-4.00"),
      });

    const result = await buildPendingOrderDonationSummary(order, "fixture.myshopify.com", db as never);

    expect(result?.estimated.causes).toEqual([
      expect.objectContaining({
        causeId: "cause-1",
        amount: "0.00",
      }),
    ]);
    expect(result?.estimated.totalDonated).toBe("0.00");

    spy.mockRestore();
  });
});
