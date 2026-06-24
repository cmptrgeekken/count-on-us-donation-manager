import { describe, expect, it, vi } from "vitest";
import {
  importHistoricalOrders,
  importHistoricalPayouts,
  parseHistoricalImportRows,
  rebuildReportingPeriod,
} from "./historicalBackfill.server";

describe("historical backfill imports", () => {
  it("requires stable payout ids for first-version payout imports", async () => {
    const db = {
      reportingPeriod: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    };

    const summary = await importHistoricalPayouts({
      shopId: "shop-1",
      rows: [{ startDate: "2026-01-01", endDate: "2026-01-15" }],
      dryRun: true,
      db: db as any,
    });

    expect(summary.created).toBe(0);
    expect(summary.errors).toEqual([{ row: 1, message: "Stable payout id is required." }]);
    expect(db.reportingPeriod.upsert).not.toHaveBeenCalled();
  });

  it("parses import payloads as JSON arrays", () => {
    expect(parseHistoricalImportRows('[{"id":"payout-1"}]')).toEqual([{ id: "payout-1" }]);
    expect(() => parseHistoricalImportRows('{"id":"payout-1"}')).toThrow("Import payload must be a JSON array.");
  });

  it("parses Shopify payment transaction CSVs into payout periods", () => {
    const rows = parseHistoricalImportRows(
      [
        "Transaction Date,Type,Order,Payout Date,Payout ID,Amount,Fee,Net,Currency",
        "2026-04-24 08:27:25 -0500,charge,#1270,2026-04-29,108294045765,65.45,2.77,62.68,USD",
        "2026-04-20 16:27:38 -0500,charge,#1269,2026-04-27,108306268229,38.18,1.64,36.54,USD",
        "2026-04-21 17:01:39 -0500,refund,#1269,2026-04-27,108306268229,-5.46,0.00,-5.46,USD",
      ].join("\n"),
      "payouts",
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shopifyPayoutId: "108294045765" }),
        expect.objectContaining({ shopifyPayoutId: "108306268229" }),
      ]),
    );
  });

  it("parses Shopify charges CSVs into charge rows", () => {
    const rows = parseHistoricalImportRows(
      [
        "Bill #,Charge category,Description,Amount,Currency,Date,Order",
        '"",shipping_fee,"Ground Advantage to Hopkins, Minnesota",4.78,USD,,#1267',
      ].join("\n"),
      "charges",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        transactionType: "shipping_fee",
        description: "Ground Advantage to Hopkins, Minnesota (#1267)",
        amount: "4.78",
        currency: "USD",
      }),
    ]);
  });

  it("parses Shopify orders CSVs into grouped order payloads", () => {
    const rows = parseHistoricalImportRows(
      [
        "Name,Id,Created at,Taxes,Lineitem quantity,Lineitem name,Lineitem price,Lineitem sku,Lineitem discount",
        "#1271,6599142604869,2026-04-28 13:34:05 -0500,4.46,1,Product A - Blue,25.00,SKU-BLUE,0.00",
        "#1271,,2026-04-28 13:34:05 -0500,,2,Sticker,4.00,,0.50",
      ].join("\n"),
      "orders",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        admin_graphql_api_id: "gid://shopify/Order/6599142604869",
        name: "#1271",
        line_items: [
          expect.objectContaining({ title: "Product A", variant_title: "Blue", sku: "SKU-BLUE" }),
          expect.objectContaining({ title: "Sticker", variant_title: "Default Title", quantity: "2" }),
        ],
      }),
    ]);
  });

  it("requires Shopify GraphQL order ids for imported order snapshots", async () => {
    const db = {
      orderSnapshot: {
        findUnique: vi.fn(),
      },
    };

    const summary = await importHistoricalOrders({
      shopId: "shop-1",
      rows: [{ id: 123, created_at: "2026-01-02T00:00:00.000Z", line_items: [] }],
      dryRun: true,
      db: db as any,
    });

    expect(summary.created).toBe(0);
    expect(summary.errors).toEqual([{ row: 1, message: "Order admin_graphql_api_id is required." }]);
    expect(db.orderSnapshot.findUnique).not.toHaveBeenCalled();
  });

  it("matches renamed CSV order products by normalized product and variant titles", async () => {
    const variant = {
      id: "variant-1",
      shopifyId: "gid://shopify/ProductVariant/1",
      title: "Blue",
      costConfig: { id: "cost-1" },
      product: {
        shopifyId: "gid://shopify/Product/1",
        title: "New Product A",
        causeAssignments: [{ id: "cause-assignment-1" }],
        artistAssignments: [],
      },
    };
    const db = {
      orderSnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
      variant: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([variant]),
        findFirst: vi.fn().mockResolvedValue({
          shopifyId: variant.shopifyId,
          product: { shopifyId: variant.product.shopifyId },
        }),
        findUnique: vi.fn().mockResolvedValue(variant),
      },
      reportingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) },
    };

    const summary = await importHistoricalOrders({
      shopId: "shop-1",
      rows: [{
        admin_graphql_api_id: "gid://shopify/Order/1",
        created_at: "2026-01-02T00:00:00.000Z",
        line_items: [{
          title: "Product A",
          variant_title: "Blue",
          quantity: "1",
          price: "10.00",
        }],
      }],
      dryRun: true,
      db: db as any,
    });

    expect(summary.created).toBe(1);
    expect(summary.lineMappingRequests).toBeUndefined();
    expect(summary.errors).toEqual([]);
  });

  it("surfaces ambiguous CSV order line mappings for merchant selection", async () => {
    const candidates = [
      {
        shopifyId: "gid://shopify/ProductVariant/1",
        title: "Default Title",
        product: { shopifyId: "gid://shopify/Product/1", title: "Sticker" },
      },
      {
        shopifyId: "gid://shopify/ProductVariant/2",
        title: "Default Title",
        product: { shopifyId: "gid://shopify/Product/2", title: "Sticker Pack" },
      },
    ];
    const db = {
      orderSnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
      variant: {
        findMany: vi.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(candidates),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      reportingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) },
    };

    const summary = await importHistoricalOrders({
      shopId: "shop-1",
      rows: [{
        admin_graphql_api_id: "gid://shopify/Order/1",
        created_at: "2026-01-02T00:00:00.000Z",
        line_items: [{
          title: "Sticker",
          variant_title: "Default Title",
          importMappingKey: "sticker|default title|",
          quantity: "1",
          price: "10.00",
        }],
      }],
      dryRun: true,
      db: db as any,
    });

    expect(summary.lineMappingRequests).toEqual([
      expect.objectContaining({
        key: "sticker|default title|",
        reason: "ambiguous",
        candidates: [
          expect.objectContaining({ shopifyVariantId: "gid://shopify/ProductVariant/1" }),
          expect.objectContaining({ shopifyVariantId: "gid://shopify/ProductVariant/2" }),
        ],
      }),
    ]);
  });

  it("uses merchant-selected CSV line mappings before import", async () => {
    const variant = {
      id: "variant-1",
      shopifyId: "gid://shopify/ProductVariant/1",
      title: "Default Title",
      costConfig: { id: "cost-1" },
      product: {
        shopifyId: "gid://shopify/Product/1",
        title: "Current Sticker",
        causeAssignments: [{ id: "cause-assignment-1" }],
        artistAssignments: [],
      },
    };
    const db = {
      orderSnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
      variant: {
        findFirst: vi.fn().mockResolvedValue({
          shopifyId: variant.shopifyId,
          title: variant.title,
          product: { shopifyId: variant.product.shopifyId, title: variant.product.title },
        }),
        findUnique: vi.fn().mockResolvedValue(variant),
      },
      reportingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) },
    };

    const summary = await importHistoricalOrders({
      shopId: "shop-1",
      rows: [{
        admin_graphql_api_id: "gid://shopify/Order/1",
        created_at: "2026-01-02T00:00:00.000Z",
        line_items: [{
          title: "Old Sticker",
          variant_title: "Default Title",
          importMappingKey: "old sticker|default title|",
          quantity: "1",
          price: "10.00",
        }],
      }],
      dryRun: true,
      mappingOverrides: { "old sticker|default title|": "gid://shopify/ProductVariant/1" },
      db: db as any,
    });

    expect(summary.created).toBe(1);
    expect(summary.lineMappingRequests).toBeUndefined();
    expect(summary.errors).toEqual([]);
  });
});

describe("historical backfill rebuild", () => {
  it("refuses to rebuild periods with payment applications", async () => {
    const db = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          id: "period-1",
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: new Date("2026-01-15T00:00:00.000Z"),
        }),
      },
      disbursementApplication: {
        count: vi.fn().mockResolvedValue(1),
      },
      artistPaymentApplication: {
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn(),
    };

    await expect(
      rebuildReportingPeriod({ shopId: "shop-1", periodId: "period-1", db: db as any }),
    ).rejects.toThrow("This period has payment applications.");

    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
