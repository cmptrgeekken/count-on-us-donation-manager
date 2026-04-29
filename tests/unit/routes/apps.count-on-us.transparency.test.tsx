import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatePublicAppProxyRequest, buildPublicTransparencyPage } = vi.hoisted(() => ({
  authenticatePublicAppProxyRequest: vi.fn(),
  buildPublicTransparencyPage: vi.fn(),
}));

vi.mock("../../../app/utils/public-auth.server", () => ({
  authenticatePublicAppProxyRequest,
}));

vi.mock("../../../app/services/publicTransparency.server", () => ({
  buildPublicTransparencyPage,
}));

import { loader } from "../../../app/routes/apps.count-on-us.transparency";
import { resetRateLimitBuckets } from "../../../app/utils/rate-limit.server";

describe("apps.count-on-us.transparency loader", () => {
  beforeEach(() => {
    resetRateLimitBuckets();
    authenticatePublicAppProxyRequest.mockResolvedValue({
      shopifyDomain: "fixture-shop.myshopify.com",
    });
    buildPublicTransparencyPage.mockResolvedValue({
      hasPublicActivity: false,
      metadata: { hiddenSections: [] },
      totals: { donationsMade: "0.00", donationsPendingDisbursement: "0.00" },
      causeSummaries: [],
      receipts: [],
      receiptCauseSummaries: [],
      reconciliation: null,
      periods: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns public transparency data for valid app proxy requests", async () => {
    const response = await loader({
      request: new Request(
        "https://example.com/apps/count-on-us/transparency?shop=fixture-shop.myshopify.com&tier=standard&showReceiptHistory=false",
        {
          headers: {
            "x-forwarded-for": "203.0.113.20",
          },
        },
      ),
      params: {},
      context: {},
    });

    expect(authenticatePublicAppProxyRequest).toHaveBeenCalled();
    expect(buildPublicTransparencyPage).toHaveBeenCalledWith("fixture-shop.myshopify.com", {
      presentation: {
        requestedDisclosureTier: "standard",
        showOverviewTotals: true,
        showReceiptHistory: false,
        showCauseSummaries: true,
        showReconciliation: true,
        rollup: "all",
        month: undefined,
        year: undefined,
        periodId: undefined,
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("30");
  });

  it("falls back to minimal disclosure for unknown tier values", async () => {
    await loader({
      request: new Request("https://example.com/apps/count-on-us/transparency?tier=internal-admin"),
      params: {},
      context: {},
    });

    expect(buildPublicTransparencyPage).toHaveBeenCalledWith("fixture-shop.myshopify.com", {
      presentation: {
        requestedDisclosureTier: "minimal",
        showOverviewTotals: true,
        showReceiptHistory: true,
        showCauseSummaries: true,
        showReconciliation: true,
        rollup: "all",
        month: undefined,
        year: undefined,
        periodId: undefined,
      },
    });
  });

  it("passes rollup options through to the public contract", async () => {
    await loader({
      request: new Request("https://example.com/apps/count-on-us/transparency?rollup=month&month=2026-04&showReconciliation=false"),
      params: {},
      context: {},
    });

    expect(buildPublicTransparencyPage).toHaveBeenCalledWith("fixture-shop.myshopify.com", {
      presentation: {
        requestedDisclosureTier: "minimal",
        showOverviewTotals: true,
        showReceiptHistory: true,
        showCauseSummaries: true,
        showReconciliation: false,
        rollup: "month",
        month: "2026-04",
        year: undefined,
        periodId: undefined,
      },
    });
  });

  it("applies IP-based rate limiting", async () => {
    const request = new Request("https://example.com/apps/count-on-us/transparency?shop=fixture-shop.myshopify.com", {
      headers: {
        "x-forwarded-for": "203.0.113.21",
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
});
