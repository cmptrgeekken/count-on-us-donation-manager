import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSnapshot } from "./snapshotService.server";

const {
  resolveCosts,
  recomputeTaxOffsetCache,
  jobQueueSend,
} = vi.hoisted(() => ({
  resolveCosts: vi.fn(),
  recomputeTaxOffsetCache: vi.fn(),
  jobQueueSend: vi.fn(),
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

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

function createDb({
  existingSnapshot = null,
  orderSnapshotCreateImpl,
  variant = { id: "variant-1", shopifyId: "gid://shopify/ProductVariant/100" },
  providerMappings = [],
}: {
  existingSnapshot?: unknown | null;
  orderSnapshotCreateImpl?: () => unknown;
  variant?: unknown;
  providerMappings?: unknown[];
} = {}) {
  const orderSnapshotCreate = orderSnapshotCreateImpl
    ? vi.fn().mockImplementation(orderSnapshotCreateImpl)
    : vi.fn().mockResolvedValue({ id: "snapshot-1" });
  const orderSnapshotLineCreate = vi.fn().mockResolvedValue({ id: "snapshot-line-1" });
  const materialLineCreateMany = vi.fn().mockResolvedValue(undefined);
  const equipmentLineCreateMany = vi.fn().mockResolvedValue(undefined);
  const podLineCreateMany = vi.fn().mockResolvedValue(undefined);
  const causeAllocationCreateMany = vi.fn().mockResolvedValue(undefined);
  const auditLogCreate = vi.fn().mockResolvedValue(undefined);
  const variantCostConfigFindFirst = vi
    .fn()
    .mockResolvedValueOnce({ laborMinutes: decimal("3") })
    .mockResolvedValueOnce({ laborRate: decimal("60") });

  const tx = {
    orderSnapshot: { create: orderSnapshotCreate },
    orderSnapshotLine: { create: orderSnapshotLineCreate },
    orderSnapshotMaterialLine: { createMany: materialLineCreateMany },
    orderSnapshotEquipmentLine: { createMany: equipmentLineCreateMany },
    orderSnapshotPODLine: { createMany: podLineCreateMany },
    lineCauseAllocation: { createMany: causeAllocationCreateMany },
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
    $transaction: vi.fn().mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
    __spies: {
      orderSnapshotCreate,
      orderSnapshotLineCreate,
      materialLineCreateMany,
      equipmentLineCreateMany,
      podLineCreateMany,
      causeAllocationCreateMany,
      auditLogCreate,
    },
  };
}

describe("createSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          },
        ],
      })
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
          },
        ],
      });

    const db = createDb();

    const result = await createSnapshot(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/1",
        name: "#1001",
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
    expect(db.__spies.orderSnapshotLineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 2,
          subtotal: decimal("100"),
          laborCost: decimal("20"),
          materialCost: decimal("40"),
          packagingCost: decimal("8"),
          equipmentCost: decimal("6"),
          mistakeBufferAmount: decimal("4"),
          totalCost: decimal("78"),
          netContribution: decimal("22"),
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
    expect(db.__spies.causeAllocationCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            amount: decimal("11"),
          }),
        ],
      }),
    );
    expect(recomputeTaxOffsetCache).toHaveBeenCalled();
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
