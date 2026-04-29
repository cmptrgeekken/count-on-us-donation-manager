import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { resolveCosts } from "./costEngine.server";

const ZERO = new Prisma.Decimal(0);

type OrderLinePayload = {
  id: string;
  quantity: number;
  title: string;
  variantTitle: string | null;
  productId: string | null;
  variantId: string | null;
  discountedTotal: Prisma.Decimal;
  currencyCode: string;
};

type ShopifyOrderPayload = {
  id: string;
  name: string | null;
  lineItems: OrderLinePayload[];
};

type AdminGraphqlLike = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type PostPurchaseDonationSummary =
  | {
      orderId: string;
      status: "confirmed";
      totalDonated: string;
      currencyCode: string;
      causes: Array<{
        causeId: string;
        name: string;
        iconUrl: string | null;
        donationLink: string | null;
        amount: string;
      }>;
    }
  | {
      orderId: string;
      status: "pending";
      estimated: {
        totalDonated: string;
        currencyCode: string;
        causes: Array<{
          causeId: string;
          name: string;
          iconUrl: string | null;
          donationLink: string | null;
          amount: string;
        }>;
      };
    };

function toDecimal(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return ZERO;
  return new Prisma.Decimal(value);
}

function toPerUnitPrice(total: Prisma.Decimal, quantity: number) {
  if (quantity <= 0) return ZERO;
  return total.div(quantity);
}

