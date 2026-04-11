import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticatePublicAppProxyRequest } = vi.hoisted(() => ({
  authenticatePublicAppProxyRequest: vi.fn(),
}));
const { buildWidgetProductMetadata, buildWidgetProductPayload, WIDGET_RATE_LIMIT_PER_MINUTE } = vi.hoisted(() => ({
  buildWidgetProductMetadata: vi.fn(),
  buildWidgetProductPayload: vi.fn(),
  WIDGET_RATE_LIMIT_PER_MINUTE: 60,
}));
const { checkRateLimit } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
}));
const prisma = {
  $queryRaw: vi.fn(),
};

vi.mock("../../../app/utils/public-auth.server", () => ({
  authenticatePublicAppProxyRequest,
}));

vi.mock("../../../app/services/widgetData.server", () => ({
  buildWidgetProductMetadata,
  buildWidgetProductPayload,
  WIDGET_RATE_LIMIT_PER_MINUTE,
}));

vi.mock("../../../app/utils/rate-limit.server", () => ({
  checkRateLimit,
}));

vi.mock("../../../app/db.server", () => ({
  prisma,
}));

describe("api.widget.products.$productId loader", () => {
  beforeEach(() => {
    authenticatePublicAppProxyRequest.mockReset();
    buildWidgetProductMetadata.mockReset();
    buildWidgetProductPayload.mockReset();
    checkRateLimit.mockReset();
    prisma.$queryRaw.mockReset();
  });

  it("returns widget payloads for authenticated shops", async () => {
    authenticatePublicAppProxyRequest.mockResolvedValue({
      shopifyDomain: "fixture-shop.myshopify.com",
    });
    prisma.$queryRaw.mockResolvedValue([{ shopId: "shop-1" }]);
    checkRateLimit.mockReturnValue({
      allowed: true,
      headers: new Headers({
        "X-RateLimit-Limit": "60",
        "X-RateLimit-Remaining": "59",
      }),
    });
    buildWidgetProductPayload.mockResolvedValue({
      productId: "gid://shopify/Product/1",
      deliveryMode: "preload",
      visible: true,
      totalLineItemCount: 12,
      variants: [],
    });

    const { loader } = await import("../../../app/routes/api.widget.products.$productId");
    const response = await loader({
      request: new Request("http://localhost/api/widget/products/gid%3A%2F%2Fshopify%2FProduct%2F1"),
      params: { productId: "gid://shopify/Product/1" },
      context: {},
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        productId: "gid://shopify/Product/1",
        deliveryMode: "preload",
        visible: true,
        totalLineItemCount: 12,
        variants: [],
      },
    });
    expect(checkRateLimit).toHaveBeenCalledWith({
      key: "widget:shop-1",
      limit: 60,
      windowMs: 60_000,
    });
  });

  it("returns 429 when the shop exceeds the widget rate limit", async () => {
    authenticatePublicAppProxyRequest.mockResolvedValue({
      shopifyDomain: "fixture-shop.myshopify.com",
    });
    prisma.$queryRaw.mockResolvedValue([{ shopId: "shop-1" }]);
    checkRateLimit.mockReturnValue({
      allowed: false,
      headers: new Headers({
        "X-RateLimit-Limit": "60",
        "X-RateLimit-Remaining": "0",
        "Retry-After": "60",
      }),
    });

    const { loader } = await import("../../../app/routes/api.widget.products.$productId");
    const response = await loader({
      request: new Request("http://localhost/api/widget/products/gid%3A%2F%2Fshopify%2FProduct%2F1"),
      params: { productId: "gid://shopify/Product/1" },
      context: {},
    } as never);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many widget requests for this shop. Please try again shortly.",
      },
    });
  });

  it("returns 404 when the product is missing for the authenticated shop", async () => {
    authenticatePublicAppProxyRequest.mockResolvedValue({
      shopifyDomain: "fixture-shop.myshopify.com",
    });
    prisma.$queryRaw.mockResolvedValue([{ shopId: "shop-1" }]);
    checkRateLimit.mockReturnValue({
      allowed: true,
      headers: new Headers(),
    });
    buildWidgetProductPayload.mockResolvedValue(null);

    const { loader } = await import("../../../app/routes/api.widget.products.$productId");
    const response = await loader({
      request: new Request("http://localhost/api/widget/products/gid%3A%2F%2Fshopify%2FProduct%2F1"),
      params: { productId: "gid://shopify/Product/1" },
      context: {},
    } as never);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Product not found for this shop.",
      },
    });
  });

  it("returns metadata-only responses when requested", async () => {
    authenticatePublicAppProxyRequest.mockResolvedValue({
      shopifyDomain: "fixture-shop.myshopify.com",
    });
    prisma.$queryRaw.mockResolvedValue([{ shopId: "shop-1" }]);
    checkRateLimit.mockReturnValue({
      allowed: true,
      headers: new Headers(),
    });
    buildWidgetProductMetadata.mockResolvedValue({
      productId: "gid://shopify/Product/1",
      deliveryMode: "lazy",
      visible: true,
      totalLineItemCount: 240,
    });

    const { loader } = await import("../../../app/routes/api.widget.products.$productId");
    const response = await loader({
      request: new Request("http://localhost/api/widget/products/gid%3A%2F%2Fshopify%2FProduct%2F1?metadataOnly=1"),
      params: { productId: "gid://shopify/Product/1" },
      context: {},
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        productId: "gid://shopify/Product/1",
        deliveryMode: "lazy",
        visible: true,
        totalLineItemCount: 240,
      },
    });
    expect(buildWidgetProductMetadata).toHaveBeenCalledWith(
      "shop-1",
      "gid://shopify/Product/1",
      prisma,
    );
    expect(buildWidgetProductPayload).not.toHaveBeenCalled();
  });
});
