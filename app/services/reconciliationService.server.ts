import { prisma } from "../db.server";
import { createSnapshot } from "./snapshotService.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ReconciliationOrderNode = {
  id: string;
  name: string | null;
};

type ReconciliationLineItemNode = {
  id: string;
  quantity: number;
  currentUnitPriceSet?: {
    shopMoney?: { amount?: string | null } | null;
  } | null;
  variant?: {
    id?: string | null;
    product?: {
      id?: string | null;
    } | null;
  } | null;
  title?: string | null;
  variantTitle?: string | null;
};

const RECONCILIATION_ORDERS_QUERY = `#graphql
  query ReconciliationOrders($cursor: String, $searchQuery: String!) {
    orders(first: 100, after: $cursor, query: $searchQuery, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
      }
      edges {
        cursor
        node {
          id
          name
        }
      }
    }
  }
`;

const RECONCILIATION_ORDER_LINE_ITEMS_QUERY = `#graphql
  query ReconciliationOrderLineItems($orderId: ID!, $cursor: String) {
    order(id: $orderId) {
      lineItems(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
        }
        edges {
          cursor
          node {
            id
            title
            variantTitle
            quantity
            currentUnitPriceSet {
              shopMoney {
                amount
              }
            }
            variant {
              id
              product {
                id
              }
            }
          }
        }
      }
    }
  }
`;

function sevenDaysAgoDateString() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

async function readGraphqlPayload<T>(
  admin: AdminContext,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();

  if (payload?.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${payload.errors[0]?.message ?? "Unknown error"}`);
  }

  return payload as T;
}

async function fetchOrderLineItems(
  admin: AdminContext,
  orderId: string,
): Promise<ReconciliationLineItemNode[] | null> {
  const lineItems: ReconciliationLineItemNode[] = [];
  let cursor: string | null = null;

  do {
    const payload: {
      data?: {
        order?: {
          lineItems?: {
            pageInfo?: { hasNextPage?: boolean };
            edges?: Array<{
              cursor: string;
              node: ReconciliationLineItemNode;
            }>;
          };
        } | null;
      };
    } = await readGraphqlPayload<{
      data?: {
        order?: {
          lineItems?: {
            pageInfo?: { hasNextPage?: boolean };
            edges?: Array<{
              cursor: string;
              node: ReconciliationLineItemNode;
            }>;
          };
        } | null;
      };
    }>(admin, RECONCILIATION_ORDER_LINE_ITEMS_QUERY, { orderId, cursor });

    if (!payload?.data?.order) {
      return null;
    }

    const edges: Array<{ cursor: string; node: ReconciliationLineItemNode }> =
      payload?.data?.order?.lineItems?.edges ?? [];
    lineItems.push(...edges.map((edge) => edge.node));
    const hasNextPage = payload?.data?.order?.lineItems?.pageInfo?.hasNextPage ?? false;
    cursor = hasNextPage ? edges.at(-1)?.cursor ?? null : null;
  } while (cursor);

  return lineItems;
}

export async function runReconciliation(
  shopId: string,
  admin: AdminContext,
  db: any = prisma,
): Promise<{ created: number; skipped: number }> {
  const searchQuery = `created_at:>=${sevenDaysAgoDateString()}`;
  let cursor: string | null = null;
  let created = 0;
  let skipped = 0;

  do {
    const payload: {
      data?: {
        orders?: {
          pageInfo?: { hasNextPage?: boolean };
          edges?: Array<{ cursor: string; node: ReconciliationOrderNode }>;
        };
      };
    } = await readGraphqlPayload<{
      data?: {
        orders?: {
          pageInfo?: { hasNextPage?: boolean };
          edges?: Array<{ cursor: string; node: ReconciliationOrderNode }>;
        };
      };
    }>(admin, RECONCILIATION_ORDERS_QUERY, {
      cursor,
      searchQuery,
    });

    const edges: Array<{ cursor: string; node: ReconciliationOrderNode }> =
      payload?.data?.orders?.edges ?? [];
    const hasNextPage: boolean = payload?.data?.orders?.pageInfo?.hasNextPage ?? false;

    for (const edge of edges) {
      const order = edge.node;
      const lineItems = await fetchOrderLineItems(admin, order.id);
      if (!lineItems) {
        skipped += 1;
        await db.auditLog.create({
          data: {
            shopId,
            entity: "OrderSnapshot",
            entityId: order.id,
            action: "RECONCILIATION_ORDER_SKIPPED_MISSING_DETAIL",
            actor: "system",
            payload: {
              orderId: order.id,
            },
          },
        });
        continue;
      }

      const result = await createSnapshot(
        shopId,
        {
          admin_graphql_api_id: order.id,
          name: order.name,
          line_items: lineItems.map((node) => ({
            admin_graphql_api_id: node.id,
            variant_id: node.variant?.id ?? null,
            product_id: node.variant?.product?.id ?? null,
            title: node.title ?? null,
            variant_title: node.variantTitle ?? null,
            quantity: node.quantity,
            price: node.currentUnitPriceSet?.shopMoney?.amount ?? "0",
          })),
        },
        db,
        "reconciliation",
      );

      if (result.created) {
        created += 1;
      } else {
        skipped += 1;
      }
    }

    cursor = hasNextPage ? edges.at(-1)?.cursor ?? null : null;
  } while (cursor);

  await db.auditLog.create({
    data: {
      shopId,
      entity: "OrderSnapshot",
      action: "RECONCILIATION_RUN_COMPLETED",
      actor: "system",
      payload: {
        created,
        skipped,
        windowDays: 7,
      },
    },
  });

  return { created, skipped };
}
