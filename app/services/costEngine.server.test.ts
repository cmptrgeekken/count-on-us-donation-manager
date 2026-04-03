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

function createDb(config: unknown, shopOverrides?: { mistakeBuffer?: Prisma.Decimal | null; defaultLaborRate?: Prisma.Decimal | null }) {
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
  } as unknown as PrismaClient;
}

describe("resolveCosts", () => {
  it("applies explicit template-line material overrides when template lines share the same material", async () => {
    const sharedMaterial = createMaterial({ id: "mat-shared" });
    const config = {
      laborMinutes: null,
      laborRate: null,
      mistakeBuffer: null,
      template: {
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
      template: {
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
      template: {
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
