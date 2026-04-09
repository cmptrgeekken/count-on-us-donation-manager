import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatePublicAppProxyRequest, buildDonationReceiptsPage } = vi.hoisted(() => ({
  authenticatePublicAppProxyRequest: vi.fn(),
  buildDonationReceiptsPage: vi.fn(),
}));

vi.mock("../utils/public-auth.server", () => ({
  authenticatePublicAppProxyRequest,
}));

vi.mock("../services/donationReceiptsPage.server", () => ({
  buildDonationReceiptsPage,
}));

import { loader } from "./apps.count-on-us.donation-receipts";
import { resetRateLimitBuckets } from "../utils/rate-limit.server";

describe("apps.count-on-us.donation-receipts loader", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    authenticatePublicAppProxyRequest.mockResolvedValue({
      shopifyDomain: "fixture-shop.myshopify.com",
    });
    buildDonationReceiptsPage.mockResolvedValue({
      hasReceipts: false,
      periods: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns donation receipt page data for valid app proxy requests", async () => {
    const response = await loader({
      request: new Request("https://example.com/apps/count-on-us/donation-receipts?shop=fixture-shop.myshopify.com", {
        headers: {
          "x-forwarded-for": "203.0.113.10",
        },
      }),
      params: {},
      context: {},
    });

    expect(authenticatePublicAppProxyRequest).toHaveBeenCalled();
    expect(buildDonationReceiptsPage).toHaveBeenCalledWith("fixture-shop.myshopify.com");
    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("30");
  });

  it("applies IP-based rate limiting", async () => {
    const request = new Request("https://example.com/apps/count-on-us/donation-receipts?shop=fixture-shop.myshopify.com", {
      headers: {
        "x-forwarded-for": "203.0.113.11",
      },
    });

    for (let index = 0; index < 30; index += 1) {
      const response = await loader({
        request,
        params: {},
        context: {},
      });
      expect(response.status).toBe(200);
    }

    await expect(
      loader({
        request,
        params: {},
        context: {},
      }),
    ).rejects.toMatchObject({
      status: 429,
    });
  });

  it("propagates app proxy auth failures", async () => {
    authenticatePublicAppProxyRequest.mockRejectedValue(new Response("Forbidden", { status: 403 }));

    await expect(
      loader({
        request: new Request("https://example.com/apps/count-on-us/donation-receipts"),
        params: {},
        context: {},
      }),
    ).rejects.toMatchObject({
      status: 403,
    });
  });
});
