import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  importHistoricalOrders,
  importHistoricalPayouts,
  persistHistoricalLineItemMappings,
  parseHistoricalImportRows,
  rebuildAllReporting,
  rebuildReportingPeriod,
  replaceOrderSnapshots,
} from "./historicalBackfill.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

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
    expect(summary.errors).toEqual([{
      row: 1,
      message: "Payout ID is missing. Use a Shopify Payments export with the Payout ID column, or add shopifyPayoutId to this row.",
    }]);
    expect(db.reportingPeriod.upsert).not.toHaveBeenCalled();
  });

  it("parses import payloads as JSON arrays", () => {
    expect(parseHistoricalImportRows('[{"id":"payout-1"}]')).toEqual([{ id: "payout-1" }]);
    expect(() => parseHistoricalImportRows('{"id":"payout-1"}')).toThrow("The JSON payload must be an array of rows");
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
        "Name,Id,Created at,Updated at,Financial Status,Cancelled at,Taxes,Lineitem quantity,Lineitem name,Lineitem price,Lineitem sku,Lineitem discount",
        "#1271,6599142604869,2026-04-28 13:34:05 -0500,2026-04-29 10:00:00 -0500,refunded,2026-04-29 09:00:00 -0500,4.46,1,Product A - Blue,25.00,SKU-BLUE,0.00",
        "#1271,,2026-04-28 13:34:05 -0500,,,,,2,Sticker,4.00,,0.50",
      ].join("\n"),
      "orders",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        admin_graphql_api_id: "gid://shopify/Order/6599142604869",
        name: "#1271",
        financial_status: "refunded",
        cancelled_at: "2026-04-29 09:00:00 -0500",
        line_items: [
          expect.objectContaining({ title: "Product A", variant_title: "Blue", sku: "SKU-BLUE" }),
          expect.objectContaining({ title: "Sticker", variant_title: "Default Title", quantity: "2" }),
        ],
      }),
    ]);
  });

  it("retains Shopify totals, lifecycle evidence, and customer identity from continuation CSV rows", () => {
    const rows = parseHistoricalImportRows(
      [
        "Name,Id,Created at,Financial Status,Subtotal,Discount Amount,Shipping,Taxes,Total,Customer,Customer ID,Email,Lineitem quantity,Lineitem name,Lineitem price",
        "#1300,7001,2026-07-01 10:00:00 -0500,,,,,,,,,,1,Product A - Blue,25.00",
        "#1300,,,Paid,25.00,2.00,4.00,1.50,30.50,Jane Merchant,9001,jane@example.com,1,Tip - Default Title,5.00",
      ].join("\n"),
      "orders",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        financial_status: "Paid",
        subtotal_price: "25.00",
        total_discounts: "2.00",
        total_price: "30.50",
        total_tax: "1.50",
        email: "jane@example.com",
        customer: expect.objectContaining({ id: "9001", email: "jane@example.com" }),
        billing_address: expect.objectContaining({ name: "Jane Merchant" }),
      }),
    ]);
  });

  it("reads Shopify lifecycle aliases from an order CSV", () => {
    const rows = parseHistoricalImportRows(
      [
        "Name,Order ID,Payment Status,Order Fulfillment Status,Canceled At,Line item quantity,Line item name,Line item price",
        "#1301,7002,Partially Refunded,Partially Fulfilled,,1,Product A - Blue,25.00",
      ].join("\n"),
      "orders",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        admin_graphql_api_id: "gid://shopify/Order/7002",
        financial_status: "Partially Refunded",
        fulfillment_status: "Partially Fulfilled",
      }),
    ]);
  });

  it("classifies CSV lines by fulfillment eligibility without mapping marketplace fees", () => {
    const rows = parseHistoricalImportRows(
      [
        "Name,Id,Financial Status,Fulfillment Status,Lineitem quantity,Lineitem name,Lineitem price,Lineitem sku,Lineitem fulfillment status",
        "#1302,7003,paid,unfulfilled,1,Product A - Blue,25.00,SKU-BLUE,pending",
        "#1302,,,,1,FAIRE-COMMISSION,-3.75,FAIRE-COMMISSION,not_eligible",
        "#1302,,,,1,Product B - Red,30.00,SKU-RED,fulfilled",
      ].join("\n"),
      "orders",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        line_items: [
          expect.objectContaining({ sku: "SKU-BLUE", importLineKind: "pending" }),
          expect.objectContaining({ sku: "FAIRE-COMMISSION", price: "-3.75", importLineKind: "not_eligible" }),
          expect.objectContaining({ sku: "SKU-RED", importLineKind: "product" }),
        ],
      }),
    ]);
  });

  it("requires Shopify GraphQL order ids for imported order snapshots", async () => {
    const db = {
      orderSnapshot: {
        findFirst: vi.fn(),
      },
    };

    const summary = await importHistoricalOrders({
      shopId: "shop-1",
      rows: [{ id: 123, created_at: "2026-01-02T00:00:00.000Z", line_items: [] }],
      dryRun: true,
      db: db as any,
    });

    expect(summary.created).toBe(0);
    expect(summary.errors).toEqual([{
      row: 1,
      message: "Order ID is missing. Use a Shopify Orders CSV with the ID column, or add admin_graphql_api_id to this JSON row.",
    }]);
    expect(db.orderSnapshot.findFirst).not.toHaveBeenCalled();
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
      orderSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
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
      orderSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
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

  it("uses merchant-selected line mappings when JSON does not provide an import mapping key", async () => {
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
      orderSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
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

  it("reuses persisted CSV line mappings before fuzzy matching", async () => {
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
      orderSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      historicalLineItemMapping: {
        findUnique: vi.fn().mockResolvedValue({
          variant: {
            id: variant.id,
            shopifyId: variant.shopifyId,
            title: variant.title,
            product: { shopifyId: variant.product.shopifyId, title: variant.product.title },
          },
        }),
      },
      variant: {
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
      db: db as any,
    });

    expect(summary.created).toBe(1);
    expect(summary.lineMappingRequests).toBeUndefined();
    expect(db.historicalLineItemMapping.findUnique).toHaveBeenCalledWith({
      where: { shopId_mappingKey: { shopId: "shop-1", mappingKey: "old sticker|default title|" } },
      select: {
        lineKind: true,
        variant: {
          select: { id: true, shopifyId: true, title: true, product: { select: { shopifyId: true, title: true } } },
        },
      },
    });
  });

  it("persists merchant-selected CSV line mappings for future imports", async () => {
    const db = {
      variant: {
        findFirst: vi.fn().mockResolvedValue({ id: "variant-1" }),
      },
      historicalLineItemMapping: {
        upsert: vi.fn(),
      },
    };

    const result = await persistHistoricalLineItemMappings({
      shopId: "shop-1",
      orders: [{
        admin_graphql_api_id: "gid://shopify/Order/1",
        line_items: [{
          title: "Old Sticker",
          variant_title: "Default Title",
          sku: null,
          importMappingKey: "old sticker|default title|",
        }],
      }],
      mappingOverrides: { "old sticker|default title|": "gid://shopify/ProductVariant/1" },
      importBatchId: "batch-1",
      db: db as any,
    });

    expect(result).toEqual({ persisted: 1 });
    expect(db.historicalLineItemMapping.upsert).toHaveBeenCalledWith({
      where: { shopId_mappingKey: { shopId: "shop-1", mappingKey: "old sticker|default title|" } },
      create: expect.objectContaining({
        shopId: "shop-1",
        mappingKey: "old sticker|default title|",
        variantId: "variant-1",
        lineKind: "product",
        firstImportBatchId: "batch-1",
        lastImportBatchId: "batch-1",
      }),
      update: expect.objectContaining({
        variantId: "variant-1",
        lineKind: "product",
        lastImportBatchId: "batch-1",
        useCount: { increment: 1 },
      }),
    });
  });

  it("accepts explicit tip and custom-line handling without product mappings", async () => {
    const db = {
      orderSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      reportingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) },
    };

    const summary = await importHistoricalOrders({
      shopId: "shop-1",
      rows: [{
        admin_graphql_api_id: "gid://shopify/Order/1",
        created_at: "2026-01-02T00:00:00.000Z",
        financial_status: "paid",
        line_items: [
          { title: "Tip", variant_title: "Default Title", importMappingKey: "tip|default title|", quantity: "1", price: "5.00" },
          { title: "Custom engraving", variant_title: "Default Title", importMappingKey: "custom engraving|default title|", quantity: "1", price: "20.00" },
        ],
      }],
      dryRun: true,
      mappingOverrides: {
        "tip|default title|": "__TIP__",
        "custom engraving|default title|": "__CUSTOM__",
      },
      db: db as any,
    });

    expect(summary.created).toBe(1);
    expect(summary.lineMappingRequests).toBeUndefined();
    expect(summary.errors).toEqual([]);
    expect(summary.warnings).toEqual([
      expect.objectContaining({
        message: "Custom line Custom engraving will import with zero recorded production cost and no product-specific routing.",
      }),
    ]);
  });

  it("persists non-product handling choices without a variant relation", async () => {
    const db = {
      variant: { findFirst: vi.fn() },
      historicalLineItemMapping: { upsert: vi.fn() },
    };

    const result = await persistHistoricalLineItemMappings({
      shopId: "shop-1",
      orders: [{
        admin_graphql_api_id: "gid://shopify/Order/1",
        line_items: [{
          title: "Tip",
          variant_title: "Default Title",
          importMappingKey: "tip|default title|",
        }],
      }],
      mappingOverrides: { "tip|default title|": "__TIP__" },
      importBatchId: "batch-1",
      db: db as any,
    });

    expect(result).toEqual({ persisted: 1 });
    expect(db.variant.findFirst).not.toHaveBeenCalled();
    expect(db.historicalLineItemMapping.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ lineKind: "tip", variantId: null }),
      update: expect.objectContaining({ lineKind: "tip", variantId: null }),
    }));
  });

  it("reuses saved tip handling on later imports", async () => {
    const db = {
      orderSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      historicalLineItemMapping: {
        findUnique: vi.fn().mockResolvedValue({ lineKind: "tip", variant: null }),
      },
      reportingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1" }) },
    };

    const summary = await importHistoricalOrders({
      shopId: "shop-1",
      rows: [{
        admin_graphql_api_id: "gid://shopify/Order/2",
        created_at: "2026-01-03T00:00:00.000Z",
        financial_status: "paid",
        line_items: [{
          title: "Tip",
          variant_title: "Default Title",
          importMappingKey: "tip|default title|",
          quantity: "1",
          price: "5.00",
        }],
      }],
      dryRun: true,
      db: db as any,
    });

    expect(summary.created).toBe(1);
    expect(summary.lineMappingRequests).toBeUndefined();
    expect(summary.warnings).toEqual([]);
  });

  it("reconciles a stale replacement variant id through the saved historical mapping", async () => {
    const mappedVariant = {
      id: "variant-current",
      shopifyId: "gid://shopify/ProductVariant/200",
      title: "Default Title",
      costConfig: { id: "cost-1" },
      product: {
        shopifyId: "gid://shopify/Product/200",
        title: "Current Product",
        causeAssignments: [{ id: "cause-assignment-1" }],
        artistAssignments: [],
      },
    };
    const db = {
      orderRecord: {
        findUnique: vi.fn().mockResolvedValue({
          currentSnapshot: {
            id: "snapshot-1",
            orderNumber: "#1300",
            origin: "historical_import",
            periodId: "period-1",
            period: { status: "OPEN" },
            lines: [{ totalCost: decimal(2), netContribution: decimal(8) }],
          },
        }),
      },
      variant: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(mappedVariant),
      },
      historicalLineItemMapping: {
        findUnique: vi.fn().mockResolvedValue({ lineKind: "product", variant: mappedVariant }),
      },
    };

    const summary = await replaceOrderSnapshots({
      shopId: "shop-1",
      rows: [{
        admin_graphql_api_id: "gid://shopify/Order/1300",
        financial_status: "paid",
        line_items: [{
          variant_id: "100",
          title: "Old Product",
          variant_title: "Default Title",
          importMappingKey: "old product|default title|",
          quantity: 1,
          price: "10.00",
        }],
      }],
      dryRun: true,
      replacementReason: "Repair stale variant mapping",
      db: db as any,
    });

    expect(summary.updated).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(summary.lineMappingRequests).toBeUndefined();
  });

  it("blocks snapshot replacement for closed periods unless force replacement is enabled", async () => {
    const existingSnapshot = {
      id: "snapshot-1",
      orderNumber: "#1001",
      origin: "webhook",
      periodId: "period-1",
      period: { status: "CLOSED" },
      lines: [
        { totalCost: decimal("12.50"), netContribution: decimal("37.50") },
        { totalCost: decimal("4.00"), netContribution: decimal("6.00") },
      ],
    };
    const variant = {
      id: "variant-1",
      costConfig: { id: "cost-1" },
      product: {
        causeAssignments: [{ id: "cause-assignment-1" }],
        artistAssignments: [],
      },
    };
    const db = {
      orderSnapshot: { findFirst: vi.fn().mockResolvedValue(existingSnapshot) },
      variant: {
        findMany: vi.fn().mockResolvedValue([{ shopifyId: "gid://shopify/ProductVariant/1" }]),
        findUnique: vi.fn().mockResolvedValue(variant),
      },
    };
    const rows = [{
      admin_graphql_api_id: "gid://shopify/Order/1001",
      name: "#1001",
      line_items: [{
        title: "Sticker",
        variant_id: "gid://shopify/ProductVariant/1",
        quantity: "1",
        price: "50.00",
      }],
    }];

    const blocked = await replaceOrderSnapshots({
      shopId: "shop-1",
      rows,
      dryRun: true,
      forceClosed: false,
      replacementReason: "Refresh costs",
      db: db as any,
    });

    expect(blocked.updated).toBe(0);
    expect(blocked.skipped).toBe(1);
    expect(blocked.errors).toEqual([{
      row: 1,
      message: "This snapshot belongs to a closed period. Review the dry run, enable Force closed-period replacement, enter REPLACE, and rebuild the period afterward.",
    }]);
    expect(blocked.replacementResults).toEqual([
      expect.objectContaining({
        existingSnapshotId: "snapshot-1",
        periodStatus: "CLOSED",
        requiresForce: true,
        status: "blocked",
        totalCost: "16.5",
        netContribution: "43.5",
      }),
    ]);

    const forced = await replaceOrderSnapshots({
      shopId: "shop-1",
      rows,
      dryRun: true,
      forceClosed: true,
      replacementReason: "Refresh costs",
      db: db as any,
    });

    expect(forced.updated).toBe(1);
    expect(forced.skipped).toBe(0);
    expect(forced.errors).toEqual([]);
    expect(forced.replacementResults).toEqual([
      expect.objectContaining({
        existingSnapshotId: "snapshot-1",
        periodStatus: "CLOSED",
        requiresForce: true,
        status: "would_replace",
      }),
    ]);
  });
});

