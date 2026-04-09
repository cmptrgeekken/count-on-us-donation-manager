import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAllProcessors } from "./processors.server";

const mocks = vi.hoisted(() => ({
  prisma: {
    shop: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  runReconciliation: vi.fn(),
  createReportingPeriodFromPayout: vi.fn(),
  refreshTaxOffsetCacheForShop: vi.fn(),
  syncShopifyCharges: vi.fn(),
  runAnalyticalRecalculation: vi.fn(),
  adminFactory: vi.fn(),
}));

vi.mock("../db.server", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../services/catalogSync.server", () => ({
  fullSync: vi.fn(),
  incrementalSync: vi.fn(),
}));

vi.mock("../services/chargeSyncService.server", () => ({
  syncShopifyCharges: mocks.syncShopifyCharges,
}));

vi.mock("../services/adjustmentService.server", () => ({
  processOrderUpdate: vi.fn(),
  processRefund: vi.fn(),
}));

vi.mock("../services/reconciliationService.server", () => ({
  runReconciliation: mocks.runReconciliation,
}));

vi.mock("../services/reportingPeriodService.server", () => ({
  createReportingPeriodFromPayout: mocks.createReportingPeriodFromPayout,
}));

vi.mock("../services/reportingService.server", () => ({
  refreshTaxOffsetCacheForShop: mocks.refreshTaxOffsetCacheForShop,
}));

vi.mock("../services/analyticalRecalculation.server", () => ({
  runAnalyticalRecalculation: mocks.runAnalyticalRecalculation,
}));

vi.mock("../services/snapshotService.server", () => ({
  createSnapshot: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: mocks.adminFactory,
  },
  default: {
    unauthenticated: {
      admin: mocks.adminFactory,
    },
  },
}));

type WorkHandler = (jobs: Array<{ data: any }>) => Promise<void>;

function createBoss() {
  const workers = new Map<string, WorkHandler>();

  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    sendAfter: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockImplementation(async (name: string, handler: WorkHandler) => {
      workers.set(name, handler);
    }),
    workers,
  };
}

