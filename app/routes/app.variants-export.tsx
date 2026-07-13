import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "../db.server";
import { buildVariantEstimatePayload, type VariantEstimatePayload } from "../services/variantEstimate.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

function csvCell(value: string | number | boolean | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCauseEstimateSummary(estimate: VariantEstimatePayload) {
  return [...estimate.causes
    .flatMap((cause) => [cause.name, cause.estimatedDonationAmount, cause.donationPercentage])];
}

function estimateTotalCost(estimate: VariantEstimatePayload) {
  return [
    estimate.reconciliation.labor,
    estimate.reconciliation.materials,
    estimate.reconciliation.packaging,
    estimate.reconciliation.equipment,
    estimate.reconciliation.pod,
    estimate.reconciliation.mistakeBuffer,
    estimate.reconciliation.artistPayout,
    estimate.reconciliation.shopifyFees,
    estimate.reconciliation.taxReserve,
  ]
    .reduce((sum, amount) => sum + Number(amount), 0)
    .toFixed(2);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const filterProductId = url.searchParams.get("product") ?? "";
  const filterCategory = url.searchParams.get("category") ?? "";
  const filterConfigured = url.searchParams.get("configured") ?? "";

  const [variants, shop, taxOffsetCache] = await Promise.all([
    prisma.variant.findMany({
      where: {
        shopId,
        ...(filterProductId ? { productId: filterProductId } : {}),
        ...(filterCategory ? { product: { productCategoryPath: filterCategory } } : {}),
        ...(filterConfigured === "yes" ? { costConfig: { isNot: null } } : {}),
        ...(filterConfigured === "no" ? { costConfig: { is: null } } : {}),
      },
      orderBy: [{ product: { title: "asc" } }, { title: "asc" }],
      include: {
        product: { select: { id: true, title: true, productCategoryPath: true } },
        costConfig: {
          select: {
            productionTemplate: { select: { name: true } },
          },
        },
        providerMappings: {
          where: { status: "mapped" },
          orderBy: [{ lastCostSyncedAt: "desc" }, { updatedAt: "desc" }],
          select: {
            provider: true,
            lastCostSyncedAt: true,
          },
        },
      },
    }),
    prisma.shop.findUnique({
      where: { shopId },
      select: {
        currency: true,
        paymentRate: true,
        effectiveTaxRate: true,
        taxDeductionMode: true,
      },
    }),
    prisma.taxOffsetCache.findUnique({
      where: { shopId },
      select: {
        widgetTaxSuppressed: true,
      },
    }),
  ]);

  if (!shop) {
    return new Response("Shop not found.", { status: 404 });
  }

  const productIds = [...new Set(variants.map((variant) => variant.productId))];
  const causeAssignments = await prisma.productCauseAssignment.findMany({
    where: {
      shopId,
      productId: { in: productIds },
      cause: {
        status: "active",
      },
    },
    orderBy: [{ percentage: "desc" }, { cause: { name: "asc" } }],
    select: {
      productId: true,
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
  });
  const artistAssignments = await prisma.productArtistAssignment.findMany({
    where: {
      shopId,
      productId: { in: productIds },
      status: "active",
    },
    orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
    select: {
      productId: true,
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
  });
  const causeAssignmentsByProductId = new Map<string, typeof causeAssignments>();
  let maxCauseCount = 0;
  for (const assignment of causeAssignments) {
    if (!assignment.productId) continue;
    const current = causeAssignmentsByProductId.get(assignment.productId) ?? [];
    current.push(assignment);
    maxCauseCount = Math.max(maxCauseCount, current.length);
    causeAssignmentsByProductId.set(assignment.productId, current);
  }
  const artistAssignmentsByProductId = new Map<string, typeof artistAssignments>();
  for (const assignment of artistAssignments) {
    if (!assignment.productId) continue;
    const current = artistAssignmentsByProductId.get(assignment.productId) ?? [];
    current.push(assignment);
    artistAssignmentsByProductId.set(assignment.productId, current);
  }


  const widgetTaxSuppressed = taxOffsetCache?.widgetTaxSuppressed ?? true;
  const rows = await Promise.all(
    variants.map(async (variant) => {
      const estimate = await buildVariantEstimatePayload({
        shopId,
        variant,
        causeAssignments: causeAssignmentsByProductId.get(variant.productId) ?? [],
        artistAssignments: artistAssignmentsByProductId.get(variant.productId) ?? [],
        shop,
        widgetTaxSuppressed,
        db: prisma,
      });

      return [
        variant.product.title,
        variant.product.productCategoryPath ?? "",
        variant.title,
        variant.title != "Default Title" ? `${variant.product.title} - ${variant.title}` : variant.product.title,
        variant.sku ?? "",
        variant.shopifyId,
        estimate.currencyCode,
        estimate.price,
        variant.costConfig?.productionTemplate?.name ?? "",
        Array.from(new Set(variant.providerMappings.map((mapping) => mapping.provider))).join("; "),
        variant.providerMappings[0]?.lastCostSyncedAt?.toISOString() ?? "",
        estimateTotalCost(estimate),
        estimate.reconciliation.labor,
        estimate.reconciliation.materials,
        estimate.reconciliation.packaging,
        estimate.reconciliation.equipment,
        estimate.reconciliation.pod,
        estimate.reconciliation.mistakeBuffer,
        estimate.reconciliation.artistPayout,
        estimate.reconciliation.shopifyFees,
        estimate.reconciliation.taxReserve,
        estimate.reconciliation.allocatedDonations,
        estimate.reconciliation.retainedByShop,
        estimate.reconciliation.remainder,
        estimate.taxReserve.suppressed ? "yes" : "no",
        estimate.taxReserve.estimatedRate,
        ...buildCauseEstimateSummary(estimate),
      ];
    }),
  );

  const causeHeaders = [];
  for(let causeIdx=1;causeIdx <= maxCauseCount;causeIdx++) {
    causeHeaders.push(`Cause ${causeIdx}`, `Cause ${causeIdx} Amt`, `Cause ${causeIdx} Pct`)
  }

  const headers = [
    "Product",
    "Product category",
    "Variant",
    "Full Name",
    "SKU",
    "Shopify variant id",
    "Currency",
    "Estimated sale price",
    "Template",
    "Mapped providers",
    "Latest provider sync at",
    "Estimated total costs",
    "Assembly / labor",
    "Materials",
    "Approx. package cost",
    "Equipment / maintenance",
    "POD fulfillment",
    "Mistake buffer",
    "Artist payout",
    "Approx. Shopify/payment fees",
    "Approx. tax buffer withheld",
    "Approx. assigned donations",
    "Retained / unassigned",
    "Rounding remainder",
    "Tax reserve suppressed",
    "Estimated tax rate",
    ...causeHeaders
  ];
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  return new Response(`${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="variant-estimates.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
