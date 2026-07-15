import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { buildProductionUsageCsv, buildProductionUsageReport } from "./productionUsageReport.server";

const decimal = (value: string | number) => new Prisma.Decimal(value);

describe("buildProductionUsageReport", () => {
  it("aggregates eligible material, equipment, consumable, buffer, and package usage", async () => {
    const db = {
      orderRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "order-1",
            lifecycle: { state: "partially_refunded" },
            refundEvents: [{ lines: [{ shopifyLineItemId: "line-1", quantity: decimal(1) }] }],
            currentSnapshot: {
              createdAt: new Date("2026-07-10T12:00:00.000Z"),
              lines: [{
                shopifyLineItemId: "line-1",
                quantity: 2,
                mistakeBufferAmount: decimal(2),
                materialLines: [{
                  materialId: "material-1",
                  materialName: "Paper",
                  materialType: "production",
                  costingModel: "counted",
                  perUnitCost: decimal(2),
                  usesPerVariant: null,
                  quantity: decimal(5),
                  lineCost: decimal(10),
                }, {
                  materialId: "shipping-material-1",
                  materialName: "Mailer",
                  materialType: "shipping",
                  costingModel: "counted",
                  perUnitCost: decimal(3),
                  usesPerVariant: null,
                  quantity: decimal(2),
                  lineCost: decimal(6),
                }],
                equipmentLines: [{
                  equipmentId: "equipment-1",
                  equipmentName: "Press",
                  usageMode: "direct",
                  minutes: decimal(120),
                  uses: decimal(4),
                  yieldDurationMinutes: null,
                  yieldUses: null,
                  yieldQuantity: null,
                  lineCost: decimal(20),
                  consumablesCost: decimal(4),
                  electricityCost: decimal(2),
                  depreciationCost: decimal(3),
                  maintenanceCost: decimal(1),
                  manualOverrideCost: decimal(10),
                  consumableLines: [{
                    consumableId: "consumable-1",
                    consumableName: "Blade",
                    lifespanUnit: "uses",
                    lineCost: decimal(4),
                  }],
                }],
              }],
              packageAllocations: [{ packageName: "Mailer", quantity: 1, materialCost: decimal(3) }],
            },
          },
          {
            id: "order-2",
            lifecycle: { state: "canceled" },
            refundEvents: [],
            currentSnapshot: {
              createdAt: new Date("2026-07-11T12:00:00.000Z"),
              lines: [{ shopifyLineItemId: "line-2", quantity: 1, mistakeBufferAmount: decimal(99), materialLines: [], equipmentLines: [] }],
              packageAllocations: [],
            },
          },
          {
            id: "order-3",
            lifecycle: { state: "unknown" },
            refundEvents: [],
            currentSnapshot: {
              createdAt: new Date("2026-07-12T12:00:00.000Z"),
              lines: [{ shopifyLineItemId: "line-3", quantity: 1, mistakeBufferAmount: decimal(99), materialLines: [], equipmentLines: [] }],
              packageAllocations: [],
            },
          },
        ]),
      },
    };

    const report = await buildProductionUsageReport("shop-1", { origin: "all" }, db as never);

    expect(report.summary).toMatchObject({
      includedOrderCount: 1,
      excludedOrderCount: 2,
      reviewRequiredOrderCount: 1,
      materialCost: "5.00",
      equipmentCost: "10.00",
      equipmentHours: "1.0",
      consumablesCost: "2.00",
      mistakeBuffer: "1.00",
      packagingCost: "1.50",
    });
    expect(report.materials[0]).toMatchObject({ purchaseUnits: "2.5", totalCost: "5.00", orderCount: 1 });
    expect(report.materials).toHaveLength(1);
    expect(report.equipment[0]).toMatchObject({ hours: "1.0", uses: "2", totalCost: "10.00" });
    expect(report.equipment[0]?.consumables[0]).toMatchObject({ name: "Blade", totalCost: "2.00" });
    expect(report.packages[0]).toMatchObject({ quantity: "0.5", materialCost: "1.50" });

    const csv = buildProductionUsageCsv(report);
    expect(csv).toContain("material,Paper");
    expect(csv).toContain("consumable,Press: Blade");
  });

  it("derives duration-yield hours and use-yield uses from eligible quantity", async () => {
    const db = {
      orderRecord: {
        findMany: vi.fn().mockResolvedValue([{
          id: "order-1",
          lifecycle: { state: "active" },
          refundEvents: [],
          currentSnapshot: {
            createdAt: new Date("2026-07-10T12:00:00.000Z"),
            packageAllocations: [],
            lines: [{
              shopifyLineItemId: "line-1",
              quantity: 4,
              mistakeBufferAmount: decimal(0),
              materialLines: [],
              equipmentLines: [
                { equipmentId: "duration", equipmentName: "Laser", usageMode: "duration_yield", minutes: null, uses: null, yieldDurationMinutes: decimal(60), yieldUses: null, yieldQuantity: decimal(2), lineCost: decimal(4), consumablesCost: decimal(0), electricityCost: decimal(0), depreciationCost: decimal(0), maintenanceCost: decimal(0), manualOverrideCost: decimal(4), consumableLines: [] },
                { equipmentId: "uses", equipmentName: "Cutter", usageMode: "use_yield", minutes: null, uses: null, yieldDurationMinutes: null, yieldUses: decimal(3), yieldQuantity: decimal(2), lineCost: decimal(4), consumablesCost: decimal(0), electricityCost: decimal(0), depreciationCost: decimal(0), maintenanceCost: decimal(0), manualOverrideCost: decimal(4), consumableLines: [] },
              ],
            }],
          },
        }]),
      },
    };
    const report = await buildProductionUsageReport("shop-1", {}, db as never);
    expect(report.equipment.find((row) => row.name === "Laser")?.hours).toBe("2.0");
    expect(report.equipment.find((row) => row.name === "Cutter")?.uses).toBe("6");
  });

  it("rounds purchase units and equipment hours to one decimal place", async () => {
    const db = {
      orderRecord: {
        findMany: vi.fn().mockResolvedValue([{
          id: "order-1",
          lifecycle: { state: "active" },
          refundEvents: [],
          currentSnapshot: {
            createdAt: new Date("2026-07-10T12:00:00.000Z"),
            packageAllocations: [],
            lines: [{
              shopifyLineItemId: "line-1",
              quantity: 1,
              mistakeBufferAmount: decimal(0),
              materialLines: [{
                materialId: "material-1", materialName: "Paper", materialType: "production",
                costingModel: "counted", perUnitCost: decimal(2), usesPerVariant: null,
                quantity: decimal("2.46"), lineCost: decimal("4.92"),
              }],
              equipmentLines: [{
                equipmentId: "equipment-1", equipmentName: "Press", usageMode: "direct",
                minutes: decimal("62.4"), uses: decimal(1), yieldDurationMinutes: null,
                yieldUses: null, yieldQuantity: null, lineCost: decimal(1),
                consumablesCost: decimal(0), electricityCost: decimal(0), depreciationCost: decimal(0),
                maintenanceCost: decimal(0), manualOverrideCost: decimal(1), consumableLines: [],
              }],
            }],
          },
        }]),
      },
    };

    const report = await buildProductionUsageReport("shop-1", {}, db as never);

    expect(report.materials[0]?.purchaseUnits).toBe("2.5");
    expect(report.equipment[0]?.hours).toBe("1.0");
    expect(report.summary.equipmentHours).toBe("1.0");
    expect(buildProductionUsageCsv(report)).toContain("material,Paper,production,2.5");
  });
});
