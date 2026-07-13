import { Prisma } from "@prisma/client";

import { prisma } from "../db.server";
import { buildVariantEstimatePayload, type VariantEstimatePayload } from "./variantEstimate.server";
import { resolveProductDonationRoutingSource } from "./productDonationRouting.server";

export const WIDGET_PRELOAD_LINE_THRESHOLD = 200;
export const WIDGET_RATE_LIMIT_PER_MINUTE = 60;

type WidgetProductContext = {
  product: {
    id: string;
    shopifyId: string;
    donationRoutingMode: string;
    variants: Array<{
      id: string;
      shopifyId: string;
      price: Prisma.Decimal;
      costConfig: {
        lineItemCount: number;
      } | null;
    }>;
  };
  causeAssignments: Array<{
    causeId: string;
    percentage: Prisma.Decimal;
    cause: {
      id: string;
      name: string;
      is501c3: boolean;
      iconUrl: string | null;
      donationLink: string | null;
    };
  }>;
  artistAssignments: Array<{
    collaborationShare: Prisma.Decimal;
    payoutEnabledOverride: boolean | null;
    payoutRateOverride: Prisma.Decimal | null;
    artist: {
      paymentEnabled: boolean;
      defaultPayoutRate: Prisma.Decimal;
      causeAssignments: Array<{
        causeId: string;
        percentage: Prisma.Decimal;
        cause: {
          id: string;
          name: string;
          is501c3: boolean;
          iconUrl: string | null;
          donationLink: string | null;
        };
      }>;
    };
  }>;
  shop: {
    currency: string;
    paymentRate: Prisma.Decimal | null;
    effectiveTaxRate: Prisma.Decimal | null;
    taxDeductionMode: string;
  };
  taxOffsetCache: {
    widgetTaxSuppressed: boolean;
  } | null;
};

export type WidgetVariantPayload = VariantEstimatePayload;

type WidgetLineContext = {
  variantShopifyId: string;
  quantity: number;
  lineSubtotal: Prisma.Decimal | null;
};

export type WidgetProductPayload = {
  productId: string;
  deliveryMode: "preload" | "lazy";
  visible: boolean;
  totalLineItemCount: number;
  variants: WidgetVariantPayload[];
};

export type WidgetProductMetadata = Omit<WidgetProductPayload, "variants">;

async function loadWidgetProductContext(
  shopId: string,
  productShopifyId: string,
  db = prisma,
): Promise<WidgetProductContext | null> {
  const [product, shop, taxOffsetCache] = await Promise.all([
    db.product.findFirst({
      where: { shopId, shopifyId: productShopifyId },
      select: {
        id: true,
        shopifyId: true,
        donationRoutingMode: true,
        variants: {
          orderBy: [{ title: "asc" }, { shopifyId: "asc" }],
          select: {
            id: true,
            shopifyId: true,
            price: true,
            costConfig: {
              select: {
                lineItemCount: true,
              },
            },
          },
        },
      },
    }),
    db.shop.findUnique({
      where: { shopId },
      select: {
        currency: true,
        paymentRate: true,
        effectiveTaxRate: true,
        taxDeductionMode: true,
      },
    }),
    db.taxOffsetCache.findUnique({
      where: { shopId },
      select: {
        widgetTaxSuppressed: true,
      },
    }),
  ]);

  if (!product || !shop) {
    return null;
  }

  const [causeAssignments, artistAssignments] = await Promise.all([
    db.productCauseAssignment.findMany({
      where: {
        shopId,
        productId: product.id,
        cause: {
          status: "active",
        },
      },
      orderBy: [{ percentage: "desc" }, { cause: { name: "asc" } }],
      select: {
        causeId: true,
        percentage: true,
        cause: {
          select: {
            id: true,
            name: true,
            is501c3: true,
            iconUrl: true,
            donationLink: true,
          },
        },
      },
    }),
    db.productArtistAssignment.findMany({
      where: {
        shopId,
        productId: product.id,
        status: "active",
      },
      orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
      select: {
        collaborationShare: true,
        payoutEnabledOverride: true,
        payoutRateOverride: true,
        artist: {
          select: {
            paymentEnabled: true,
            defaultPayoutRate: true,
            causeAssignments: {
              select: {
                causeId: true,
                percentage: true,
                cause: {
                  select: {
                    id: true,
                    name: true,
                    is501c3: true,
                    iconUrl: true,
                    donationLink: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    product,
    causeAssignments,
    artistAssignments,
    shop,
    taxOffsetCache,
  };
}

export async function buildWidgetProductMetadata(
  shopId: string,
  productShopifyId: string,
  db = prisma,
): Promise<WidgetProductMetadata | null> {
  const context = await loadWidgetProductContext(shopId, productShopifyId, db);

  if (!context) {
    return null;
  }

  const totalLineItemCount = context.product.variants.reduce(
    (sum, variant) => sum + (variant.costConfig?.lineItemCount ?? 0),
    0,
  );
  const deliveryMode = totalLineItemCount < WIDGET_PRELOAD_LINE_THRESHOLD ? "preload" : "lazy";
  const routingSource = resolveProductDonationRoutingSource(
    context.product.donationRoutingMode,
    context.artistAssignments.length,
  );
  const hasRoutedCauses = routingSource === "artist"
    ? context.artistAssignments.some((assignment) => assignment.artist.causeAssignments.length > 0)
    : context.causeAssignments.length > 0;
  const visible = hasRoutedCauses && context.product.variants.length > 0;

  return {
    productId: context.product.shopifyId,
    deliveryMode,
    visible,
    totalLineItemCount,
  };
}

export async function buildWidgetProductPayload(
  shopId: string,
  productShopifyId: string,
  db = prisma,
  lineContext?: WidgetLineContext,
): Promise<WidgetProductPayload | null> {
  const context = await loadWidgetProductContext(shopId, productShopifyId, db);

  if (!context) {
    return null;
  }

  const totalLineItemCount = context.product.variants.reduce(
    (sum, variant) => sum + (variant.costConfig?.lineItemCount ?? 0),
    0,
  );
  const deliveryMode = totalLineItemCount < WIDGET_PRELOAD_LINE_THRESHOLD ? "preload" : "lazy";
  const routingSource = resolveProductDonationRoutingSource(
    context.product.donationRoutingMode,
    context.artistAssignments.length,
  );
  const hasRoutedCauses = routingSource === "artist"
    ? context.artistAssignments.some((assignment) => assignment.artist.causeAssignments.length > 0)
    : context.causeAssignments.length > 0;
  const visible = hasRoutedCauses && context.product.variants.length > 0;
  const widgetTaxSuppressed = context.taxOffsetCache?.widgetTaxSuppressed ?? true;

  const productVariants = lineContext
    ? context.product.variants.filter((variant) => variant.shopifyId === lineContext.variantShopifyId)
    : context.product.variants;

  const variants = await Promise.all(
    productVariants.map((variant) =>
      buildVariantEstimatePayload({
        shopId,
        variant,
        causeAssignments: context.causeAssignments,
        artistAssignments: context.artistAssignments,
        donationRoutingMode: context.product.donationRoutingMode,
        shop: context.shop,
        widgetTaxSuppressed,
        quantity: lineContext?.quantity,
        lineSubtotal: lineContext?.lineSubtotal,
        db: db as never,
      }),
    ),
  );

  return {
    productId: context.product.shopifyId,
    deliveryMode,
    visible,
    totalLineItemCount,
    variants,
  };
}
