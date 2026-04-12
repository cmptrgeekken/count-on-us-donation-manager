import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { resolveCosts } from "./costEngine.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

function createMaterial(params: {
  id: string;
  name?: string;
  type?: "production" | "shipping";
  costingModel?: "yield" | "uses" | null;
  purchasePrice?: string;
  purchaseQty?: string;
  totalUsesPerUnit?: string | null;
}) {
  return {
    id: params.id,
    name: params.name ?? params.id,
    type: params.type ?? "production",
    costingModel: params.costingModel ?? "yield",
    purchasePrice: decimal(params.purchasePrice ?? "10"),
    purchaseQty: decimal(params.purchaseQty ?? "1"),
    perUnitCost: decimal(params.purchasePrice ?? "10").div(decimal(params.purchaseQty ?? "1")),
    totalUsesPerUnit: params.totalUsesPerUnit ? decimal(params.totalUsesPerUnit) : null,
  };
}

function createEquipment(id: string) {
  return {
    id,
    name: id,
    hourlyRate: null,
    perUseCost: null,
  };
}

function createDb(
  config: unknown,
  shopOverrides?: { mistakeBuffer?: Prisma.Decimal | null; defaultLaborRate?: Prisma.Decimal | null },
  providerMappings: unknown[] = [],
) {
  return {
    variantCostConfig: {
      findUnique: vi.fn().mockResolvedValue(config),
    },
    shop: {
      findUnique: vi.fn().mockResolvedValue({
        mistakeBuffer: shopOverrides?.mistakeBuffer ?? null,
        defaultLaborRate: shopOverrides?.defaultLaborRate ?? null,
      }),
    },
    providerVariantMapping: {
      findMany: vi.fn().mockResolvedValue(providerMappings),
    },
  } as unknown as PrismaClient;
}

describe("resolveCosts", () => {
  it("applies explicit template-line material overrides when template lines share the same material", async () => {
    const sharedMaterial = createMaterial({ id: "mat-shared" });
    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: null,
      productionTemplate: {
        materialLines: [
          {
            id: "template-line-1",
            materialId: "mat-shared",
            material: sharedMaterial,
            quantity: decimal("1"),
            yield: decimal("1"),
            usesPerVariant: null,
          },
          {
            id: "template-line-2",
            materialId: "mat-shared",
            material: sharedMaterial,
            quantity: decimal("2"),
            yield: decimal("1"),
            usesPerVariant: null,
          },
        ],
        equipmentLines: [],
      },
      materialLines: [
        {
          id: "override-line",
          configId: "config-1",
          materialId: "mat-shared",
          material: sharedMaterial,
          templateLineId: "template-line-2",
          quantity: decimal("5"),
          yield: decimal("1"),
          usesPerVariant: null,
        },
      ],
      equipmentLines: [],
    };

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "preview",
      createDb(config),
    );

    expect(result.materialLines).toHaveLength(2);
    expect(result.materialLines.map((line) => line.quantity.toString())).toEqual(["1", "5"]);
    expect(result.materialCost.toString()).toBe("60");
  });

  it("only treats legacy overrides as template overrides when the template material is unique", async () => {
    const uniqueMaterial = createMaterial({ id: "mat-unique" });
    const duplicatedMaterial = createMaterial({ id: "mat-duplicate" });
    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: null,
      productionTemplate: {
        materialLines: [
          {
            id: "template-unique",
            materialId: "mat-unique",
            material: uniqueMaterial,
            quantity: decimal("1"),
            yield: decimal("1"),
            usesPerVariant: null,
          },
          {
            id: "template-dup-1",
            materialId: "mat-duplicate",
            material: duplicatedMaterial,
            quantity: decimal("1"),
            yield: decimal("1"),
            usesPerVariant: null,
          },
          {
            id: "template-dup-2",
            materialId: "mat-duplicate",
            material: duplicatedMaterial,
            quantity: decimal("2"),
            yield: decimal("1"),
            usesPerVariant: null,
          },
        ],
        equipmentLines: [],
      },
      materialLines: [
        {
          id: "legacy-unique-override",
          configId: "config-1",
          materialId: "mat-unique",
          material: uniqueMaterial,
          templateLineId: null,
          quantity: decimal("4"),
          yield: decimal("1"),
          usesPerVariant: null,
        },
        {
          id: "still-additional",
          configId: "config-1",
          materialId: "mat-duplicate",
          material: duplicatedMaterial,
          templateLineId: null,
          quantity: decimal("7"),
          yield: decimal("1"),
          usesPerVariant: null,
        },
      ],
      equipmentLines: [],
    };

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "preview",
      createDb(config),
    );

    expect(result.materialLines).toHaveLength(4);
    expect(result.materialLines.map((line) => `${line.materialId}:${line.quantity.toString()}`)).toEqual([
      "mat-unique:4",
      "mat-duplicate:1",
      "mat-duplicate:2",
      "mat-duplicate:7",
    ]);
    expect(result.materialCost.toString()).toBe("140");
  });

  it("applies explicit equipment overrides by template line id", async () => {
    const equipment = createEquipment("press");
    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: null,
      productionTemplate: {
        materialLines: [],
        equipmentLines: [
          {
            id: "equipment-line-1",
            equipmentId: "press",
            equipment,
            minutes: decimal("10"),
            uses: null,
          },
          {
            id: "equipment-line-2",
            equipmentId: "press",
            equipment,
            minutes: decimal("20"),
            uses: null,
          },
        ],
      },
      materialLines: [],
      equipmentLines: [
        {
          id: "override-equipment-line",
          configId: "config-1",
          equipmentId: "press",
          equipment: {
            ...equipment,
            hourlyRate: decimal("60"),
            perUseCost: null,
          },
          templateLineId: "equipment-line-2",
          minutes: decimal("30"),
          uses: null,
        },
      ],
    };

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "preview",
      createDb(config),
    );

    expect(result.equipmentLines).toHaveLength(2);
    expect(result.equipmentLines.map((line) => line.minutes?.toString() ?? "")).toEqual(["10", "30"]);
    expect(result.equipmentCost.toString()).toBe("30");
  });
});

