import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSnapshot } from "./snapshotService.server";

const {
  resolveCosts,
  recomputeTaxOffsetCache,
  jobQueueSend,
  mergeOrderLifecycle,
  reconcileLifecycleAdjustmentsForSnapshot,
} = vi.hoisted(() => ({
  resolveCosts: vi.fn(),
  recomputeTaxOffsetCache: vi.fn(),
  jobQueueSend: vi.fn(),
  mergeOrderLifecycle: vi.fn(),
  reconcileLifecycleAdjustmentsForSnapshot: vi.fn(),
}));

vi.mock("./costEngine.server", () => ({
  resolveCosts,
}));

vi.mock("./taxOffsetCache.server", () => ({
  recomputeTaxOffsetCache,
}));

vi.mock("../jobs/queue.server", () => ({
  jobQueue: {
    send: jobQueueSend,
  },
}));

vi.mock("./orderLifecycle.server", () => ({
  mergeOrderLifecycle,
  reconcileLifecycleAdjustmentsForSnapshot,
}));

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

function createDb({
  existingSnapshot = null,
  orderSnapshotCreateImpl,
  variant = { id: "variant-1", shopifyId: "gid://shopify/ProductVariant/100" },
  providerMappings = [],
  productRoutingMode = "automatic",
  productArtistAssignments = [],
}: {
  existingSnapshot?: unknown | null;
  orderSnapshotCreateImpl?: () => unknown;
  variant?: unknown;
  providerMappings?: unknown[];
  productRoutingMode?: string;
  productArtistAssignments?: unknown[];
} = {}) {
  const orderSnapshotCreate = orderSnapshotCreateImpl
    ? vi.fn().mockImplementation(orderSnapshotCreateImpl)
    : vi.fn().mockResolvedValue({ id: "snapshot-1" });
  const orderSnapshotLineCreate = vi.fn().mockResolvedValue({ id: "snapshot-line-1" });
  const materialLineCreateMany = vi.fn().mockResolvedValue(undefined);
  const equipmentLineCreate = vi.fn().mockResolvedValue({ id: "snapshot-equipment-line-1" });
  const equipmentConsumableLineCreateMany = vi.fn().mockResolvedValue(undefined);
  const podLineCreateMany = vi.fn().mockResolvedValue(undefined);
  const causeAllocationCreateMany = vi.fn().mockResolvedValue(undefined);
  const artistAllocationCreateMany = vi.fn().mockResolvedValue(undefined);
  const orderSettlementUpsert = vi.fn().mockResolvedValue(undefined);
  const auditLogCreate = vi.fn().mockResolvedValue(undefined);
  const variantCostConfigFindFirst = vi
    .fn()
    .mockResolvedValueOnce({ laborMinutes: decimal("3") })
    .mockResolvedValueOnce({ laborRate: decimal("60") });

  const tx = {
    orderSnapshot: { create: orderSnapshotCreate },
    orderSnapshotLine: { create: orderSnapshotLineCreate },
    orderSnapshotMaterialLine: { createMany: materialLineCreateMany },
    orderSnapshotEquipmentLine: { create: equipmentLineCreate },
    orderSnapshotEquipmentConsumableLine: { createMany: equipmentConsumableLineCreateMany },
    orderSnapshotPODLine: { createMany: podLineCreateMany },
    lineCauseAllocation: { createMany: causeAllocationCreateMany },
    lineArtistAllocation: { createMany: artistAllocationCreateMany },
    orderSettlement: { upsert: orderSettlementUpsert },
    variantCostConfig: { findFirst: variantCostConfigFindFirst },
    auditLog: { create: auditLogCreate },
  };

  return {
    orderSnapshot: {
      findFirst: vi.fn().mockResolvedValue(existingSnapshot),
    },
    shop: {
      findUnique: vi.fn().mockResolvedValue({
        currency: "USD",
      }),
    },
    variant: {
      findMany: vi.fn().mockResolvedValue(
        variant && typeof variant === "object" && variant !== null && "shopifyId" in variant ? [variant] : [],
      ),
      findFirst: vi.fn().mockResolvedValue(variant),
    },
    product: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "product-1",
          shopifyId: "gid://shopify/Product/200",
          donationRoutingMode: productRoutingMode,
        },
      ]),
    },
    providerVariantMapping: {
      findMany: vi.fn().mockResolvedValue(providerMappings),
    },
    productCauseAssignment: {
      findMany: vi.fn().mockResolvedValue([
        {
          causeId: "cause-1",
          percentage: decimal("50"),
          cause: {
            id: "cause-1",
            name: "Cause One",
            is501c3: true,
          },
        },
      ]),
    },
    productArtistAssignment: {
      findMany: vi.fn().mockResolvedValue(productArtistAssignments),
    },
    $transaction: vi.fn().mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
    __spies: {
      orderSnapshotCreate,
      orderSnapshotLineCreate,
      materialLineCreateMany,
      equipmentLineCreate,
      equipmentConsumableLineCreateMany,
      podLineCreateMany,
      causeAllocationCreateMany,
      artistAllocationCreateMany,
      orderSettlementUpsert,
      auditLogCreate,
      tx,
    },
  };
}

