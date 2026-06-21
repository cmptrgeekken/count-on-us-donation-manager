import { beforeEach, describe, expect, it, vi } from "vitest";
import { canSyncProductToShopify, saveProductArtistAssignmentsLocally } from "./productArtistAssignmentService.server";

const db = {
  artist: {
    findMany: vi.fn(),
  },
  productArtistAssignment: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  productCauseAssignment: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
};

describe("saveProductArtistAssignmentsLocally", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces product Artist assignments and writes derived Cause rollups", async () => {
    db.artist.findMany.mockResolvedValue([
      {
        id: "artist-1",
        displayName: "Alex Artist",
        causeAssignments: [
          {
            causeId: "cause-1",
            percentage: "60",
            cause: { shopifyMetaobjectId: "gid://shopify/Metaobject/1" },
          },
          {
            causeId: "cause-2",
            percentage: "40",
            cause: { shopifyMetaobjectId: null },
          },
        ],
      },
      {
        id: "artist-2",
        displayName: "Bailey Brush",
        causeAssignments: [
          {
            causeId: "cause-1",
            percentage: "100",
            cause: { shopifyMetaobjectId: "gid://shopify/Metaobject/1" },
          },
        ],
      },
    ]);

    const derivedAssignments = await saveProductArtistAssignmentsLocally({
      db: db as never,
      shopId: "fixture-shop.myshopify.com",
      product: { id: "product-1", shopifyId: "gid://shopify/Product/1" },
      artistAssignments: [
        {
          artistId: "artist-1",
          collaborationShare: "50",
          creditOverride: "",
          payoutEnabledOverride: "inherit",
          payoutRateOverride: "",
        },
        {
          artistId: "artist-2",
          collaborationShare: "50",
          creditOverride: "B. Brush",
          payoutEnabledOverride: "true",
          payoutRateOverride: "12.5",
        },
      ],
      auditSource: "test",
    });

    expect(derivedAssignments).toEqual([
      {
        causeId: "cause-1",
        metaobjectId: "gid://shopify/Metaobject/1",
        percentage: 80,
      },
      {
        causeId: "cause-2",
        metaobjectId: null,
        percentage: 20,
      },
    ]);
    expect(db.productArtistAssignment.deleteMany).toHaveBeenCalledWith({
      where: { shopId: "fixture-shop.myshopify.com", productId: "product-1" },
    });
    expect(db.productArtistAssignment.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          artistId: "artist-1",
          collaborationShare: 50,
          payoutEnabledOverride: null,
          payoutRateOverride: null,
        }),
        expect.objectContaining({
          artistId: "artist-2",
          creditOverride: "B. Brush",
          collaborationShare: 50,
          payoutEnabledOverride: true,
          payoutRateOverride: 12.5,
        }),
      ],
    });
    expect(db.productCauseAssignment.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ causeId: "cause-1", percentage: 80 }),
        expect.objectContaining({ causeId: "cause-2", percentage: 20 }),
      ],
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PRODUCT_ARTIST_ASSIGNMENTS_SAVED",
        payload: expect.objectContaining({ source: "test" }),
      }),
    });
  });

  it("rejects partial Artist collaboration totals", async () => {
    await expect(
      saveProductArtistAssignmentsLocally({
        db: db as never,
        shopId: "fixture-shop.myshopify.com",
        product: { id: "product-1", shopifyId: "gid://shopify/Product/1" },
        artistAssignments: [
          {
            artistId: "artist-1",
            collaborationShare: "40",
            payoutEnabledOverride: "inherit",
          },
        ],
      }),
    ).rejects.toThrow("Artist collaboration shares must total 100%.");

    expect(db.productArtistAssignment.deleteMany).not.toHaveBeenCalled();
  });
});

describe("canSyncProductToShopify", () => {
  it("only treats numeric Shopify product GIDs as storefront-syncable", () => {
    expect(canSyncProductToShopify("gid://shopify/Product/1234567890")).toBe(true);
    expect(canSyncProductToShopify("gid://shopify/Product/sparkly-rocketship-product-1")).toBe(false);
    expect(canSyncProductToShopify("gid://shopify/ProductVariant/1234567890")).toBe(false);
  });
});
