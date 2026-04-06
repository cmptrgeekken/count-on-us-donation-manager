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
      graphql: vi
        .fn()
        .mockResolvedValueOnce(
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
                    },
                  },
                  {
                    cursor: "cursor-2",
                    node: {
                      id: "gid://shopify/Order/2",
                      name: "#1002",
                    },
                  },
                ],
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          createResponse({
            data: {
              order: {
                lineItems: {
                  pageInfo: { hasNextPage: false },
                  edges: [
                    {
                      cursor: "line-cursor-1",
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
          }),
        )
        .mockResolvedValueOnce(
          createResponse({
            data: {
              order: {
                lineItems: {
                  pageInfo: { hasNextPage: false },
                  edges: [],
                },
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

  it("paginates order line items so large orders do not truncate reconciliation snapshots", async () => {
    createSnapshot.mockResolvedValueOnce({ created: true, snapshotId: "snapshot-1" });

    const admin = {
      graphql: vi
        .fn()
        .mockResolvedValueOnce(
          createResponse({
            data: {
              orders: {
                pageInfo: { hasNextPage: false },
                edges: [
                  {
                    cursor: "order-cursor-1",
                    node: {
                      id: "gid://shopify/Order/1",
                      name: "#1001",
                    },
                  },
                ],
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          createResponse({
            data: {
              order: {
                lineItems: {
                  pageInfo: { hasNextPage: true },
                  edges: [
                    {
                      cursor: "line-cursor-1",
                      node: {
                        id: "gid://shopify/LineItem/10",
                        title: "First",
                        variantTitle: "Default",
                        quantity: 1,
                        currentUnitPriceSet: { shopMoney: { amount: "10.00" } },
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
          }),
        )
        .mockResolvedValueOnce(
          createResponse({
            data: {
              order: {
                lineItems: {
                  pageInfo: { hasNextPage: false },
                  edges: [
                    {
                      cursor: "line-cursor-2",
                      node: {
                        id: "gid://shopify/LineItem/11",
                        title: "Second",
                        variantTitle: "Default",
                        quantity: 3,
                        currentUnitPriceSet: { shopMoney: { amount: "5.00" } },
                        variant: {
                          id: "gid://shopify/ProductVariant/101",
                          product: { id: "gid://shopify/Product/201" },
                        },
                      },
                    },
                  ],
                },
              },
            },
          }),
        ),
    };

    const db = {
      auditLog: { create: vi.fn().mockResolvedValue(undefined) },
    };

    await runReconciliation("shop-1", admin, db);

    expect(createSnapshot).toHaveBeenCalledWith(
      "shop-1",
      expect.objectContaining({
        line_items: expect.arrayContaining([
          expect.objectContaining({ admin_graphql_api_id: "gid://shopify/LineItem/10" }),
          expect.objectContaining({ admin_graphql_api_id: "gid://shopify/LineItem/11" }),
        ]),
      }),
      db,
      "reconciliation",
    );
    expect(admin.graphql).toHaveBeenCalledTimes(3);
  });

  it("skips orders whose detail query disappears before line items can be loaded", async () => {
    const auditLogCreate = vi.fn().mockResolvedValue(undefined);
    const admin = {
      graphql: vi
        .fn()
        .mockResolvedValueOnce(
          createResponse({
            data: {
              orders: {
                pageInfo: { hasNextPage: false },
                edges: [
                  {
                    cursor: "order-cursor-1",
                    node: {
                      id: "gid://shopify/Order/1",
                      name: "#1001",
                    },
                  },
                ],
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          createResponse({
            data: {
              order: null,
            },
          }),
        ),
    };
    const db = {
      auditLog: { create: auditLogCreate },
    };

    const result = await runReconciliation("shop-1", admin, db);

    expect(result).toEqual({ created: 0, skipped: 1 });
    expect(createSnapshot).not.toHaveBeenCalled();
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "RECONCILIATION_ORDER_SKIPPED_MISSING_DETAIL",
        }),
      }),
    );
  });
});
