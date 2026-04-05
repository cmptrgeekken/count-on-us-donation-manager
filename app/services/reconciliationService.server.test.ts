import { beforeEach, describe, expect, it, vi } from "vitest";
import { runReconciliation } from "./reconciliationService.server";

const { createSnapshot } = vi.hoisted(() => ({
  createSnapshot: vi.fn(),
}));

vi.mock("./snapshotService.server", () => ({
  createSnapshot,
}));

function createResponse(payload: unknown) {
  return {
    json: async () => payload,
  } as Response;
}

describe("runReconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates reconciliation-originated snapshots and records the run summary", async () => {
    createSnapshot
      .mockResolvedValueOnce({ created: true, snapshotId: "snapshot-1" })
      .mockResolvedValueOnce({ created: false, snapshotId: "snapshot-2" });

    const admin = {
      graphql: vi.fn().mockResolvedValue(
        createResponse({
          data: {
            orders: {
              pageInfo: { hasNextPage: false },
              edges: [
                {
                  cursor: "cursor-1",
                  node: {
                    id: "gid://shopify/Order/1",
                    name: "#1001",
                    lineItems: {
                      edges: [
                        {
                          node: {
                            id: "gid://shopify/LineItem/10",
                            title: "Tee",
                            variantTitle: "Large",
                            quantity: 2,
                            currentUnitPriceSet: { shopMoney: { amount: "25.00" } },
                            variant: {
                              id: "gid://shopify/ProductVariant/100",
                              product: { id: "gid://shopify/Product/200" },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
                {
                  cursor: "cursor-2",
                  node: {
                    id: "gid://shopify/Order/2",
                    name: "#1002",
                    lineItems: {
                      edges: [],
                    },
                  },
                },
              ],
            },
          },
        }),
      ),
    };

    const auditLogCreate = vi.fn().mockResolvedValue(undefined);
    const db = {
      auditLog: { create: auditLogCreate },
    };

    const result = await runReconciliation("shop-1", admin, db);

    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(createSnapshot).toHaveBeenNthCalledWith(
      1,
      "shop-1",
      expect.objectContaining({
        admin_graphql_api_id: "gid://shopify/Order/1",
      }),
      db,
      "reconciliation",
    );
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "RECONCILIATION_RUN_COMPLETED",
          payload: expect.objectContaining({
            created: 1,
            skipped: 1,
          }),
        }),
      }),
    );
  });
});
