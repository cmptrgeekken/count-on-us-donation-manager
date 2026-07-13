import { prisma } from "../db.server";
import { Prisma } from "@prisma/client";
import { syncProductCauseAssignmentsMetafield } from "./productCauseAssignmentService.server";
import { syncProductPublicDonationMetafields } from "./productPublicMetafieldService.server";
import { PRODUCT_OVERRIDE_ROUTING_MODE } from "./productDonationRouting.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type ProductArtistAssignmentInput = {
  artistId: string;
  collaborationShare: string;
  creditOverride?: string;
  payoutEnabledOverride: "inherit" | "true" | "false";
  payoutRateOverride?: string;
};

type DerivedCauseAssignment = {
  causeId: string;
  name: string;
  metaobjectId: string | null;
  percentage: Prisma.Decimal;
};

type ProductArtistAssignmentDb = Pick<
  typeof prisma,
  "artist" | "product" | "productArtistAssignment" | "productCauseAssignment" | "auditLog"
>;

const SHOPIFY_PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/\d+$/;

export function canSyncProductToShopify(productGid: string): boolean {
  return SHOPIFY_PRODUCT_GID_PATTERN.test(productGid);
}

export async function auditProductShopifySyncFailure(
  shopId: string,
  productId: string,
  productGid: string,
  error: unknown,
) {
  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Product",
      entityId: productId,
      action: "PRODUCT_CAUSE_ASSIGNMENTS_SHOPIFY_SYNC_FAILED",
      actor: "merchant",
      payload: {
        shopifyProductId: productGid,
        message: error instanceof Error ? error.message : "Unknown Shopify sync failure",
      },
    },
  });
}

export async function saveProductArtistAssignmentsLocally({
  db = prisma,
  shopId,
  product,
  artistAssignments,
  auditSource = "product_detail",
}: {
  db?: ProductArtistAssignmentDb;
  shopId: string;
  product: { id: string; shopifyId: string; donationRoutingMode?: string };
  artistAssignments: ProductArtistAssignmentInput[];
  auditSource?: string;
}): Promise<DerivedCauseAssignment[]> {
  const artistIds = artistAssignments.map((assignment) => assignment.artistId);

  if (new Set(artistIds).size !== artistIds.length) {
    throw new Error("Each Artist can only be assigned once per product.");
  }

  const total = artistAssignments.reduce((sum, assignment) => sum + Number(assignment.collaborationShare), 0);
  if (artistAssignments.length > 0 && total !== 100) {
    throw new Error("Artist collaboration shares must total 100%.");
  }

  if (artistAssignments.some((assignment) => Number.isNaN(Number(assignment.collaborationShare)) || Number(assignment.collaborationShare) <= 0)) {
    throw new Error("Each Artist collaboration share must be greater than 0.");
  }

  if (artistAssignments.some((assignment) => assignment.payoutRateOverride && (Number.isNaN(Number(assignment.payoutRateOverride)) || Number(assignment.payoutRateOverride) < 0 || Number(assignment.payoutRateOverride) > 100))) {
    throw new Error("Artist payout overrides must be between 0 and 100%.");
  }

  const artists = artistIds.length
    ? await db.artist.findMany({
        where: { id: { in: artistIds }, shopId, status: "active" },
        include: {
          causeAssignments: {
            include: {
              cause: {
                select: { id: true, name: true, shopifyMetaobjectId: true },
              },
            },
          },
        },
      })
    : [];

  if (artists.length !== artistIds.length) {
    throw new Error("One or more selected Artists are unavailable.");
  }

  for (const artist of artists) {
    const causeTotal = artist.causeAssignments.reduce((sum, assignment) => sum + Number(assignment.percentage), 0);
    if (causeTotal > 100) {
      throw new Error(`${artist.displayName} has Cause percentages totaling more than 100%.`);
    }
  }

  const artistMap = new Map(artists.map((artist) => [artist.id, artist]));
  const derivedCauseMap = new Map<string, DerivedCauseAssignment>();
  const preserveProductOverride = product.donationRoutingMode === PRODUCT_OVERRIDE_ROUTING_MODE;

  for (const assignment of artistAssignments) {
    const artist = artistMap.get(assignment.artistId);
    if (!artist) continue;
    const collaborationShare = new Prisma.Decimal(assignment.collaborationShare);
    for (const causeAssignment of artist.causeAssignments) {
      const existing = derivedCauseMap.get(causeAssignment.causeId) ?? {
        causeId: causeAssignment.causeId,
        name: causeAssignment.cause.name,
        metaobjectId: causeAssignment.cause.shopifyMetaobjectId ?? null,
        percentage: new Prisma.Decimal(0),
      };
      existing.percentage = existing.percentage.add(
        collaborationShare.mul(causeAssignment.percentage).div(100),
      );
      derivedCauseMap.set(causeAssignment.causeId, existing);
    }
  }

  let derivedAssignments = Array.from(derivedCauseMap.values());

  if (preserveProductOverride) {
    const overrideAssignments = await db.productCauseAssignment.findMany({
      where: { shopId, productId: product.id },
      include: {
        cause: { select: { name: true, shopifyMetaobjectId: true } },
      },
    });
    derivedAssignments = overrideAssignments.map((assignment) => ({
      causeId: assignment.causeId,
      name: assignment.cause.name,
      metaobjectId: assignment.cause.shopifyMetaobjectId ?? null,
      percentage: new Prisma.Decimal(assignment.percentage),
    }));
  }

  await db.productArtistAssignment.deleteMany({
    where: { shopId, productId: product.id },
  });
  if (!preserveProductOverride) {
    await db.productCauseAssignment.deleteMany({
      where: {
        shopId,
        OR: [
          { productId: product.id },
          { shopifyProductId: product.shopifyId },
        ],
      },
    });
  }

  if (artistAssignments.length > 0) {
    await db.productArtistAssignment.createMany({
      data: artistAssignments.map((assignment, index) => ({
        shopId,
        productId: product.id,
        shopifyProductId: product.shopifyId,
        artistId: assignment.artistId,
        attributionOrder: index,
        creditOverride: assignment.creditOverride?.trim() || null,
        collaborationShare: Number(assignment.collaborationShare),
        payoutEnabledOverride:
          assignment.payoutEnabledOverride === "inherit"
            ? null
            : assignment.payoutEnabledOverride === "true",
        payoutRateOverride: assignment.payoutRateOverride?.trim()
          ? Number(assignment.payoutRateOverride)
          : null,
        status: "active",
      })),
    });
  }

  if (!preserveProductOverride && derivedAssignments.length > 0) {
    await db.productCauseAssignment.createMany({
      data: derivedAssignments.map((assignment) => ({
        shopId,
        shopifyProductId: product.shopifyId,
        productId: product.id,
        causeId: assignment.causeId,
        percentage: assignment.percentage,
      })),
    });
  }

  if (preserveProductOverride && artistAssignments.length === 0) {
    await db.product.update({
      where: { id: product.id, shopId },
      data: { donationRoutingMode: "automatic" },
    });
  }

  await db.auditLog.create({
    data: {
      shopId,
      entity: "Product",
      entityId: product.id,
      action: "PRODUCT_ARTIST_ASSIGNMENTS_SAVED",
      actor: "merchant",
      payload: {
        shopifyProductId: product.shopifyId,
        source: auditSource,
        artistAssignments,
        derivedCauseAssignments: derivedAssignments,
      },
    },
  });

  return derivedAssignments;
}

