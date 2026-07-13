import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { canSyncProductToShopify, saveProductArtistAssignmentsLocally } from "./productArtistAssignmentService.server";

const db = {
  product: {
    update: vi.fn(),
  },
  artist: {
    findMany: vi.fn(),
  },
  productArtistAssignment: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  productCauseAssignment: {
    findMany: vi.fn(),
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
            cause: { name: "Cause One", shopifyMetaobjectId: "gid://shopify/Metaobject/1" },
          },
          {
            causeId: "cause-2",
            percentage: "40",
            cause: { name: "Cause Two", shopifyMetaobjectId: null },
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
            cause: { name: "Cause One", shopifyMetaobjectId: "gid://shopify/Metaobject/1" },
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
        name: "Cause One",
        metaobjectId: "gid://shopify/Metaobject/1",
        percentage: new Prisma.Decimal(80),
      },
      {
        causeId: "cause-2",
        name: "Cause Two",
        metaobjectId: null,
        percentage: new Prisma.Decimal(20),
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
        expect.objectContaining({ causeId: "cause-1", percentage: new Prisma.Decimal(80) }),
        expect.objectContaining({ causeId: "cause-2", percentage: new Prisma.Decimal(20) }),
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

  it("allows Artists with partial Cause preferences", async () => {
    db.artist.findMany.mockResolvedValue([
      {
        id: "artist-1",
        displayName: "Alex Artist",
        causeAssignments: [
          {
            causeId: "cause-1",
            percentage: "50",
            cause: { name: "Cause One", shopifyMetaobjectId: "gid://shopify/Metaobject/1" },
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
          collaborationShare: "100",
          payoutEnabledOverride: "inherit",
        },
      ],
    });

    expect(derivedAssignments).toEqual([
      {
        causeId: "cause-1",
        name: "Cause One",
        metaobjectId: "gid://shopify/Metaobject/1",
        percentage: new Prisma.Decimal(50),
      },
    ]);
  });

  it("preserves a product Cause override while Artist assignments change", async () => {
    db.artist.findMany.mockResolvedValue([
      {
        id: "artist-1",
        displayName: "Alex Artist",
        causeAssignments: [
          {
            causeId: "artist-cause",
            percentage: "100",
            cause: { name: "Artist Cause", shopifyMetaobjectId: null },
          },
        ],
      },
    ]);
    db.productCauseAssignment.findMany.mockResolvedValue([
      {
        causeId: "override-cause",
        percentage: "25",
        cause: { name: "Override Cause", shopifyMetaobjectId: "gid://shopify/Metaobject/9" },
      },
    ]);

    const effectiveAssignments = await saveProductArtistAssignmentsLocally({
      db: db as never,
      shopId: "fixture-shop.myshopify.com",
      product: {
        id: "product-1",
        shopifyId: "gid://shopify/Product/1",
        donationRoutingMode: "product_override",
      },
      artistAssignments: [{
        artistId: "artist-1",
        collaborationShare: "100",
        payoutEnabledOverride: "inherit",
      }],
    });

    expect(effectiveAssignments).toEqual([
      {
        causeId: "override-cause",
        name: "Override Cause",
        metaobjectId: "gid://shopify/Metaobject/9",
        percentage: new Prisma.Decimal(25),
      },
    ]);
    expect(db.productCauseAssignment.deleteMany).not.toHaveBeenCalled();
    expect(db.productCauseAssignment.createMany).not.toHaveBeenCalled();
  });
});

describe("canSyncProductToShopify", () => {
  it("only treats numeric Shopify product GIDs as storefront-syncable", () => {
    expect(canSyncProductToShopify("gid://shopify/Product/1234567890")).toBe(true);
    expect(canSyncProductToShopify("gid://shopify/Product/sparkly-rocketship-product-1")).toBe(false);
    expect(canSyncProductToShopify("gid://shopify/ProductVariant/1234567890")).toBe(false);
  });
});