describe("resolveCosts shipping material uses costing", () => {
  it("calculates packaging cost from a uses-based shipping line", async () => {
    const shippingMaterial = createMaterial({
      id: "tape",
      type: "shipping",
      costingModel: "uses",
      purchasePrice: "20",
      purchaseQty: "2",
      totalUsesPerUnit: "100",
    });

    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: null,
      productionTemplate: null,
      shippingTemplate: null,
      materialLines: [
        {
          id: "shipping-line",
          materialId: "tape",
          material: shippingMaterial,
          quantity: decimal("1"),
          yield: null,
          usesPerVariant: decimal("3"),
        },
      ],
      equipmentLines: [],
    };

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "preview",
      createDb(config),
    );

    expect(result.packagingCost.toString()).toBe("0.3");
    expect(result.materialCost.toString()).toBe("0");
    expect(result.totalCost.toString()).toBe("0.3");
  });

  it("uses the maximum shipping line cost rather than summing shipping lines", async () => {
    const flatShippingMaterial = createMaterial({
      id: "box",
      type: "shipping",
      costingModel: null,
      purchasePrice: "4",
      purchaseQty: "1",
    });
    const usesShippingMaterial = createMaterial({
      id: "tape",
      type: "shipping",
      costingModel: "uses",
      purchasePrice: "20",
      purchaseQty: "2",
      totalUsesPerUnit: "100",
    });

    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: null,
      productionTemplate: null,
      shippingTemplate: null,
      materialLines: [
        {
          id: "box-line",
          materialId: "box",
          material: flatShippingMaterial,
          quantity: decimal("1"),
          yield: null,
          usesPerVariant: null,
        },
        {
          id: "tape-line",
          materialId: "tape",
          material: usesShippingMaterial,
          quantity: decimal("1"),
          yield: null,
          usesPerVariant: decimal("3"),
        },
      ],
      equipmentLines: [],
    };

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "preview",
      createDb(config),
    );

    expect(result.packagingCost.toString()).toBe("4");
    expect(result.totalCost.toString()).toBe("4");
  });

  it("still applies mistake buffer only to production materials when shipping uses lines are present", async () => {
    const productionMaterial = createMaterial({
      id: "fabric",
      type: "production",
      costingModel: "yield",
      purchasePrice: "12",
      purchaseQty: "1",
    });
    const shippingMaterial = createMaterial({
      id: "tape",
      type: "shipping",
      costingModel: "uses",
      purchasePrice: "20",
      purchaseQty: "2",
      totalUsesPerUnit: "100",
    });

    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: decimal("0.1"),
      productionTemplate: null,
      shippingTemplate: null,
      materialLines: [
        {
          id: "production-line",
          materialId: "fabric",
          material: productionMaterial,
          quantity: decimal("2"),
          yield: decimal("1"),
          usesPerVariant: null,
        },
        {
          id: "shipping-line",
          materialId: "tape",
          material: shippingMaterial,
          quantity: decimal("1"),
          yield: null,
          usesPerVariant: decimal("3"),
        },
      ],
      equipmentLines: [],
    };

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "preview",
      createDb(config),
    );

    expect(result.materialCost.toString()).toBe("24");
    expect(result.packagingCost.toString()).toBe("0.3");
    expect(result.mistakeBufferAmount.toString()).toBe("2.4");
    expect(result.totalCost.toString()).toBe("26.7");
  });

  it("uses an explicit shipping template override before the production default", async () => {
    const productionMaterial = createMaterial({
      id: "fabric",
      type: "production",
      costingModel: "yield",
      purchasePrice: "12",
      purchaseQty: "1",
    });
    const inheritedShippingMaterial = createMaterial({
      id: "mailer",
      type: "shipping",
      costingModel: null,
      purchasePrice: "2",
      purchaseQty: "1",
    });
    const explicitShippingMaterial = createMaterial({
      id: "box",
      type: "shipping",
      costingModel: null,
      purchasePrice: "5",
      purchaseQty: "1",
    });

    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: null,
      productionTemplate: {
        materialLines: [
          {
            id: "prod-line",
            materialId: "fabric",
            material: productionMaterial,
            quantity: decimal("2"),
            yield: decimal("1"),
            usesPerVariant: null,
          },
        ],
        equipmentLines: [],
        defaultShippingTemplate: {
          materialLines: [
            {
              id: "default-ship-line",
              materialId: "mailer",
              material: inheritedShippingMaterial,
              quantity: decimal("1"),
              yield: null,
              usesPerVariant: null,
            },
          ],
          equipmentLines: [],
        },
      },
      shippingTemplate: {
        materialLines: [
          {
            id: "explicit-ship-line",
            materialId: "box",
            material: explicitShippingMaterial,
            quantity: decimal("1"),
            yield: null,
            usesPerVariant: null,
          },
        ],
        equipmentLines: [],
      },
      materialLines: [],
      equipmentLines: [],
    };

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "preview",
      createDb(config),
    );

    expect(result.materialCost.toString()).toBe("24");
    expect(result.packagingCost.toString()).toBe("5");
    expect(result.totalCost.toString()).toBe("29");
  });
});

