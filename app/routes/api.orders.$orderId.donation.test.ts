import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateCheckoutRequest,
  buildConfirmedOrderDonationSummary,
  fetchOrderForPostPurchaseEstimate,
  buildPendingOrderDonationSummary,
  unauthenticatedAdmin,
} = vi.hoisted(() => ({
  authenticateCheckoutRequest: vi.fn(),
  buildConfirmedOrderDonationSummary: vi.fn(),
  fetchOrderForPostPurchaseEstimate: vi.fn(),
  buildPendingOrderDonationSummary: vi.fn(),
  unauthenticatedAdmin: vi.fn(),
}));

vi.mock("../utils/checkout-auth.server", () => ({
  authenticateCheckoutRequest,
}));

vi.mock("../services/postPurchaseDonation.server", () => ({
  buildConfirmedOrderDonationSummary,
  fetchOrderForPostPurchaseEstimate,
  buildPendingOrderDonationSummary,
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: unauthenticatedAdmin,
  },
}));

import { loader } from "./api.orders.$orderId.donation";
import { resetRateLimitBuckets } from "../utils/rate-limit.server";

describe("api.orders.$orderId.donation loader", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    authenticateCheckoutRequest.mockResolvedValue({
      shopifyDomain: "fixture.myshopify.com",
      cors: (response: Response) => response,
    });
    unauthenticatedAdmin.mockResolvedValue({
      admin: {
        graphql: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns confirmed donation data when a snapshot exists", async () => {
    buildConfirmedOrderDonationSummary.mockResolvedValue({
      orderId: "gid://shopify/Order/1",
      status: "confirmed",
      totalDonated: "18.00",
      currencyCode: "USD",
      causes: [],
    });

    const response = await loader({
      request: new Request("https://example.com/api/orders/gid://shopify/Order/1/donation"),
      params: { orderId: "gid://shopify/Order/1" },
      context: {},
    });

    expect(response.status).toBe(200);
    expect(fetchOrderForPostPurchaseEstimate).not.toHaveBeenCalled();
  });

  it("returns pending estimated data when the snapshot is not ready yet", async () => {
    buildConfirmedOrderDonationSummary.mockResolvedValue(null);
    fetchOrderForPostPurchaseEstimate.mockResolvedValue({
      id: "gid://shopify/Order/1",
      name: "#1001",
      lineItems: [],
    });
    buildPendingOrderDonationSummary.mockResolvedValue({
      orderId: "gid://shopify/Order/1",
      status: "pending",
      estimated: {
        totalDonated: "12.00",
        currencyCode: "USD",
        causes: [],
      },
    });

    const response = await loader({
      request: new Request("https://example.com/api/orders/gid://shopify/Order/1/donation"),
      params: { orderId: "gid://shopify/Order/1" },
      context: {},
    });

    expect(response.status).toBe(202);
  });

  it("returns not found for orders without donation products", async () => {
    buildConfirmedOrderDonationSummary.mockResolvedValue(null);
    fetchOrderForPostPurchaseEstimate.mockResolvedValue({
      id: "gid://shopify/Order/1",
      name: "#1001",
      lineItems: [],
    });
    buildPendingOrderDonationSummary.mockResolvedValue(null);

    const response = await loader({
      request: new Request("https://example.com/api/orders/gid://shopify/Order/1/donation"),
      params: { orderId: "gid://shopify/Order/1" },
      context: {},
    });

    expect(response.status).toBe(404);
  });

  it("rate limits repeated polling for the same order", async () => {
    buildConfirmedOrderDonationSummary.mockResolvedValue({
      orderId: "gid://shopify/Order/1",
      status: "confirmed",
      totalDonated: "18.00",
      currencyCode: "USD",
      causes: [],
    });

    const request = new Request("https://example.com/api/orders/gid://shopify/Order/1/donation");

    for (let index = 0; index < 10; index += 1) {
      const response = await loader({
        request,
        params: { orderId: "gid://shopify/Order/1" },
        context: {},
      });
      expect(response.status).toBe(200);
    }

    const response = await loader({
      request,
      params: { orderId: "gid://shopify/Order/1" },
      context: {},
    });

    expect(response.status).toBe(429);
  });
});
