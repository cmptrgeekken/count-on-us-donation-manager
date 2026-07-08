import { prisma } from "../db.server";
import { getPublicIconUrl } from "./publicIconStorage.server";

export type PublicDirectoryLayout = "list" | "cards";

function productFilterUrl(namespace: string, key: string, value: string) {
  const params = new URLSearchParams();
  params.set(`filter.p.m.${namespace}.${key}`, value);
  return `/collections/all?${params.toString()}`;
}

export async function buildPublicArtistsDirectory(shopId: string, db = prisma) {
  const artists = await db.artist.findMany({
    where: {
      shopId,
      status: "active",
    },
    orderBy: [{ creditName: "asc" }, { displayName: "asc" }],
    select: {
      id: true,
      displayName: true,
      creditName: true,
      publicBio: true,
      iconUrl: true,
      iconStorageKey: true,
      websiteUrl: true,
      instagramUrl: true,
      shopifyMetaobjectId: true,
      causeAssignments: {
        orderBy: [{ cause: { name: "asc" } }],
        select: {
          percentage: true,
          cause: {
            select: {
              id: true,
              name: true,
              donationLink: true,
              websiteUrl: true,
            },
          },
        },
      },
      productAssignments: {
        where: {
          shopId,
          status: "active",
          product: {
            status: "active",
          },
        },
        select: {
          productId: true,
        },
      },
    },
  });

  return {
    version: "2026-07",
    artists: artists.map((artist) => ({
      id: artist.id,
      displayName: artist.displayName,
      creditName: artist.creditName || artist.displayName,
      publicBio: artist.publicBio,
      iconUrl: artist.iconStorageKey ? getPublicIconUrl({ type: "artist", id: artist.id }) : artist.iconUrl,
      websiteUrl: artist.websiteUrl,
      instagramUrl: artist.instagramUrl,
      productCount: artist.productAssignments.length,
      productsUrl: productFilterUrl("donation_manager", "artist_names", artist.creditName || artist.displayName),
      causes: artist.causeAssignments.map((assignment) => ({
        id: assignment.cause.id,
        name: assignment.cause.name,
        percentage: assignment.percentage.toString(),
        donationLink: assignment.cause.donationLink,
        websiteUrl: assignment.cause.websiteUrl,
      })),
    })),
  };
}

export async function buildPublicCausesDirectory(shopId: string, db = prisma) {
  const [causes, products] = await Promise.all([
    db.cause.findMany({
      where: {
        shopId,
        status: "active",
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        legalName: true,
        description: true,
        iconUrl: true,
        iconStorageKey: true,
        donationLink: true,
        websiteUrl: true,
        instagramUrl: true,
        is501c3: true,
        shopifyMetaobjectId: true,
      },
    }),
    db.product.findMany({
      where: {
        shopId,
        status: "active",
      },
      select: {
        causeAssignments: {
          where: { shopId },
          select: { causeId: true },
        },
        artistAssignments: {
          where: {
            shopId,
            status: "active",
            artist: {
              status: "active",
            },
          },
          select: {
            artist: {
              select: {
                causeAssignments: {
                  where: { shopId },
                  select: { causeId: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const productCountsByCauseId = new Map<string, number>();
  for (const product of products) {
    const productCauseIds = new Set<string>();
    product.causeAssignments.forEach((assignment) => productCauseIds.add(assignment.causeId));
    product.artistAssignments.forEach((assignment) => {
      assignment.artist.causeAssignments.forEach((artistCauseAssignment) => {
        productCauseIds.add(artistCauseAssignment.causeId);
      });
    });
    productCauseIds.forEach((causeId) => {
      productCountsByCauseId.set(causeId, (productCountsByCauseId.get(causeId) ?? 0) + 1);
    });
  }

  return {
    version: "2026-07",
    causes: causes.map((cause) => ({
      id: cause.id,
      name: cause.name,
      legalName: cause.legalName,
      description: cause.description,
      iconUrl: cause.iconStorageKey ? getPublicIconUrl({ type: "cause", id: cause.id }) : cause.iconUrl,
      donationLink: cause.donationLink,
      websiteUrl: cause.websiteUrl,
      instagramUrl: cause.instagramUrl,
      is501c3: cause.is501c3,
      productCount: productCountsByCauseId.get(cause.id) ?? 0,
      productsUrl: productFilterUrl("donation_manager", "cause_names", cause.name),
    })),
  };
}

export async function buildPublicProductArtistOverlay(
  shopId: string,
  productGids: string[],
  productHandles: string[] = [],
  db = prisma,
) {
  const uniqueProductGids = Array.from(new Set(productGids.map((gid) => gid.trim()).filter(Boolean))).slice(0, 100);
  const uniqueProductHandles = Array.from(new Set(productHandles.map((handle) => handle.trim()).filter(Boolean))).slice(0, 100);
  if (uniqueProductGids.length === 0 && uniqueProductHandles.length === 0) {
    return { version: "2026-07", products: [] };
  }

  const shop = await db.shop.findUnique({
    where: { shopId },
    select: { artistOverlayEnabled: true },
  });
  if (!shop?.artistOverlayEnabled) {
    return { version: "2026-07", products: [] };
  }

  const products = await db.product.findMany({
    where: {
      shopId,
      OR: [
        ...(uniqueProductGids.length > 0 ? [{ shopifyId: { in: uniqueProductGids } }] : []),
        ...(uniqueProductHandles.length > 0 ? [{ handle: { in: uniqueProductHandles } }] : []),
      ],
    },
    select: {
      shopifyId: true,
      handle: true,
      artistAssignments: {
        where: {
          shopId,
          status: "active",
          artist: {
            status: "active",
          },
        },
        orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
        select: {
          creditOverride: true,
          artist: {
            select: {
              creditName: true,
              displayName: true,
            },
          },
        },
      },
    },
  });

  return {
    version: "2026-07",
    products: products.map((product) => {
      const artists = product.artistAssignments.map((assignment) => (
        assignment.creditOverride?.trim() || assignment.artist.creditName || assignment.artist.displayName
      ));
      return {
        productId: product.shopifyId,
        handle: product.handle,
        artists,
      };
    }),
  };
}
