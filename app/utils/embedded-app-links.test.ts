import { describe, expect, it } from "vitest";

import {
  getShopifyAdminAppBaseUrl,
  getShopifyAdminAppBaseUrlFromContext,
  toShopifyAdminAppHref,
  withEmbeddedAppContext,
} from "./embedded-app-links";

const origin = "https://count-on-us.example";
const context = "?shop=test-shop.myshopify.com&host=encoded-host&embedded=1&locale=en&id_token=stale";

describe("withEmbeddedAppContext", () => {
  it("adds Shopify embedded context to internal app links", () => {
    expect(withEmbeddedAppContext("/app/products", context, origin)).toBe(
      "/app/products?shop=test-shop.myshopify.com&host=encoded-host&locale=en",
    );
  });

  it("preserves existing route parameters while adding context", () => {
    expect(withEmbeddedAppContext("/app/settings?section=tax", context, origin)).toBe(
      "/app/settings?section=tax&shop=test-shop.myshopify.com&host=encoded-host&locale=en",
    );
  });

  it("does not copy embedded-only parameters into top-level document links", () => {
    expect(withEmbeddedAppContext("/app/reporting?embedded=1&id_token=old", context, origin)).toBe(
      "/app/reporting?shop=test-shop.myshopify.com&host=encoded-host&locale=en",
    );
  });

  it("leaves non-app and external links unchanged", () => {
    expect(withEmbeddedAppContext("/auth/login", context, origin)).toBe("/auth/login");
    expect(withEmbeddedAppContext("https://admin.shopify.com/store/test", context, origin)).toBe(
      "https://admin.shopify.com/store/test",
    );
    expect(withEmbeddedAppContext("mailto:test@example.com", context, origin)).toBe("mailto:test@example.com");
  });

  it("leaves links unchanged when required Shopify context is missing", () => {
    expect(withEmbeddedAppContext("/app/products", "?shop=test-shop.myshopify.com", origin)).toBe("/app/products");
    expect(withEmbeddedAppContext("/app/products", "?host=encoded-host", origin)).toBe("/app/products");
  });
});

describe("getShopifyAdminAppBaseUrl", () => {
  it("extracts the Shopify Admin app base URL from embedded referrers", () => {
    expect(
      getShopifyAdminAppBaseUrl(
        "https://admin.shopify.com/store/sparkly-rocketship-dev/apps/count-on-us-dev/products?embedded=1",
      ),
    ).toBe("https://admin.shopify.com/store/sparkly-rocketship-dev/apps/count-on-us-dev");
  });

  it("ignores non-admin referrers", () => {
    expect(getShopifyAdminAppBaseUrl("https://count-on-us.example/app/products")).toBeNull();
  });
});

describe("getShopifyAdminAppBaseUrlFromContext", () => {
  it("builds the Shopify Admin app base URL from host and API key", () => {
    const host = btoa("admin.shopify.com/store/sparkly-rocketship-dev");
    expect(getShopifyAdminAppBaseUrlFromContext(`?host=${encodeURIComponent(host)}`, "2dde5654")).toBe(
      "https://admin.shopify.com/store/sparkly-rocketship-dev/apps/2dde5654",
    );
  });

  it("supports URL-safe base64 host values", () => {
    const host = btoa("admin.shopify.com/store/sparkly-rocketship-dev")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(getShopifyAdminAppBaseUrlFromContext(`?host=${encodeURIComponent(host)}`, "2dde5654")).toBe(
      "https://admin.shopify.com/store/sparkly-rocketship-dev/apps/2dde5654",
    );
  });

  it("rejects decoded host values outside Shopify Admin", () => {
    const host = btoa("example.com/store/sparkly-rocketship-dev");
    expect(getShopifyAdminAppBaseUrlFromContext(`?host=${encodeURIComponent(host)}`, "2dde5654")).toBeNull();
  });
});

describe("toShopifyAdminAppHref", () => {
  const adminAppBaseUrl = "https://admin.shopify.com/store/sparkly-rocketship-dev/apps/count-on-us-dev";

  it("converts internal app links to Shopify Admin deep links", () => {
    expect(toShopifyAdminAppHref("/app/products/123?shop=test-shop.myshopify.com", context, origin, adminAppBaseUrl)).toBe(
      "https://admin.shopify.com/store/sparkly-rocketship-dev/apps/count-on-us-dev/app/products/123?shop=test-shop.myshopify.com",
    );
  });

  it("strips embedded-only parameters from Admin deep links", () => {
    expect(
      toShopifyAdminAppHref(
        "/app/reporting?embedded=1&id_token=old&shop=test-shop.myshopify.com&host=encoded-host",
        context,
        origin,
        adminAppBaseUrl,
      ),
    ).toBe(
      "https://admin.shopify.com/store/sparkly-rocketship-dev/apps/count-on-us-dev/app/reporting?shop=test-shop.myshopify.com&host=encoded-host",
    );
  });

  it("leaves links unchanged without an Admin app base URL", () => {
    expect(toShopifyAdminAppHref("/app/products", context, origin, null)).toBe("/app/products");
  });
});