function formatMoney(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

function normalizeCurrencyCode(lines: OrderLinePayload[], fallback: string | null | undefined) {
  return lines[0]?.currencyCode || fallback || "USD";
}

export async function buildConfirmedOrderDonationSummary(orderId: string, shopId: string, db = prisma) {
  const [snapshot, shop] = await Promise.all([
    db.orderSnapshot.findFirst({
      where: {
        shopId,
        shopifyOrderId: orderId,
      },
      select: {
        lines: {
          select: {
            causeAllocations: {
              select: {
                causeId: true,
                causeName: true,
                amount: true,
                cause: {
                  select: {
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
    db.shop.findUnique({
      where: { shopId },
      select: { currency: true },
    }),
  ]);

  if (!snapshot || !shop) {
    return null;
  }

  const causeMap = new Map<
    string,
    {
      causeId: string;
      name: string;
      iconUrl: string | null;
      donationLink: string | null;
      amount: Prisma.Decimal;
    }
  >();

  for (const line of snapshot.lines) {
    for (const allocation of line.causeAllocations) {
      const current = causeMap.get(allocation.causeId) ?? {
        causeId: allocation.causeId,
        name: allocation.causeName,
        iconUrl: allocation.cause.iconUrl ?? null,
        donationLink: allocation.cause.donationLink ?? null,
        amount: ZERO,
      };

      current.amount = current.amount.add(allocation.amount);
      causeMap.set(allocation.causeId, current);
    }
  }

  const causes = Array.from(causeMap.values())
    .map((cause) => ({
      causeId: cause.causeId,
      name: cause.name,
      iconUrl: cause.iconUrl,
      donationLink: cause.donationLink,
      amount: formatMoney(cause.amount),
    }))
    .sort((left, right) => Number(right.amount) - Number(left.amount) || left.name.localeCompare(right.name));

  const totalDonated = causes.reduce((sum, cause) => sum.add(cause.amount), ZERO);

  return {
    orderId,
    status: "confirmed" as const,
    totalDonated: formatMoney(totalDonated),
    currencyCode: shop.currency,
    causes,
  };
}

export async function fetchOrderForPostPurchaseEstimate(
  orderId: string,
  admin: AdminGraphqlLike,
): Promise<ShopifyOrderPayload | null> {
  const response = await admin.graphql(
    `#graphql
      query PostPurchaseDonationOrder($id: ID!) {
        order(id: $id) {
          id
          name
          lineItems(first: 100) {
            nodes {
              id
              quantity
              title
              variantTitle
              discountedTotalSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              variant {
                id
              }
              product {
                id
              }
            }
          }
        }
      }
    `,
    {
      variables: { id: orderId },
    },
  );

  const json = (await response.json()) as {
    data?: {
      order?: {
        id: string;
        name: string | null;
        lineItems: {
          nodes: Array<{
            id: string;
            quantity: number;
            title: string;
            variantTitle: string | null;
            discountedTotalSet: {
              shopMoney: {
                amount: string;
                currencyCode: string;
              };
            };
            variant: { id: string } | null;
            product: { id: string } | null;
          }>;
        };
      } | null;
    };
  };

  const order = json.data?.order;
  if (!order) return null;

  return {
    id: order.id,
    name: order.name,
    lineItems: order.lineItems.nodes.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      title: line.title,
      variantTitle: line.variantTitle,
      discountedTotal: toDecimal(line.discountedTotalSet.shopMoney.amount),
      currencyCode: line.discountedTotalSet.shopMoney.currencyCode,
      productId: line.product?.id ?? null,
      variantId: line.variant?.id ?? null,
    })),
  };
}

export async function buildPendingOrderDonationSummary(
  order: ShopifyOrderPayload,
  shopId: string,
  db = prisma,
) {
  const shop = await db.shop.findUnique({
    where: { shopId },
    select: { currency: true },
  });
  if (!shop) return null;

  const firstPassResolutions = await Promise.all(
    order.lineItems.map(async (line) => {
      const salePrice = toPerUnitPrice(line.discountedTotal, line.quantity);
      const subtotal = salePrice.mul(line.quantity);

      const variant =
        line.variantId
          ? await db.variant.findFirst({
              where: { shopId, shopifyId: line.variantId },
              select: { id: true },
            })
          : null;

      const firstPass = variant
        ? await resolveCosts(shopId, variant.id, salePrice, "snapshot", db as Parameters<typeof resolveCosts>[4])
        : {
            laborCost: ZERO,
            materialCost: ZERO,
            packagingCost: ZERO,
            equipmentCost: ZERO,
            mistakeBufferAmount: ZERO,
            podCost: ZERO,
            podLines: [],
            podCostEstimated: false,
            podCostMissing: false,
            totalCost: ZERO,
            materialLines: [],
            equipmentLines: [],
            netContribution: salePrice,
          };

      return {
        line,
        variantId: variant?.id ?? null,
        salePrice,
        subtotal,
        firstPass,
      };
    }),
  );

  const orderSubtotal = firstPassResolutions.reduce((sum, line) => sum.add(line.subtotal), ZERO);
  const packagingCost = firstPassResolutions.reduce(
    (max, line) => (line.firstPass.packagingCost.gt(max) ? line.firstPass.packagingCost : max),
    ZERO,
  );

  const causeMap = new Map<
    string,
    {
      causeId: string;
      name: string;
      iconUrl: string | null;
      donationLink: string | null;
      amount: Prisma.Decimal;
    }
  >();

  for (const resolution of firstPassResolutions) {
    if (!resolution.line.productId) continue;

    const packagingAllocated =
      orderSubtotal.gt(ZERO) ? packagingCost.mul(resolution.subtotal).div(orderSubtotal) : ZERO;
    const packagingAllocatedPerUnit =
      resolution.line.quantity > 0 ? packagingAllocated.div(resolution.line.quantity) : ZERO;

    const finalCosts =
      resolution.variantId
        ? await resolveCosts(
            shopId,
            resolution.variantId,
            resolution.salePrice,
            "snapshot",
            db as Parameters<typeof resolveCosts>[4],
            packagingAllocatedPerUnit,
          )
        : {
            ...resolution.firstPass,
            packagingCost: packagingAllocatedPerUnit,
            totalCost: resolution.firstPass.totalCost
              .add(packagingAllocatedPerUnit)
              .sub(resolution.firstPass.packagingCost),
            netContribution: resolution.salePrice.sub(
              resolution.firstPass.totalCost.add(packagingAllocatedPerUnit).sub(resolution.firstPass.packagingCost),
            ),
          };

    const assignments = await db.productCauseAssignment.findMany({
      where: {
        shopId,
        shopifyProductId: resolution.line.productId,
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
            name: true,
            iconUrl: true,
            donationLink: true,
          },
        },
      },
    });

    for (const assignment of assignments) {
      const current = causeMap.get(assignment.causeId) ?? {
        causeId: assignment.causeId,
        name: assignment.cause.name,
        iconUrl: assignment.cause.iconUrl ?? null,
        donationLink: assignment.cause.donationLink ?? null,
        amount: ZERO,
      };
      current.amount = current.amount.add(
        (finalCosts.netContribution ?? ZERO).mul(resolution.line.quantity).mul(assignment.percentage).div(100),
      );
      causeMap.set(assignment.causeId, current);
    }
  }

  if (causeMap.size === 0) {
    return null;
  }

  const causes = Array.from(causeMap.values())
    .map((cause) => ({
      causeId: cause.causeId,
      name: cause.name,
      iconUrl: cause.iconUrl,
      donationLink: cause.donationLink,
      amount: formatMoney(cause.amount),
    }))
    .sort((left, right) => Number(right.amount) - Number(left.amount) || left.name.localeCompare(right.name));

  const totalDonated = causes.reduce((sum, cause) => sum.add(cause.amount), ZERO);

  return {
    orderId: order.id,
    status: "pending" as const,
    estimated: {
      totalDonated: formatMoney(totalDonated),
      currencyCode: normalizeCurrencyCode(order.lineItems, shop.currency),
      causes,
    },
  };
}