describe("historical backfill rebuild", () => {
  function createRebuildDb(periods = [
    {
      id: "period-1",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-01-15T00:00:00.000Z"),
    },
  ]) {
    const causeAllocationRows = [
      {
        id: "existing-cause-allocation",
        causeId: "cause-1",
        allocated: decimal("25"),
        _count: { applications: 1 },
      },
    ];
    const artistAllocationRows = [
      {
        id: "existing-artist-allocation",
        artistId: "artist-1",
        allocated: decimal("5"),
        _count: { applications: 1 },
      },
    ];
    const tx = {
      orderSnapshot: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      shopifyChargeTransaction: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      orderSettlement: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      analyticalRecalculationRun: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const db = {
      orderRecord: {
        count: vi.fn().mockResolvedValue(0),
      },
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue(periods[0]),
        findMany: vi.fn().mockResolvedValue(periods),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            subtotal: decimal("150"),
            totalCost: decimal("50"),
            netContribution: decimal("100"),
            adjustments: [],
            causeAllocations: [
              {
                causeId: "cause-1",
                causeName: "Cause One",
                is501c3: true,
                amount: decimal("100"),
              },
            ],
          },
        ]),
      },
      shopifyChargeTransaction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("10") } }),
      },
      causeAllocation: {
        findMany: vi.fn().mockImplementation(({ select }) => {
          if ("allocated" in select) {
            return Promise.resolve(causeAllocationRows.map((allocation) => ({
              allocated: allocation.allocated,
            })));
          }
          return Promise.resolve(causeAllocationRows.map((allocation) => ({
            id: allocation.id,
            causeId: allocation.causeId,
            _count: allocation._count,
          })));
        }),
        updateMany: vi.fn().mockImplementation(({ where, data }) => {
          const allocation = causeAllocationRows.find((row) => row.id === where.id);
          if (allocation) allocation.allocated = data.allocated;
          return Promise.resolve({ count: allocation ? 1 : 0 });
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          causeAllocationRows.push({
            id: `created-${data.causeId}`,
            causeId: data.causeId,
            allocated: data.allocated,
            _count: { applications: 0 },
          });
          return Promise.resolve({});
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      lineArtistAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            artistId: "artist-1",
            artistName: "Artist One",
            creditName: "A. One",
            payoutAmount: decimal("15"),
            snapshotLine: {
              netContribution: decimal("100"),
              adjustments: [],
              snapshot: { artistAttribution: null },
            },
          },
        ]),
      },
      artistAllocation: {
        findMany: vi.fn().mockImplementation(({ select }) => {
          if ("allocated" in select) {
            return Promise.resolve(artistAllocationRows.map((allocation) => ({
              allocated: allocation.allocated,
            })));
          }
          return Promise.resolve(artistAllocationRows.map((allocation) => ({
            id: allocation.id,
            artistId: allocation.artistId,
            _count: allocation._count,
          })));
        }),
        updateMany: vi.fn().mockImplementation(({ where, data }) => {
          const allocation = artistAllocationRows.find((row) => row.id === where.id);
          if (allocation) allocation.allocated = data.allocated;
          return Promise.resolve({ count: allocation ? 1 : 0 });
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          artistAllocationRows.push({
            id: `created-${data.artistId}`,
            artistId: data.artistId,
            allocated: data.allocated,
            _count: { applications: 0 },
          });
          return Promise.resolve({});
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };

    return { db, tx };
  }

  it("rebuilds a period without deleting allocation buckets that have payment applications", async () => {
    const { db, tx } = createRebuildDb();

    const result = await rebuildReportingPeriod({ shopId: "shop-1", periodId: "period-1", db: db as any });

    expect(result).toEqual({
      periodId: "period-1",
      periodStartDate: "2026-01-01T00:00:00.000Z",
      periodEndDate: "2026-01-15T00:00:00.000Z",
      before: expect.objectContaining({
        causeAllocationTotal: "25",
        artistPayoutTotal: "5",
        donationPool: "90",
      }),
      after: expect.objectContaining({
        causeAllocationTotal: "100",
        artistPayoutTotal: "15",
        donationPool: "90",
      }),
      delta: expect.objectContaining({
        causeAllocationTotal: "75",
        artistPayoutTotal: "10",
        donationPool: "0",
      }),
    });
    expect(db.causeAllocation.updateMany).toHaveBeenCalledWith({
      where: { id: "existing-cause-allocation", shopId: "shop-1" },
      data: expect.objectContaining({
        allocated: expect.any(Prisma.Decimal),
      }),
    });
    expect(db.artistAllocation.updateMany).toHaveBeenCalledWith({
      where: { id: "existing-artist-allocation", shopId: "shop-1" },
      data: expect.objectContaining({
        allocated: expect.any(Prisma.Decimal),
      }),
    });
    expect(db.causeAllocation.deleteMany).not.toHaveBeenCalled();
    expect(db.artistAllocation.deleteMany).not.toHaveBeenCalled();
    expect(tx.orderSettlement.updateMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        snapshot: {
          currentForOrderRecord: { isNot: null },
          orderRecord: {
            lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } },
          },
          createdAt: {
            gte: new Date("2026-01-01T00:00:00.000Z"),
            lt: new Date("2026-01-15T00:00:00.000Z"),
          },
        },
      },
      data: { periodId: "period-1" },
    });
    expect(tx.orderSettlement.updateMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        periodId: "period-1",
        snapshot: {
          currentForOrderRecord: { isNot: null },
          OR: [
            { createdAt: { lt: new Date("2026-01-01T00:00:00.000Z") } },
            { createdAt: { gte: new Date("2026-01-15T00:00:00.000Z") } },
          ],
        },
      },
      data: { periodId: null },
    });
  });

  it("blocks rebuild before derived obligations can be removed when lifecycle review is pending", async () => {
    const { db, tx } = createRebuildDb();
    db.orderRecord.count.mockResolvedValue(2);

    await expect(rebuildReportingPeriod({
      shopId: "shop-1",
      periodId: "period-1",
      db: db as any,
    })).rejects.toThrow(
      "Reporting rebuild blocked: 2 order(s) in this period require lifecycle review.",
    );

    expect(tx.orderSnapshot.updateMany).not.toHaveBeenCalled();
    expect(db.causeAllocation.updateMany).not.toHaveBeenCalled();
    expect(db.artistAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("rebuilds all periods without requiring payment applications to be dropped first", async () => {
    const { db } = createRebuildDb([
      {
        id: "period-1",
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-01-15T00:00:00.000Z"),
      },
      {
        id: "period-2",
        startDate: new Date("2026-01-15T00:00:00.000Z"),
        endDate: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);

    const result = await rebuildAllReporting({ shopId: "shop-1", db: db as any });

    expect(result).toHaveLength(2);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
});
