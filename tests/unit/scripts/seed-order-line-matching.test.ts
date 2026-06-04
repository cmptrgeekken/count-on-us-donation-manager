import { describe, expect, it } from "vitest";
import {
  createOrderLineResolver,
  findBestFuzzyOrderLineMatch,
  mergePendingOrderLineMappings,
  normalizeOrderLineText,
} from "../../../scripts/seed-order-line-matching.mjs";

function buildIndexes() {
  const products = [
    {
      shopifyId: "gid://shopify/Product/1",
      title: "Bench Pressed's Fuck Ice Snowplow Creative Resistance Earrings & Pins",
    },
    {
      shopifyId: "gid://shopify/Product/2",
      title: "Be Good Creative Resistance Button",
    },
    {
      shopifyId: "gid://shopify/Product/3",
      title: "Logo Sticker - Red",
    },
    {
      shopifyId: "gid://shopify/Product/4",
      title: "Logo Sticker - Blue",
    },
  ];
  const variants = [
    { shopifyId: "gid://shopify/ProductVariant/1", productShopifyId: products[0].shopifyId, title: "Pin" },
    { shopifyId: "gid://shopify/ProductVariant/2", productShopifyId: products[0].shopifyId, title: "Pair of Earrings" },
    { shopifyId: "gid://shopify/ProductVariant/3", productShopifyId: products[1].shopifyId, title: '1.25"' },
    { shopifyId: "gid://shopify/ProductVariant/4", productShopifyId: products[2].shopifyId, title: "Default Title" },
    { shopifyId: "gid://shopify/ProductVariant/5", productShopifyId: products[3].shopifyId, title: "Default Title" },
  ];
  const productsByShopifyId = new Map(products.map((product) => [product.shopifyId, product]));
  const variantsByShopifyId = new Map(variants.map((variant) => [variant.shopifyId, variant]));
  const variantsByLineName = new Map();

  for (const variant of variants) {
    const product = productsByShopifyId.get(variant.productShopifyId);
    if (!product) continue;
    variantsByLineName.set(normalizeOrderLineText(product.title), variant);
    if (variant.title !== "Default Title") {
      variantsByLineName.set(normalizeOrderLineText(`${product.title} - ${variant.title}`), variant);
    }
  }

  return { productsByShopifyId, variantsByShopifyId, variantsByLineName };
}

describe("seed order line matching", () => {
  it("uses exact catalog names before other matching modes", async () => {
    const resolver = createOrderLineResolver({ indexes: buildIndexes() });

    const variant = await resolver.resolve('Be Good Creative Resistance Button - 1.25"');

    expect(variant?.shopifyId).toBe("gid://shopify/ProductVariant/3");
    expect(resolver.stats.exact).toBe(1);
    expect(resolver.pendingMappings.size).toBe(0);
  });

  it("uses an explicit mapping file entry for historical names", async () => {
    const resolver = createOrderLineResolver({
      indexes: buildIndexes(),
      orderLineMap: {
        version: 1,
        mappings: {
          "Old Snowplow Pin": {
            variantShopifyId: "gid://shopify/ProductVariant/1",
            displayName: "Bench Pressed's Fuck Ice Snowplow Creative Resistance Earrings & Pins - Pin",
          },
        },
      },
    });

    const variant = await resolver.resolve("Old Snowplow Pin");

    expect(variant?.shopifyId).toBe("gid://shopify/ProductVariant/1");
    expect(resolver.stats.mapped).toBe(1);
  });

  it("auto-maps high-confidence renamed order lines without storing cause data", async () => {
    const resolver = createOrderLineResolver({
      indexes: buildIndexes(),
      now: () => new Date("2026-04-29T12:00:00Z"),
    });

    const variant = await resolver.resolve("Fuck Ice Snowplow Creative Resistance Earrings & Pins - Pin");
    const mapping = resolver.pendingMappings.get("Fuck Ice Snowplow Creative Resistance Earrings & Pins - Pin");

    expect(variant?.shopifyId).toBe("gid://shopify/ProductVariant/1");
    expect(resolver.stats.fuzzy).toBe(1);
    expect(mapping).toMatchObject({
      variantShopifyId: "gid://shopify/ProductVariant/1",
      displayName: "Bench Pressed's Fuck Ice Snowplow Creative Resistance Earrings & Pins - Pin",
      source: "fuzzy",
      updatedAt: "2026-04-29T12:00:00.000Z",
    });
    expect(mapping).not.toHaveProperty("causeName");
  });

  it("leaves ambiguous fuzzy matches unresolved", async () => {
    const resolver = createOrderLineResolver({ indexes: buildIndexes() });

    const variant = await resolver.resolve("Logo Sticker");

    expect(variant).toBeNull();
    expect(resolver.stats.ambiguous.get("Logo Sticker")).toMatchObject({ count: 1, quantity: 1 });
    expect(resolver.stats.unresolved.get("Logo Sticker")).toMatchObject({ count: 1, quantity: 1 });
  });

  it("can report suggested matches without persisting them until merged", () => {
    const indexes = buildIndexes();
    const candidates = [
      {
        displayName: "Bench Pressed's Fuck Ice Snowplow Creative Resistance Earrings & Pins - Pin",
        variant: indexes.variantsByShopifyId.get("gid://shopify/ProductVariant/1"),
      },
    ];

    const match = findBestFuzzyOrderLineMatch("Fuck Ice Snowplow Earrings & Pins - Pin", candidates);
    const merged = mergePendingOrderLineMappings(
      { version: 1, mappings: {} },
      new Map([
        [
          "Fuck Ice Snowplow Earrings & Pins - Pin",
          {
            variantShopifyId: match.best?.variant.shopifyId,
            displayName: match.best?.displayName,
            confidence: match.best?.confidence,
            source: "fuzzy",
            createdAt: "2026-04-29T12:00:00.000Z",
            updatedAt: "2026-04-29T12:00:00.000Z",
          },
        ],
      ]),
    );

    expect(match.autoAccepted).toBe(true);
    expect(merged.mappings["Fuck Ice Snowplow Earrings & Pins - Pin"]).toMatchObject({
      variantShopifyId: "gid://shopify/ProductVariant/1",
      source: "fuzzy",
    });
  });
});
