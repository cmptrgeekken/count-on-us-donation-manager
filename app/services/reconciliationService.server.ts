import { prisma } from "../db.server";
import { createSnapshot } from "./snapshotService.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ReconciliationOrderNode = {
  id: string;
  name: string | null;
  lineItems: {
    edges: Array<{
      node: {
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
    }>;
  };
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
          lineItems(first: 100) {
            edges {
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
    }
  }
`;

function sevenDaysAgoDateString() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
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
    const response = await admin.graphql(RECONCILIATION_ORDERS_QUERY, {
      variables: {
        cursor,
        searchQuery,
      },
    });

    const payload = await response.json();
    const edges: Array<{ cursor: string; node: ReconciliationOrderNode }> =
      payload?.data?.orders?.edges ?? [];
    const hasNextPage: boolean = payload?.data?.orders?.pageInfo?.hasNextPage ?? false;

    for (const edge of edges) {
      const order = edge.node;
      const result = await createSnapshot(
        shopId,
        {
          admin_graphql_api_id: order.id,
          name: order.name,
          line_items: order.lineItems.edges.map(({ node }) => ({
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
