import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncShopifyCharges } from "./chargeSyncService.server";

const { createOrOpenReportingPeriod } = vi.hoisted(() => ({
  createOrOpenReportingPeriod: vi.fn(),
}));

vi.mock("./reportingPeriodService.server", () => ({
  createOrOpenReportingPeriod,
}));

function createResponse(payload: unknown) {
  return {
    json: async () => payload,
  } as Response;
}

describe("syncShopifyCharges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports Shopify Payments balance transactions idempotently", async () => {
    createOrOpenReportingPeriod.mockResolvedValue({ id: "period-1" });

    const admin = {
      graphql: vi.fn().mockResolvedValue(
        createResponse({
          data: {
            shopifyPaymentsAccount: {
              balanceTransactions: {
                pageInfo: { hasNextPage: false },
                edges: [
                  {
                    cursor: "cursor-1",
                    node: {
                      id: "gid://shopify/ShopifyPaymentsBalanceTransaction/1",
                      type: "shipping_label",
                      test: false,
                      transactionDate: "2026-04-07T12:00:00Z",
                      associatedPayout: {
                        id: "gid://shopify/ShopifyPaymentsPayout/900",
                        issuedAt: "2026-04-08T00:00:00Z",
                      },
                      amount: { amount: "-12.00", currencyCode: "USD" },
                      fee: { amount: "-2.50", currencyCode: "USD" },
                      net: { amount: "-14.50", currencyCode: "USD" },
                    },
                  },
                  {
                    cursor: "cursor-2",
                    node: {
                      id: "gid://shopify/ShopifyPaymentsBalanceTransaction/2",
                      type: "adjustment",
                      test: false,
                      transactionDate: "2026-04-07T13:00:00Z",
                      associatedPayout: {
                        id: "gid://shopify/ShopifyPaymentsPayout/900",
                        issuedAt: "2026-04-08T00:00:00Z",
                      },
                      amount: { amount: "-5.00", currencyCode: "USD" },
                      fee: { amount: "0.00", currencyCode: "USD" },
                      net: { amount: "-5.00", currencyCode: "USD" },
                    },
                  },
                  {
                    cursor: "cursor-3",
                    node: {
                      id: "gid://shopify/ShopifyPaymentsBalanceTransaction/3",
                      type: "charge",
                      test: false,
                      transactionDate: "2026-04-07T14:00:00Z",
                      associatedPayout: {
                        id: "gid://shopify/ShopifyPaymentsPayout/900",
                        issuedAt: "2026-04-08T00:00:00Z",
                      },
                      amount: { amount: "20.00", currencyCode: "USD" },
                      net: { amount: "20.00", currencyCode: "USD" },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    };
    const createMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const auditLogCreate = vi.fn().mockResolvedValue(undefined);
    const db = {
      shopifyChargeTransaction: {
        createMany,
      },
      auditLog: {
        create: auditLogCreate,
      },
    };

    const result = await syncShopifyCharges({
      shopId: "shop-1",
      admin,
      payoutId: "900",
      payoutDate: "2026-04-08",
      db: db as any,
    });

    expect(admin.graphql).toHaveBeenCalledWith(
      expect.any(String),
      {
        variables: {
          cursor: null,
          query: "payments_transfer_id:900 payout_date:2026-04-08",
        },
      },
    );
    expect(createOrOpenReportingPeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: "shop-1",
        shopifyPayoutId: "900",
      }),
      db,
    );
    expect(createMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: [
          expect.objectContaining({
            shopifyTransactionId: "gid://shopify/ShopifyPaymentsBalanceTransaction/1",
            shopifyPayoutId: "900",
            amount: expect.objectContaining({ toString: expect.any(Function) }),
            currency: "USD",
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(result).toEqual({ imported: 1, skipped: 2 });
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SHOPIFY_CHARGES_SYNCED",
          payload: expect.objectContaining({
            imported: 1,
            skipped: 2,
          }),
        }),
      }),
    );
  });

  it("paginates balance transactions", async () => {
    createOrOpenReportingPeriod.mockResolvedValue({ id: "period-1" });

    const admin = {
      graphql: vi
        .fn()
        .mockResolvedValueOnce(
          createResponse({
            data: {
              shopifyPaymentsAccount: {
                balanceTransactions: {
                  pageInfo: { hasNextPage: true },
                  edges: [
                    {
                      cursor: "cursor-1",
                      node: {
                        id: "transaction-1",
                        transactionDate: "2026-04-07T12:00:00Z",
                        amount: { amount: "-1.00", currencyCode: "USD" },
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
              shopifyPaymentsAccount: {
                balanceTransactions: {
                  pageInfo: { hasNextPage: false },
                  edges: [
                    {
                      cursor: "cursor-2",
                      node: {
                        id: "transaction-2",
                        transactionDate: "2026-04-07T13:00:00Z",
                        amount: { amount: "-2.00", currencyCode: "USD" },
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
      shopifyChargeTransaction: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };

    await syncShopifyCharges({
      shopId: "shop-1",
      admin,
      since: new Date("2026-04-01T00:00:00Z"),
      db: db as any,
    });

    expect(admin.graphql).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        variables: expect.objectContaining({
          cursor: "cursor-1",
        }),
      }),
    );
  });
});
