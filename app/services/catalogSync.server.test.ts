import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    product: { upsert: vi.fn(), findMany: vi.fn() },
    productTag: { deleteMany: vi.fn(), createMany: vi.fn() },
    shopifyCollection: {
      createMany: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    productCollection: { deleteMany: vi.fn(), createMany: vi.fn() },
    variant: { upsert: vi.fn() },
  },
  prisma: {
    $transaction: vi.fn(),
    product: { deleteMany: vi.fn() },
    shopifyCollection: { deleteMany: vi.fn() },
  },
}));

vi.mock("../db.server", () => ({ prisma: mocks.prisma }));

import { incrementalSync, syncCollection } from "./catalogSync.server";

function productResponse({
  tags = ["featured-impact", "summer"],
  collections = [
    {
      id: "gid://shopify/Collection/10",
      title: "Summer Giving",
      handle: "summer-giving",
    },
  ],
}: {
  tags?: string[];
  collections?: Array<{ id: string; title: string; handle: string }>;
} = {}): Response {
  return Response.json({
    data: {
      product: {
        id: "gid://shopify/Product/1",
        title: "Impact Shirt",
        handle: "impact-shirt",
        status: "ACTIVE",
        tags,
        category: null,
        collections: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: collections,
        },
        variants: {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/2",
              title: "Default",
              sku: null,
              price: "20.00",
            },
          ],
        },
      },
    },
  });
}

describe("catalog search metadata synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
        callback(mocks.tx),
    );
    mocks.tx.product.upsert.mockResolvedValue({ id: "product-1" });
    mocks.tx.shopifyCollection.findMany.mockResolvedValue([
      { id: "collection-1" },
    ]);
    mocks.tx.shopifyCollection.upsert.mockResolvedValue({ id: "collection-1" });
    mocks.tx.product.findMany.mockResolvedValue([{ id: "product-1" }]);
  });

  it("incrementalSync replaces tags and product-side collection membership", async () => {
    const admin = { graphql: vi.fn().mockResolvedValue(productResponse()) };

    await incrementalSync(
      "shop.myshopify.com",
      admin,
      "gid://shopify/Product/1",
    );

    expect(mocks.tx.productTag.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop.myshopify.com", productId: "product-1" },
    });
    expect(mocks.tx.productTag.createMany).toHaveBeenCalledWith({
      data: [
        {
          shopId: "shop.myshopify.com",
          productId: "product-1",
          value: "featured-impact",
        },
        {
          shopId: "shop.myshopify.com",
          productId: "product-1",
          value: "summer",
        },
      ],
      skipDuplicates: true,
    });
    expect(mocks.tx.productCollection.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop.myshopify.com", productId: "product-1" },
    });
    expect(mocks.tx.productCollection.createMany).toHaveBeenCalledWith({
      data: [
        {
          shopId: "shop.myshopify.com",
          productId: "product-1",
          collectionId: "collection-1",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("incrementalSync removes tags and memberships no longer returned by Shopify", async () => {
    const admin = {
      graphql: vi
        .fn()
        .mockResolvedValue(productResponse({ tags: [], collections: [] })),
    };

    await incrementalSync(
      "shop.myshopify.com",
      admin,
      "gid://shopify/Product/1",
    );

    expect(mocks.tx.productTag.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop.myshopify.com", productId: "product-1" },
    });
    expect(mocks.tx.productCollection.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop.myshopify.com", productId: "product-1" },
    });
    expect(mocks.tx.productTag.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.productCollection.createMany).not.toHaveBeenCalled();
  });

  it("syncCollection replaces collection-side membership for known shop products", async () => {
    const admin = {
      graphql: vi.fn().mockResolvedValue(
        Response.json({
          data: {
            collection: {
              id: "gid://shopify/Collection/10",
              title: "Renamed Giving",
              handle: "renamed-giving",
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: "gid://shopify/Product/1" }],
              },
            },
          },
        }),
      ),
    };

    await syncCollection(
      "shop.myshopify.com",
      admin,
      "gid://shopify/Collection/10",
    );

    expect(mocks.tx.shopifyCollection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shopId_shopifyId: {
            shopId: "shop.myshopify.com",
            shopifyId: "gid://shopify/Collection/10",
          },
        },
        update: expect.objectContaining({
          title: "Renamed Giving",
          handle: "renamed-giving",
        }),
      }),
    );
    expect(mocks.tx.productCollection.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "shop.myshopify.com", collectionId: "collection-1" },
    });
    expect(mocks.tx.product.findMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop.myshopify.com",
        shopifyId: { in: ["gid://shopify/Product/1"] },
      },
      select: { id: true },
    });
    expect(mocks.tx.productCollection.createMany).toHaveBeenCalledWith({
      data: [
        {
          shopId: "shop.myshopify.com",
          productId: "product-1",
          collectionId: "collection-1",
        },
      ],
      skipDuplicates: true,
    });
  });
});
