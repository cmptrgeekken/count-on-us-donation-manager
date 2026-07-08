import { Prisma } from "@prisma/client";

import { prisma } from "../db.server";
import { buildVariantEstimatePayload } from "./variantEstimate.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const START_MARKER = "<!-- count-on-us:start -->";
const END_MARKER = "<!-- count-on-us:end -->";

const PRODUCT_DESCRIPTION_QUERY = `#graphql
  query ProductDescriptionForCountOnUs($id: ID!) {
    product(id: $id) {
      id
      descriptionHtml
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation UpdateCountOnUsProductDescription($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type GraphqlUserError = {
  message: string;
};

async function parseGraphqlResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as T & { errors?: Array<{ message?: string }> };
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message ?? "Unknown Shopify GraphQL error").join("; "));
  }
  return json;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function replaceMarkedBlock(descriptionHtml: string, block: string | null) {
  const startIndex = descriptionHtml.indexOf(START_MARKER);
  const endIndex = descriptionHtml.indexOf(END_MARKER);
  const hasBlock = startIndex >= 0 && endIndex > startIndex;
  const replacement = block ? `${START_MARKER}\n${block}\n${END_MARKER}` : "";

  if (!hasBlock) {
    return block ? `${descriptionHtml}${descriptionHtml.trim() ? "\n\n" : ""}${replacement}` : descriptionHtml;
  }

  return `${descriptionHtml.slice(0, startIndex).trimEnd()}${replacement ? `\n${replacement}` : ""}${descriptionHtml
    .slice(endIndex + END_MARKER.length)
    .trimStart()}`;
}

function formatMoneyRange(min: string, max: string, currencyCode: string) {
  const minValue = Number(min);
  const maxValue = Number(max);
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return null;
  if (Math.abs(minValue - maxValue) < 0.01) return formatter.format(minValue);
  return `${formatter.format(minValue)}-${formatter.format(maxValue)}`;
}

export async function buildProductDescriptionDonationSummaryHtml(shopId: string, productId: string, db = prisma) {
  const [product, shop, taxOffsetCache] = await Promise.all([
    db.product.findFirst({
      where: { id: productId, shopId },
      select: {
        id: true,
        title: true,
        variants: {
          orderBy: [{ title: "asc" }],
          select: {
            id: true,
            shopifyId: true,
            price: true,
            costConfig: {
              select: { lineItemCount: true },
            },
          },
        },
        causeAssignments: {
          where: { shopId, cause: { status: "active" } },
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
        artistAssignments: {
          where: { shopId, status: "active", artist: { status: "active" } },
          orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
          select: {
            creditOverride: true,
            collaborationShare: true,
            payoutEnabledOverride: true,
            payoutRateOverride: true,
            artist: {
              select: {
                displayName: true,
                creditName: true,
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
      select: { widgetTaxSuppressed: true },
    }),
  ]);

  if (!product || !shop) return null;

  const artistNames = product.artistAssignments.map((assignment) => (
    assignment.creditOverride?.trim() || assignment.artist.creditName || assignment.artist.displayName
  ));
  const causeNames = new Set(product.causeAssignments.map((assignment) => assignment.cause.name));
  for (const assignment of product.artistAssignments) {
    for (const causeAssignment of assignment.artist.causeAssignments) {
      causeNames.add(causeAssignment.cause.name);
    }
  }

  if (artistNames.length === 0 && causeNames.size === 0) return null;

  const widgetTaxSuppressed = taxOffsetCache?.widgetTaxSuppressed ?? true;
  const estimates = await Promise.all(
    product.variants.map((variant) =>
      buildVariantEstimatePayload({
        shopId,
        variant,
        causeAssignments: product.causeAssignments,
        artistAssignments: product.artistAssignments,
        shop,
        widgetTaxSuppressed,
        db: db as never,
      }),
    ),
  );
  const donationAmounts = estimates
    .flatMap((estimate) => estimate.causes.map((cause) => new Prisma.Decimal(cause.estimatedDonationAmount)))
    .filter((amount) => amount.greaterThan(new Prisma.Decimal(0)));
  const donationSummary =
    donationAmounts.length > 0
      ? formatMoneyRange(
          Prisma.Decimal.min(...donationAmounts).toFixed(2),
          Prisma.Decimal.max(...donationAmounts).toFixed(2),
          shop.currency,
        )
      : null;

  const artistsMarkup = artistNames.length
    ? `<p><strong>Artist${artistNames.length === 1 ? "" : "s"}:</strong> ${escapeHtml(artistNames.join(", "))}</p>`
    : "";
  const causesMarkup = causeNames.size
    ? `<p><strong>Cause${causeNames.size === 1 ? "" : "s"}:</strong> ${escapeHtml(Array.from(causeNames).join(", "))}</p>`
    : artistNames.length
      ? "<p><strong>Cause:</strong> Donation routing has not been configured for this artist collaboration yet.</p>"
    : "";
  const donationMarkup = donationSummary
    ? `<p><strong>Estimated donation:</strong> ${escapeHtml(donationSummary)} depending on variant and purchase details.</p>`
    : causeNames.size
      ? "<p><strong>Estimated donation:</strong> Available after product costs and donation routing are fully configured.</p>"
    : "";

  return `<section data-count-on-us-description-summary><h3>Donation impact</h3>${artistsMarkup}${causesMarkup}${donationMarkup}<p><em>Donation amounts are estimates. Final allocations are confirmed after purchase.</em></p></section>`;
}

export async function syncProductDescriptionDonationSummary({
  admin,
  shopId,
  product,
  enabled,
}: {
  admin: AdminContext;
  shopId: string;
  product: { id: string; shopifyId: string };
  enabled: boolean;
}): Promise<void> {
  const descriptionResponse = await admin.graphql(PRODUCT_DESCRIPTION_QUERY, {
    variables: { id: product.shopifyId },
  });
  const descriptionJson = await parseGraphqlResponse<{
    data?: { product?: { descriptionHtml: string | null } | null };
  }>(descriptionResponse);
  const productDescription = descriptionJson.data?.product;
  if (!productDescription) {
    throw new Error(`Shopify product ${product.shopifyId} was not found while updating the Count On Us description summary.`);
  }
  const descriptionHtml = productDescription.descriptionHtml ?? "";
  const summary = enabled
    ? await buildProductDescriptionDonationSummaryHtml(shopId, product.id)
    : null;
  const nextDescription = replaceMarkedBlock(descriptionHtml, summary);

  if (nextDescription === descriptionHtml) return;

  const updateResponse = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
    variables: {
      product: {
        id: product.shopifyId,
        descriptionHtml: nextDescription,
      },
    },
  });
  const updateJson = await parseGraphqlResponse<{
    data?: {
      productUpdate?: {
        userErrors: GraphqlUserError[];
      };
    };
  }>(updateResponse);
  const userErrors = updateJson.data?.productUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    const firstError = userErrors[0];
    const message = firstError?.message ?? "Unable to update product description.";
    throw new Error(message);
  }
}
