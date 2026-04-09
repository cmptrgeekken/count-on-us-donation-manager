import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateAdminMock = vi.fn();

vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: authenticateAdminMock,
  },
}));

describe("authenticateAdminRequest", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PLAYWRIGHT_BYPASS_ENABLED;
    process.env.NODE_ENV = "test";
  });

  it("returns a bypass session for local playwright requests when enabled", async () => {
    process.env.PLAYWRIGHT_BYPASS_ENABLED = "true";
    const { authenticateAdminRequest, isPlaywrightBypassRequest } = await import("./admin-auth.server");
    const request = new Request("http://localhost/app/dashboard?__playwrightShop=fixture-shop.myshopify.com");

    const result = await authenticateAdminRequest(request);

    expect(isPlaywrightBypassRequest(request)).toBe(true);
    expect(result.session.shop).toBe("fixture-shop.myshopify.com");
    expect(authenticateAdminMock).not.toHaveBeenCalled();
  });

  it("falls back to Shopify admin auth for normal requests", async () => {
    authenticateAdminMock.mockResolvedValue({ session: { shop: "real-shop.myshopify.com" } });
    const { authenticateAdminRequest, isPlaywrightBypassRequest } = await import("./admin-auth.server");
    const request = new Request("https://example.ngrok-free.app/app/dashboard");

    const result = await authenticateAdminRequest(request);

    expect(isPlaywrightBypassRequest(request)).toBe(false);
    expect(authenticateAdminMock).toHaveBeenCalledWith(request);
    expect(result.session.shop).toBe("real-shop.myshopify.com");
  });
});