describe("createSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mergeOrderLifecycle.mockResolvedValue({ state: "active", updated: true });
    reconcileLifecycleAdjustmentsForSnapshot.mockResolvedValue({ created: 0, unresolved: [] });
  });

  it("returns early when a snapshot already exists for the order", async () => {
    const db = createDb({ existingSnapshot: { id: "existing-snapshot" } });

    const result = await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/1",
        line_items: [],
      },
      db,
    );

    expect(result).toEqual({ created: false, snapshotId: "existing-snapshot" });
    expect(resolveCosts).not.toHaveBeenCalled();
  });

  it("keeps tips out of discounts, packaging, costs, and donation contribution", async () => {
    const db = createDb({ variant: null });

    await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/1",
        subtotal_price: "18.00",
        line_items: [
          {
            id: "custom-line",
            title: "Custom engraving",
            variant_title: "Default Title",
            importLineKind: "custom",
            quantity: 1,
            price: "20.00",
          },
          {
            id: "tip-line",
            title: "Tip",
            variant_title: "Default Title",
            importLineKind: "tip",
            quantity: 1,
            price: "5.00",
          },
        ],
      },
      db,
    );

    expect(resolveCosts).not.toHaveBeenCalled();
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        lineKind: "custom",
        subtotal: decimal("18"),
        totalCost: decimal("0"),
        packagingCost: decimal("0"),
        netContribution: decimal("18"),
      }),
    });
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        lineKind: "tip",
        subtotal: decimal("5"),
        totalCost: decimal("0"),
        packagingCost: decimal("0"),
        netContribution: decimal("0"),
      }),
    });
  });

  it("does not apply a shipping discount to merchandise when Shopify subtotal is unchanged", async () => {
    const db = createDb({ variant: null });

    await createSnapshot("shop-1", {
      admin_graphql_api_id: "gid://shopify/Order/shipping-discount",
      subtotal_price: "15.00",
      total_discounts: "5.00",
      total_shipping_price_set: { shop_money: { amount: "5.00" } },
      total_price: "16.28",
      total_tax: "1.28",
      line_items: [{
        id: "line-1",
        title: "Earrings",
        quantity: 1,
        price: "15.00",
        importLineKind: "custom",
      }],
    }, db);

    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ subtotal: decimal("15"), netContribution: decimal("15") }),
    });
  });

  it("uses the webhook current subtotal after refunds without deducting the refund twice", async () => {
    const db = createDb({ variant: null });

    await createSnapshot("shop-1", {
      admin_graphql_api_id: "gid://shopify/Order/partially-refunded",
      financial_status: "partially_refunded",
      subtotal_price: "25.00",
      current_subtotal_price: "17.50",
      refunded_amount: "7.50",
      line_items: [{
        id: "line-1",
        title: "Earrings",
        quantity: 1,
        price: "25.00",
        importLineKind: "custom",
      }],
    }, db);

    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ subtotal: decimal("17.5"), netContribution: decimal("17.5") }),
    });
    expect(db.__spies.orderSnapshotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ subtotalAmount: decimal("17.5") }),
    });
  });

  it("subtracts not-eligible marketplace fees once from fulfilled-line donation allocations", async () => {
    const costResult = {
      laborCost: decimal("0"),
      materialCost: decimal("0"),
      packagingCost: decimal("0"),
      equipmentCost: decimal("0"),
      mistakeBufferAmount: decimal("0"),
      podCost: decimal("0"),
      podLines: [],
      podCostEstimated: false,
      podCostMissing: false,
      totalCost: decimal("0"),
      netContribution: decimal("100"),
      materialLines: [],
      equipmentLines: [],
    };
    resolveCosts.mockResolvedValue(costResult);
    const db = createDb();

    await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/faire",
        line_items: [
          {
            id: "fulfilled-line",
            variant_id: 100,
            product_id: 200,
            title: "Product",
            quantity: 1,
            price: "100.00",
            importLineKind: "product",
          },
          {
            id: "faire-fee",
            title: "FAIRE-COMMISSION",
            quantity: 1,
            price: "-10.00",
            importLineKind: "not_eligible",
          },
        ],
      },
      db,
    );

    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        lineKind: "not_eligible",
        subtotal: decimal("-10"),
        netContribution: decimal("-10"),
      }),
    });
    expect(db.__spies.causeAllocationCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ amount: decimal("45") })],
    });
  });

  it("reconciles signed Faire fees from the Shopify subtotal without turning them into revenue", async () => {
    const db = createDb();
    const zeroCostResult = {
      laborCost: decimal("0"),
      materialCost: decimal("0"),
      packagingCost: decimal("0"),
      equipmentCost: decimal("0"),
      mistakeBufferAmount: decimal("0"),
      podCost: decimal("0"),
      podLines: [],
      podCostEstimated: false,
      podCostMissing: false,
      totalCost: decimal("0"),
      netContribution: decimal("180"),
      materialLines: [],
      equipmentLines: [],
    };
    resolveCosts.mockResolvedValue(zeroCostResult);

    await createSnapshot("shop-1", {
      admin_graphql_api_id: "gid://shopify/Order/faire-exact",
      subtotal_price: "138.38",
      total_discounts: "5.00",
      line_items: [
        {
          id: "merchandise",
          variant_id: 100,
          product_id: 200,
          title: "Faire merchandise",
          quantity: 1,
          price: "185.00",
          importLineKind: "product",
        },
        {
          id: "commission",
          title: "Faire commission",
          quantity: 1,
          price: "-37.00",
          importLineKind: "not_eligible",
        },
        {
          id: "processing-fee",
          title: "Faire payment processing fee",
          quantity: 1,
          price: "-4.62",
          importLineKind: "not_eligible",
        },
      ],
    }, db);

    expect(db.__spies.orderSnapshotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ subtotalAmount: decimal("138.38") }),
    });
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ subtotal: decimal("180"), netContribution: decimal("180") }),
    });
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ subtotal: decimal("-37"), netContribution: decimal("-37") }),
    });
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenNthCalledWith(3, {
      data: expect.objectContaining({ subtotal: decimal("-4.62"), netContribution: decimal("-4.62") }),
    });
    expect(db.__spies.causeAllocationCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ amount: decimal("69.19") })],
    });
  });

  it("uses native Shopify line fulfillment evidence for webhook snapshots", async () => {
    const db = createDb();
    resolveCosts.mockResolvedValue({
      laborCost: decimal("0"), materialCost: decimal("0"), packagingCost: decimal("0"),
      equipmentCost: decimal("0"), mistakeBufferAmount: decimal("0"), podCost: decimal("0"),
      podLines: [], podCostEstimated: false, podCostMissing: false, totalCost: decimal("0"),
      netContribution: decimal("20"), materialLines: [], equipmentLines: [],
    });

    await createSnapshot("shop-1", {
      admin_graphql_api_id: "gid://shopify/Order/native-status",
      line_items: [
        {
          id: "fulfilled",
          variant_id: 100,
          product_id: 200,
          title: "Fulfilled product",
          quantity: 1,
          price: "20",
          fulfillment_status: "fulfilled",
          fulfillable_quantity: 0,
        },
        {
          id: "pending",
          variant_id: 100,
          product_id: 200,
          title: "Pending product",
          quantity: 1,
          price: "20",
          fulfillment_status: null,
          fulfillable_quantity: 1,
        },
        {
          id: "fee",
          title: "FAIRE-COMMISSION",
          quantity: 1,
          price: "-5",
          fulfillment_status: null,
          fulfillable_quantity: 0,
        },
      ],
    }, db, "webhook");

    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ lineKind: "product" }),
    });
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ lineKind: "pending" }),
    });
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenNthCalledWith(3, {
      data: expect.objectContaining({ lineKind: "not_eligible", netContribution: decimal("-5") }),
    });
    expect(db.__spies.causeAllocationCreateMany).toHaveBeenCalledTimes(1);
    expect(db.__spies.causeAllocationCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ amount: decimal("7.5") })],
    });
  });

  it("derives snapshot totals from positive line evidence when imported order totals are unreliable zeros", async () => {
    const db = createDb({ variant: null });

    await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/2",
        subtotal_price: "0",
        total_price: "0",
        billing_address: { name: "Jane Merchant" },
        line_items: [{ id: "line-1", title: "Custom", quantity: 1, price: "25.00", importLineKind: "custom" }],
      },
      db,
    );

    expect(db.__spies.orderSnapshotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerDisplayName: "Jane Merchant",
        subtotalAmount: decimal("25"),
        totalAmount: decimal("25"),
      }),
    });
  });

  it("reconciles lifecycle evidence when reconciliation finds an existing snapshot", async () => {
    const db = createDb();
    Object.assign(db, {
      orderRecord: {
        findUnique: vi.fn().mockResolvedValue({
          id: "order-record-1",
          currentSnapshotId: "snapshot-1",
          currentSnapshot: {
            id: "snapshot-1",
            revision: 1,
            orderRecordId: "order-record-1",
            periodId: null,
            salesTaxCollected: decimal("0"),
          },
        }),
      },
      orderLifecycle: { upsert: vi.fn() },
    });

    const result = await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/1",
        financial_status: "refunded",
        updated_at: "2026-07-14T12:00:00.000Z",
        line_items: [],
      },
      db as never,
      "reconciliation",
    );

    expect(result).toEqual({ created: false, snapshotId: "snapshot-1" });
    expect(mergeOrderLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ orderRecordId: "order-record-1", source: "reconciliation" }),
    );
    expect(reconcileLifecycleAdjustmentsForSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: "snapshot-1" }),
    );
    expect(db.__spies.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "ORDER_LIFECYCLE_RECONCILED" }),
    });
  });

  it("replaces the current snapshot by appending a revision and moving the current pointer", async () => {
    const db = createDb({
      existingSnapshot: {
        id: "snapshot-1",
        revision: 1,
        orderRecordId: "order-record-1",
        periodId: "period-1",
        salesTaxCollected: decimal("0"),
      },
      orderSnapshotCreateImpl: () => ({ id: "snapshot-2" }),
    });
    const tx = db.__spies.tx as typeof db.__spies.tx & {
      orderRecord: { upsert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
      orderLifecycle: { upsert: ReturnType<typeof vi.fn> };
      reportingPeriod: { updateMany: ReturnType<typeof vi.fn> };
    };
    tx.orderRecord = {
      upsert: vi.fn().mockResolvedValue({ id: "order-record-1", currentSnapshotId: "snapshot-1" }),
      update: vi.fn().mockResolvedValue({ id: "order-record-1" }),
    };
    tx.orderLifecycle = { upsert: vi.fn() };
    tx.reportingPeriod = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
    Object.assign(db, {
      orderRecord: {
        findUnique: vi.fn().mockResolvedValue({
          id: "order-record-1",
          currentSnapshotId: "snapshot-1",
          currentSnapshot: {
            id: "snapshot-1",
            revision: 1,
            orderRecordId: "order-record-1",
            periodId: "period-1",
            salesTaxCollected: decimal("0"),
          },
        }),
      },
    });

    const result = await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/1",
        financial_status: "paid",
        line_items: [],
      },
      db as never,
      "historical_import",
      fetch,
      {
        replaceExistingSnapshotId: "snapshot-1",
        replacementReason: "Rebuild with corrected costs",
        replacementSource: "merchant_rebuild",
      },
    );

    expect(result).toEqual({ created: true, snapshotId: "snapshot-2" });
    expect(db.__spies.orderSnapshotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderRecordId: "order-record-1",
        revision: 2,
        replacementSource: "merchant_rebuild",
        replacementReason: "Rebuild with corrected costs",
      }),
    });
    expect(tx.orderRecord.update).toHaveBeenCalledWith({
      where: { id: "order-record-1", shopId: "shop-1" },
      data: { currentSnapshotId: "snapshot-2" },
    });
    expect(reconcileLifecycleAdjustmentsForSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        orderRecordId: "order-record-1",
        snapshotId: "snapshot-2",
      }),
    );
    expect(tx.reportingPeriod.updateMany).toHaveBeenCalledWith({
      where: { id: "period-1", shopId: "shop-1" },
      data: {
        rebuildRequired: true,
        rebuildRequestedAt: expect.any(Date),
      },
    });
  });

  it("creates an external settlement review for marketplace orders paid outside Shopify", async () => {
    const db = createDb();
    resolveCosts.mockResolvedValue({
      laborCost: decimal("1"),
      materialCost: decimal("2"),
      packagingCost: decimal("0"),
      equipmentCost: decimal("0"),
      podCost: decimal("0"),
      mistakeBufferAmount: decimal("0"),
      totalCost: decimal("3"),
      netContribution: decimal("47"),
      materialLines: [],
      equipmentLines: [],
      podLines: [],
    });

    await createSnapshot("shop-1", {
      admin_graphql_api_id: "gid://shopify/Order/1001",
      name: "#1001",
      source_name: "Faire",
      financial_status: "paid",
      currency: "USD",
      total_price: "480.00",
      total_received: "0.00",
      line_items: [{
        id: "line-1",
        admin_graphql_api_id: "gid://shopify/LineItem/1",
        variant_id: 100,
        product_id: 200,
        title: "Wholesale Sticker",
        variant_title: "Default Title",
        quantity: 1,
        price: "50.00",
      }],
    }, db as any);

    expect(db.__spies.orderSettlementUpsert).toHaveBeenCalledWith({
      where: {
        shopId_shopifyOrderId: {
          shopId: "shop-1",
          shopifyOrderId: "gid://shopify/Order/1001",
        },
      },
      create: expect.objectContaining({
        shopId: "shop-1",
        snapshotId: "snapshot-1",
        shopifyOrderId: "gid://shopify/Order/1001",
        orderNumber: "#1001",
        source: "faire",
        status: "needs_review",
        grossOrderAmount: decimal("480"),
        shopifyPaidAmount: decimal("0"),
        feeAmount: decimal("0"),
        currency: "USD",
      }),
      update: expect.objectContaining({
        snapshotId: "snapshot-1",
        grossOrderAmount: decimal("480"),
        shopifyPaidAmount: decimal("0"),
        currency: "USD",
      }),
    });
  });

  it("persists snapshot line totals scaled by quantity and writes cause allocations", async () => {
    resolveCosts
      .mockResolvedValueOnce({
        laborCost: decimal("10"),
        materialCost: decimal("20"),
        packagingCost: decimal("4"),
        equipmentCost: decimal("3"),
        mistakeBufferAmount: decimal("2"),
        podCost: decimal("0"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("39"),
        netContribution: decimal("11"),
        materialLines: [
          {
            materialId: "material-1",
            name: "Fabric",
            type: "production",
            costingModel: "yield",
            quantity: decimal("2"),
            yield: decimal("1"),
            usesPerVariant: null,
            lineCost: decimal("20"),
            purchasePrice: decimal("12"),
            purchaseQty: decimal("1"),
            perUnitCost: decimal("12"),
          },
        ],
        equipmentLines: [
          {
            equipmentId: "equipment-1",
            name: "Press",
            minutes: decimal("5"),
            uses: null,
            lineCost: decimal("3"),
            hourlyRate: decimal("36"),
            perUseCost: null,
            hourlyRateMode: "calculated",
            perUseCostMode: "manual",
            componentCosts: {
              electricityCost: decimal("0.25"),
              depreciationCost: decimal("1"),
              consumablesCost: decimal("1.75"),
              maintenanceCost: decimal("0"),
              manualOverrideCost: decimal("0"),
            },
            consumableLines: [
              {
                consumableId: "filter-1",
                name: "Pre-filter",
                lifespanUnit: "hours",
                lineCost: decimal("1.75"),
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        laborCost: decimal("10"),
        materialCost: decimal("20"),
        packagingCost: decimal("2"),
        equipmentCost: decimal("3"),
        mistakeBufferAmount: decimal("2"),
        podCost: decimal("0"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("37"),
        netContribution: decimal("13"),
        materialLines: [
          {
            materialId: "material-1",
            name: "Fabric",
            type: "production",
            costingModel: "yield",
            quantity: decimal("2"),
            yield: decimal("1"),
            usesPerVariant: null,
            lineCost: decimal("20"),
            purchasePrice: decimal("12"),
            purchaseQty: decimal("1"),
            perUnitCost: decimal("12"),
          },
        ],
        equipmentLines: [
          {
            equipmentId: "equipment-1",
            name: "Press",
            minutes: decimal("5"),
            uses: null,
            lineCost: decimal("3"),
            hourlyRate: decimal("36"),
            perUseCost: null,
            hourlyRateMode: "calculated",
            perUseCostMode: "manual",
            componentCosts: {
              electricityCost: decimal("0.25"),
              depreciationCost: decimal("1"),
              consumablesCost: decimal("1.75"),
              maintenanceCost: decimal("0"),
              manualOverrideCost: decimal("0"),
            },
            consumableLines: [
              {
                consumableId: "filter-1",
                name: "Pre-filter",
                lifespanUnit: "hours",
                lineCost: decimal("1.75"),
              },
            ],
          },
        ],
      });

    const db = createDb();

    const result = await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/1",
        name: "#1001",
        current_total_tax: "8.25",
        line_items: [
          {
            admin_graphql_api_id: "gid://shopify/LineItem/10",
            variant_id: 100,
            product_id: 200,
            title: "Tee",
            variant_title: "Large",
            quantity: 2,
            price: "50",
          },
        ],
      },
      db,
    );

    expect(result).toEqual({ created: true, snapshotId: "snapshot-1" });
    expect(db.variant.findMany).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        shopifyId: { in: ["gid://shopify/ProductVariant/100"] },
      },
      select: { id: true, shopifyId: true },
    });
    expect(db.__spies.orderSnapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          salesTaxCollected: decimal("8.25"),
        }),
      }),
    );
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 2,
          subtotal: decimal("100"),
          laborCost: decimal("20"),
          materialCost: decimal("40"),
          packagingCost: decimal("4"),
          equipmentCost: decimal("6"),
          mistakeBufferAmount: decimal("4"),
          totalCost: decimal("74"),
          netContribution: decimal("26"),
          laborMinutes: decimal("6"),
          laborRate: decimal("60"),
        }),
      }),
    );
    expect(db.__spies.materialLineCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            quantity: decimal("4"),
            lineCost: decimal("40"),
          }),
        ],
      }),
    );
    expect(db.__spies.equipmentLineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hourlyRateMode: "calculated",
          perUseCostMode: "manual",
          electricityCost: decimal("0.5"),
          depreciationCost: decimal("2"),
          consumablesCost: decimal("3.5"),
          manualOverrideCost: decimal("0"),
          lineCost: decimal("6"),
        }),
      }),
    );
    expect(db.__spies.equipmentConsumableLineCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            consumableId: "filter-1",
            consumableName: "Pre-filter",
            lifespanUnit: "hours",
            lineCost: decimal("3.5"),
          }),
        ],
      }),
    );
    expect(db.__spies.causeAllocationCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            amount: decimal("13"),
          }),
        ],
      }),
    );
    expect(recomputeTaxOffsetCache).toHaveBeenCalled();
  });

  it("bases snapshots and cause allocations on discounted line totals", async () => {
    resolveCosts
      .mockResolvedValueOnce({
        laborCost: decimal("1"),
        materialCost: decimal("2"),
        packagingCost: decimal("0"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("0"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("3"),
        netContribution: decimal("17"),
        materialLines: [],
        equipmentLines: [],
      })
      .mockResolvedValueOnce({
        laborCost: decimal("1"),
        materialCost: decimal("2"),
        packagingCost: decimal("0"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("0"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("3"),
        netContribution: decimal("17"),
        materialLines: [],
        equipmentLines: [],
      });

    const db = createDb();

    await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/discounted",
        line_items: [
          {
            admin_graphql_api_id: "gid://shopify/LineItem/discounted",
            variant_id: 100,
            product_id: 200,
            title: "Wholesale pin",
            variant_title: "Pin",
            quantity: 2,
            price: "50.00",
            total_discount: "60.00",
          },
        ],
      },
      db,
    );

    expect(resolveCosts).toHaveBeenCalledWith(
      "shop-1",
      "variant-1",
      decimal("20"),
      "snapshot",
      db,
      undefined,
      undefined,
    );
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          salePrice: decimal("20"),
          subtotal: decimal("40"),
          netContribution: decimal("34"),
        }),
      }),
    );
    expect(db.__spies.causeAllocationCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            amount: decimal("17"),
          }),
        ],
      }),
    );
  });

  it("allocates order-level discounts before resolving snapshot costs", async () => {
    resolveCosts
      .mockResolvedValueOnce({
        laborCost: decimal("10"),
        materialCost: decimal("5"),
        packagingCost: decimal("0"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("0"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("15"),
        netContribution: decimal("166.50"),
        materialLines: [],
        equipmentLines: [],
      })
      .mockResolvedValueOnce({
        laborCost: decimal("10"),
        materialCost: decimal("5"),
        packagingCost: decimal("0"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("0"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("15"),
        netContribution: decimal("166.50"),
        materialLines: [],
        equipmentLines: [],
      });

    const db = createDb();

    await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/order-discounted",
        total_line_items_price: "363.00",
        subtotal_price: "181.50",
        total_discounts: "181.50",
        total_price: "181.50",
        line_items: [
          {
            admin_graphql_api_id: "gid://shopify/LineItem/order-discounted",
            variant_id: 100,
            product_id: 200,
            title: "Large artwork",
            variant_title: "Default",
            quantity: 1,
            price: "363.00",
          },
        ],
      },
      db,
    );

    expect(resolveCosts).toHaveBeenNthCalledWith(
      1,
      "shop-1",
      "variant-1",
      decimal("181.50"),
      "snapshot",
      db,
      undefined,
      undefined,
    );
    expect(db.__spies.orderSnapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subtotalAmount: decimal("181.50"),
          discountAmount: decimal("181.50"),
          totalAmount: decimal("181.50"),
        }),
      }),
    );
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          salePrice: decimal("181.50"),
          subtotal: decimal("181.50"),
          netContribution: decimal("166.50"),
        }),
      }),
    );
  });

  it("keeps signed negative snapshot net contribution but clamps cause allocations to zero", async () => {
    resolveCosts
      .mockResolvedValueOnce({
        laborCost: decimal("5"),
        materialCost: decimal("5"),
        packagingCost: decimal("0"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("0"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("10"),
        netContribution: decimal("-9"),
        materialLines: [],
        equipmentLines: [],
      })
      .mockResolvedValueOnce({
        laborCost: decimal("5"),
        materialCost: decimal("5"),
        packagingCost: decimal("0"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("0"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("10"),
        netContribution: decimal("-9"),
        materialLines: [],
        equipmentLines: [],
      });

    const db = createDb();

    await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/negative",
        line_items: [
          {
            admin_graphql_api_id: "gid://shopify/LineItem/negative",
            variant_id: 100,
            product_id: 200,
            title: "Wholesale pin",
            variant_title: "Pin",
            quantity: 1,
            price: "1.00",
          },
        ],
      },
      db,
    );

    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          netContribution: decimal("-9"),
        }),
      }),
    );
    expect(db.__spies.causeAllocationCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            amount: decimal("0"),
          }),
        ],
      }),
    );
  });

  it("freezes product override Causes while retaining Artist payouts", async () => {
    const costResult = {
      laborCost: decimal("5"),
      materialCost: decimal("5"),
      packagingCost: decimal("0"),
      equipmentCost: decimal("0"),
      mistakeBufferAmount: decimal("0"),
      podCost: decimal("0"),
      podLines: [],
      podCostEstimated: false,
      podCostMissing: false,
      totalCost: decimal("10"),
      netContribution: decimal("40"),
      materialLines: [],
      equipmentLines: [],
    };
    resolveCosts.mockResolvedValue(costResult);
    const db = createDb({
      productRoutingMode: "product_override",
      productArtistAssignments: [{
        collaborationShare: decimal("100"),
        payoutEnabledOverride: true,
        payoutRateOverride: decimal("10"),
        creditOverride: null,
        artist: {
          id: "artist-1",
          displayName: "Artist One",
          creditName: "Artist One",
          creditPreference: "public_name",
          paymentEnabled: true,
          defaultPayoutRate: decimal("10"),
          causeAssignments: [{
            causeId: "artist-cause",
            percentage: decimal("100"),
            cause: { id: "artist-cause", name: "Artist Cause", is501c3: false },
          }],
        },
      }],
    });

    await createSnapshot("shop-1", {
      admin_graphql_api_id: "gid://shopify/Order/override",
      line_items: [{
        admin_graphql_api_id: "gid://shopify/LineItem/override",
        variant_id: 100,
        product_id: 200,
        title: "Override Product",
        quantity: 1,
        price: "50",
      }],
    }, db as never);

    expect(db.__spies.artistAllocationCreateMany).toHaveBeenCalled();
    expect(db.__spies.causeAllocationCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          causeId: "cause-1",
          source: "product_override",
          amount: decimal("17.5"),
        })],
      }),
    );
  });

  it("returns the existing snapshot when a concurrent create hits the unique constraint", async () => {
    const db = createDb({
      existingSnapshot: null,
      orderSnapshotCreateImpl: () => {
        const error = new Error("Unique constraint failed");
        (error as Error & { code?: string }).code = "P2002";
        throw error;
      },
    });
    db.orderSnapshot.findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-snapshot" });

    const result = await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/1",
        line_items: [],
      },
      db,
    );

    expect(result).toEqual({ created: false, snapshotId: "existing-snapshot" });
  });

  it("queues catalog sync only after a snapshot is successfully created", async () => {
    resolveCosts.mockReset();
    recomputeTaxOffsetCache.mockResolvedValue(undefined);
    jobQueueSend.mockResolvedValue(undefined);

    const db = createDb({ variant: null });

    const result = await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/2",
        line_items: [
          {
            admin_graphql_api_id: "gid://shopify/LineItem/20",
            variant_id: "gid://shopify/ProductVariant/200",
            product_id: "gid://shopify/Product/300",
            title: "Unsynced Product",
            variant_title: "Default",
            quantity: 1,
            price: "15.00",
          },
        ],
      },
      db,
    );

    expect(result).toEqual({ created: true, snapshotId: "snapshot-1" });
    expect(jobQueueSend).toHaveBeenCalledWith("catalog.sync.incremental", {
      shopId: "shop-1",
      productGid: "gid://shopify/Product/300",
    });
  });

  it("passes live POD overrides into snapshot cost resolution when provider data is available", async () => {
    resolveCosts
      .mockResolvedValueOnce({
        laborCost: decimal("1"),
        materialCost: decimal("2"),
        packagingCost: decimal("0.5"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("12.99"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("16.49"),
        netContribution: decimal("8.51"),
        materialLines: [],
        equipmentLines: [],
      })
      .mockResolvedValueOnce({
        laborCost: decimal("1"),
        materialCost: decimal("2"),
        packagingCost: decimal("0.5"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("12.99"),
        podLines: [],
        podCostEstimated: false,
        podCostMissing: false,
        totalCost: decimal("16.49"),
        netContribution: decimal("8.51"),
        materialLines: [],
        equipmentLines: [],
      });

    const db = createDb({
      providerMappings: [
        {
          variantId: "variant-1",
          provider: "printify",
          status: "mapped",
          providerVariantId: "9001",
          costLines: [],
          connection: {
            id: "connection-1",
            provider: "printify",
            status: "validated",
            providerAccountId: "555",
            credentialsEncrypted: "encrypted",
          },
        },
      ],
    });

    const { encryptProviderCredential } = await import("./providerCredentials.server");
    db.providerVariantMapping.findMany = vi.fn().mockResolvedValue([
      {
        variantId: "variant-1",
        provider: "printify",
        status: "mapped",
        providerVariantId: "9001",
        costLines: [],
        connection: {
          id: "connection-1",
          provider: "printify",
          status: "validated",
          providerAccountId: "555",
          credentialsEncrypted: encryptProviderCredential("pk_live_fixture"),
        },
      },
    ]);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        current_page: 1,
        last_page: 1,
        data: [
          {
            id: "prod_1",
            title: "Fixture Tee",
            variants: [
              {
                id: 9001,
                title: "Black / M",
                sku: "SKU-READY-001",
                cost: 1299,
              },
            ],
          },
        ],
      }),
    });

    await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/10",
        line_items: [
          {
            admin_graphql_api_id: "gid://shopify/LineItem/10",
            variant_id: 100,
            product_id: 200,
            title: "Tee",
            variant_title: "Large",
            quantity: 1,
            price: "25.00",
          },
        ],
      },
      db,
      "webhook",
      fetchMock as never,
    );

    expect(resolveCosts).toHaveBeenCalledWith(
      "shop-1",
      "variant-1",
      decimal("25.00"),
      "snapshot",
      db,
      undefined,
      expect.objectContaining({
        podCostEstimated: false,
        podCostMissing: false,
      }),
    );
    expect(resolveCosts.mock.calls[0]?.[6]?.podCost.toString()).toBe("12.99");
  });

  it("falls back to cached POD costs when live provider fetch fails", async () => {
    resolveCosts
      .mockResolvedValueOnce({
        laborCost: decimal("1"),
        materialCost: decimal("2"),
        packagingCost: decimal("0.5"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("9.50"),
        podLines: [],
        podCostEstimated: true,
        podCostMissing: false,
        totalCost: decimal("13.00"),
        netContribution: decimal("12.00"),
        materialLines: [],
        equipmentLines: [],
      })
      .mockResolvedValueOnce({
        laborCost: decimal("1"),
        materialCost: decimal("2"),
        packagingCost: decimal("0.5"),
        equipmentCost: decimal("0"),
        mistakeBufferAmount: decimal("0"),
        podCost: decimal("9.50"),
        podLines: [],
        podCostEstimated: true,
        podCostMissing: false,
        totalCost: decimal("13.00"),
        netContribution: decimal("12.00"),
        materialLines: [],
        equipmentLines: [],
      });

    const { encryptProviderCredential } = await import("./providerCredentials.server");
    const db = createDb({
      providerMappings: [
        {
          variantId: "variant-1",
          provider: "printify",
          status: "mapped",
          providerVariantId: "9001",
          costLines: [
            {
              costLineType: "base_fulfillment",
              description: "Cached fulfillment cost",
              amount: decimal("9.50"),
              currency: "USD",
              syncedAt: new Date("2026-04-10T16:00:00Z"),
            },
          ],
          connection: {
            id: "connection-1",
            provider: "printify",
            status: "validated",
            providerAccountId: "555",
            credentialsEncrypted: encryptProviderCredential("pk_live_fixture"),
          },
        },
      ],
    });

    const fetchMock = vi.fn().mockRejectedValue(new Error("Printify unavailable"));

    await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/11",
        line_items: [
          {
            admin_graphql_api_id: "gid://shopify/LineItem/11",
            variant_id: 100,
            product_id: 200,
            title: "Tee",
            variant_title: "Large",
            quantity: 1,
            price: "25.00",
          },
        ],
      },
      db,
      "webhook",
      fetchMock as never,
    );

    expect(resolveCosts.mock.calls[0]?.[6]?.podCost.toString()).toBe("9.5");
    expect(resolveCosts.mock.calls[0]?.[6]?.podCostEstimated).toBe(true);
    expect(resolveCosts.mock.calls[0]?.[6]?.podCostMissing).toBe(false);
  });

  it("does not queue catalog sync when snapshot creation loses a concurrent race", async () => {
    resolveCosts.mockReset();
    jobQueueSend.mockResolvedValue(undefined);

    const db = createDb({
      existingSnapshot: null,
      variant: null,
      orderSnapshotCreateImpl: () => {
        const error = new Error("Unique constraint failed");
        (error as Error & { code?: string }).code = "P2002";
        throw error;
      },
    });
    db.orderSnapshot.findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-snapshot" });

    const result = await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/3",
        line_items: [
          {
            admin_graphql_api_id: "gid://shopify/LineItem/30",
            variant_id: "gid://shopify/ProductVariant/300",
            product_id: "gid://shopify/Product/400",
            title: "Race Product",
            variant_title: "Default",
            quantity: 1,
            price: "15.00",
          },
        ],
      },
      db,
    );

    expect(result).toEqual({ created: false, snapshotId: "existing-snapshot" });
    expect(jobQueueSend).not.toHaveBeenCalled();
  });
});
