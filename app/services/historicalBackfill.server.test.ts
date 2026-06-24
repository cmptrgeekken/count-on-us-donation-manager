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
