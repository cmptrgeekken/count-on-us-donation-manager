import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAllProcessors } from "./processors.server";

const mocks = vi.hoisted(() => ({
  prisma: {
    shop: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  runReconciliation: vi.fn(),
  adminFactory: vi.fn(),
}));

vi.mock("../db.server", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../services/catalogSync.server", () => ({
  fullSync: vi.fn(),
  incrementalSync: vi.fn(),
}));

vi.mock("../services/adjustmentService.server", () => ({
  processOrderUpdate: vi.fn(),
  processRefund: vi.fn(),
}));

vi.mock("../services/reconciliationService.server", () => ({
  runReconciliation: mocks.runReconciliation,
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
});