describe("resolveCosts provider cache support", () => {
  it("includes cached POD costs even when no manual variant cost config exists", async () => {
    const syncedAt = new Date("2026-04-11T14:00:00Z");

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "snapshot",
      createDb(
        null,
        undefined,
        [
          {
            provider: "printify",
            providerVariantId: "pv-1",
            status: "mapped",
            connection: {
              status: "validated",
            },
            costLines: [
              {
                costLineType: "base",
                description: "Base production cost",
                amount: decimal("8.50"),
                currency: "USD",
                syncedAt,
                createdAt: syncedAt,
              },
              {
                costLineType: "shipping",
                description: "Shipping estimate",
                amount: decimal("4.25"),
                currency: "USD",
                syncedAt,
                createdAt: syncedAt,
              },
            ],
          },
        ],
      ),
    );

    expect(result.materialLines).toEqual([]);
    expect(result.equipmentLines).toEqual([]);
    expect(result.podCost.toString()).toBe("12.75");
    expect(result.podLines).toHaveLength(2);
    expect(result.totalCost.toString()).toBe("12.75");
    expect(result.netContribution?.toString()).toBe("37.25");
  });

  it("includes the latest cached POD lines from validated provider mappings", async () => {
    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: null,
      productionTemplate: null,
      shippingTemplate: null,
      materialLines: [],
      equipmentLines: [],
    };
    const syncedAt = new Date("2026-04-11T14:00:00Z");

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "preview",
      createDb(
        config,
        undefined,
        [
          {
            provider: "printify",
            providerVariantId: "pv-1",
            status: "mapped",
            connection: {
              status: "validated",
            },
            costLines: [
              {
                costLineType: "base",
                description: "Base production cost",
                amount: decimal("8.50"),
                currency: "USD",
                syncedAt,
                createdAt: syncedAt,
              },
              {
                costLineType: "shipping",
                description: "Shipping estimate",
                amount: decimal("4.25"),
                currency: "USD",
                syncedAt,
                createdAt: syncedAt,
              },
              {
                costLineType: "older",
                description: "Older sync line",
                amount: decimal("99.99"),
                currency: "USD",
                syncedAt: new Date("2026-04-10T14:00:00Z"),
                createdAt: new Date("2026-04-10T14:00:00Z"),
              },
            ],
          },
        ],
      ),
    );

    expect(result.podCost.toString()).toBe("12.75");
    expect(result.podLines).toHaveLength(2);
    expect(result.podCostEstimated).toBe(true);
    expect(result.podCostMissing).toBe(false);
    expect(result.totalCost.toString()).toBe("12.75");
  });

  it("marks POD cost missing when a validated mapping has no cached lines", async () => {
    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: null,
      productionTemplate: null,
      shippingTemplate: null,
      materialLines: [],
      equipmentLines: [],
    };

    const result = await resolveCosts(
      "shop-1",
      "variant-1",
      decimal("50"),
      "preview",
      createDb(
        config,
        undefined,
        [
          {
            provider: "printify",
            providerVariantId: "pv-1",
            status: "mapped",
            connection: {
              status: "validated",
            },
            costLines: [],
          },
        ],
      ),
    );

    expect(result.podCost.toString()).toBe("0");
    expect(result.podLines).toEqual([]);
    expect(result.podCostEstimated).toBe(false);
    expect(result.podCostMissing).toBe(true);
  });
});