export async function syncProductArtistAssignmentsToShopify({
  admin,
  shopId,
  product,
  derivedAssignments,
}: {
  admin: AdminContext;
  shopId: string;
  product: { shopifyId: string };
  derivedAssignments: DerivedCauseAssignment[];
}) {
  await syncProductCauseAssignmentsMetafield(
    admin,
    shopId,
    product.shopifyId,
    derivedAssignments.map((assignment) => ({
      causeId: assignment.causeId,
      name: assignment.name,
      metaobjectId: assignment.metaobjectId,
      percentage: assignment.percentage.toFixed(2),
    })),
  );
}

export async function syncFullProductPublicAssignmentsToShopify({
  admin,
  shopId,
  product,
  derivedAssignments,
  canWriteProducts,
}: {
  admin: AdminContext;
  shopId: string;
  product: { id: string; shopifyId: string };
  derivedAssignments: DerivedCauseAssignment[];
  canWriteProducts?: boolean;
}) {
  const artistAssignments = await prisma.productArtistAssignment.findMany({
    where: { shopId, productId: product.id, status: "active" },
    orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
    select: {
      creditOverride: true,
      artist: {
        select: {
          id: true,
          creditName: true,
          displayName: true,
          shopifyMetaobjectId: true,
        },
      },
    },
  });

  await syncProductPublicDonationMetafields({
    admin,
    shopId,
    productGid: product.shopifyId,
    causes: derivedAssignments.map((assignment) => ({
      causeId: assignment.causeId,
      name: assignment.name,
      metaobjectId: assignment.metaobjectId,
      percentage: assignment.percentage.toFixed(2),
    })),
    artists: artistAssignments.map((assignment) => ({
      artistId: assignment.artist.id,
      creditName: assignment.creditOverride?.trim() || assignment.artist.creditName || assignment.artist.displayName,
      metaobjectId: assignment.artist.shopifyMetaobjectId,
    })),
    canWriteProducts,
  });
}
