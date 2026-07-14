import { describe, expect, it } from "vitest";
import {
  parseCatalogWebhookOperation,
  parseResourceGid,
} from "./shopify-webhook-resource";

describe("parseResourceGid", () => {
  it("accepts a valid GraphQL resource id", () => {
    expect(
      parseResourceGid(
        { admin_graphql_api_id: "gid://shopify/Product/123" },
        "Product",
      ),
    ).toBe("gid://shopify/Product/123");
  });

  it("normalizes numeric REST ids", () => {
    expect(parseResourceGid({ id: 456 }, "Collection")).toBe(
      "gid://shopify/Collection/456",
    );
  });

  it("rejects payloads without a resource id", () => {
    expect(parseResourceGid({ title: "Missing id" }, "Product")).toBeNull();
  });
});

describe("parseCatalogWebhookOperation", () => {
  it.each(["products/create", "products/update"])(
    "routes %s to product sync",
    (topic) => {
      expect(parseCatalogWebhookOperation(topic, { id: 123 })).toEqual({
        kind: "product-sync",
        productGid: "gid://shopify/Product/123",
      });
    },
  );

  it("routes product deletion", () => {
    expect(
      parseCatalogWebhookOperation("products/delete", { id: 123 }),
    ).toEqual({
      kind: "product-delete",
      productGid: "gid://shopify/Product/123",
    });
  });

  it.each(["collections/create", "collections/update"])(
    "routes %s to collection sync",
    (topic) => {
      expect(parseCatalogWebhookOperation(topic, { id: 456 })).toEqual({
        kind: "collection-sync",
        collectionGid: "gid://shopify/Collection/456",
      });
    },
  );

  it("routes collection deletion", () => {
    expect(
      parseCatalogWebhookOperation("collections/delete", { id: 456 }),
    ).toEqual({
      kind: "collection-delete",
      collectionGid: "gid://shopify/Collection/456",
    });
  });

  it("rejects malformed catalog payloads and ignores unrelated topics", () => {
    expect(parseCatalogWebhookOperation("products/update", {})).toBeNull();
    expect(parseCatalogWebhookOperation("orders/create", {})).toBeUndefined();
  });
});
