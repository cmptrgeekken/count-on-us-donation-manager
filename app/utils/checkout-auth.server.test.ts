import { afterEach, describe, expect, it, vi } from "vitest";

const { authenticatePublicCheckout } = vi.hoisted(() => ({
  authenticatePublicCheckout: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: {
    public: {
      checkout: authenticatePublicCheckout,
    },
  },
}));

import { authenticateCheckoutRequest } from "./checkout-auth.server";

describe("authenticateCheckoutRequest", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("uses the local playwright bypass when enabled", async () => {
    process.env = {
      ...originalEnv,
      PLAYWRIGHT_BYPASS_ENABLED: "true",
      NODE_ENV: "test",
    };

    const result = await authenticateCheckoutRequest(
      new Request("http://localhost:3000/api/orders/test/donation?__playwrightShop=fixture.myshopify.com"),
    );

    expect(result.shopifyDomain).toBe("fixture.myshopify.com");
    expect(authenticatePublicCheckout).not.toHaveBeenCalled();
  });

  it("normalizes the checkout session token shop domain", async () => {
    authenticatePublicCheckout.mockResolvedValue({
      sessionToken: {
        dest: "https://fixture.myshopify.com",
      },
      cors: (response: Response) => response,
    });

    const result = await authenticateCheckoutRequest(
      new Request("https://example.com/api/orders/test/donation"),
    );

    expect(result.shopifyDomain).toBe("fixture.myshopify.com");
  });
});