describe("registerAllProcessors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fans daily reconciliation out into singleton per-shop jobs", async () => {
    const boss = createBoss();
    mocks.prisma.shop.findMany.mockResolvedValue([{ shopId: "shop-1" }, { shopId: "shop-2" }]);

    await registerAllProcessors(boss as any);

    const dailyWorker = boss.workers.get("reconciliation.daily");
    expect(dailyWorker).toBeTruthy();

    await dailyWorker!([]);

    expect(boss.send).toHaveBeenNthCalledWith(
      1,
      "reconciliation.shop",
      { shopId: "shop-1" },
      expect.objectContaining({
        singletonKey: "shop-1",
        singletonSeconds: 6 * 60 * 60,
      }),
    );
    expect(boss.send).toHaveBeenNthCalledWith(
      2,
      "reconciliation.shop",
      { shopId: "shop-2" },
      expect.objectContaining({
        singletonKey: "shop-2",
        singletonSeconds: 6 * 60 * 60,
      }),
    );
  });

  it("logs reconciliation failures per shop and rethrows them", async () => {
    const boss = createBoss();
    const error = new Error("Shopify timeout");
    mocks.adminFactory.mockResolvedValue({ admin: { graphql: vi.fn() } });
    mocks.runReconciliation.mockRejectedValue(error);

    await registerAllProcessors(boss as any);

    const worker = boss.workers.get("reconciliation.shop");
    expect(worker).toBeTruthy();

    await expect(worker!([{ data: { shopId: "shop-1" } }])).rejects.toThrow("Shopify timeout");
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shopId: "shop-1",
          action: "RECONCILIATION_RUN_FAILED",
        }),
      }),
    );
  });

  it("opens reporting periods from payout webhooks", async () => {
    const boss = createBoss();
    const payoutPayload = { id: 123, date: "2026-04-07" };

    await registerAllProcessors(boss as any);

    const worker = boss.workers.get("reporting.period.open");
    expect(worker).toBeTruthy();

    await worker!([{ data: { shopId: "shop-1", payload: payoutPayload } }]);

    expect(mocks.createReportingPeriodFromPayout).toHaveBeenCalledWith(
      "shop-1",
      payoutPayload,
      mocks.prisma,
    );
  });

  it("fans daily Shopify charge sync out into singleton per-shop jobs", async () => {
    const boss = createBoss();
    mocks.prisma.shop.findMany.mockResolvedValue([{ shopId: "shop-1" }, { shopId: "shop-2" }]);

    await registerAllProcessors(boss as any);

    const dailyWorker = boss.workers.get("shopify-charges.daily");
    expect(dailyWorker).toBeTruthy();

    await dailyWorker!([]);

    expect(boss.send).toHaveBeenNthCalledWith(
      1,
      "shopify-charges.shop",
      { shopId: "shop-1" },
      expect.objectContaining({
        singletonKey: "shop-1",
        singletonSeconds: 6 * 60 * 60,
      }),
    );
    expect(boss.send).toHaveBeenNthCalledWith(
      2,
      "shopify-charges.shop",
      { shopId: "shop-2" },
      expect.objectContaining({
        singletonKey: "shop-2",
        singletonSeconds: 6 * 60 * 60,
      }),
    );
  });

  it("fans hourly tax offset cache refresh out into singleton per-shop jobs", async () => {
    const boss = createBoss();
    mocks.prisma.shop.findMany.mockResolvedValue([{ shopId: "shop-1" }, { shopId: "shop-2" }]);

    await registerAllProcessors(boss as any);

    const dailyWorker = boss.workers.get("reporting.tax-offset.daily");
    expect(dailyWorker).toBeTruthy();

    await dailyWorker!([]);

    expect(boss.send).toHaveBeenNthCalledWith(
      1,
      "reporting.tax-offset.shop",
      { shopId: "shop-1" },
      expect.objectContaining({
        singletonKey: "shop-1",
        singletonSeconds: 60 * 60,
      }),
    );
    expect(boss.send).toHaveBeenNthCalledWith(
      2,
      "reporting.tax-offset.shop",
      { shopId: "shop-2" },
      expect.objectContaining({
        singletonKey: "shop-2",
        singletonSeconds: 60 * 60,
      }),
    );
  });

  it("logs tax offset cache refresh failures per shop and rethrows them", async () => {
    const boss = createBoss();
    const error = new Error("Tax cache timeout");
    mocks.refreshTaxOffsetCacheForShop.mockRejectedValue(error);

    await registerAllProcessors(boss as any);

    const worker = boss.workers.get("reporting.tax-offset.shop");
    expect(worker).toBeTruthy();

    await expect(worker!([{ data: { shopId: "shop-1" } }])).rejects.toThrow("Tax cache timeout");
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shopId: "shop-1",
          action: "TAX_OFFSET_CACHE_REFRESH_FAILED",
        }),
      }),
    );
  });

  it("logs Shopify charge sync failures per shop and rethrows them", async () => {
    const boss = createBoss();
    const error = new Error("Payments API timeout");
    mocks.adminFactory.mockResolvedValue({ admin: { graphql: vi.fn() } });
    mocks.syncShopifyCharges.mockRejectedValue(error);

    await registerAllProcessors(boss as any);

    const worker = boss.workers.get("shopify-charges.shop");
    expect(worker).toBeTruthy();

    await expect(worker!([{ data: { shopId: "shop-1" } }])).rejects.toThrow("Payments API timeout");
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shopId: "shop-1",
          action: "SHOPIFY_CHARGES_SYNC_FAILED",
        }),
      }),
    );
  });

  it("runs analytical recalculation jobs per shop and run id", async () => {
    const boss = createBoss();

    await registerAllProcessors(boss as any);

    const worker = boss.workers.get("reporting.recalculate");
    expect(worker).toBeTruthy();

    await worker!([{ data: { shopId: "shop-1", runId: "run-1" } }]);

    expect(mocks.runAnalyticalRecalculation).toHaveBeenCalledWith(
      "shop-1",
      "run-1",
      mocks.prisma,
    );
  });
});
