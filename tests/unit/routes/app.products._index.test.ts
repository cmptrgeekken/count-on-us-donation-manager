import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  isPlaywrightBypassRequest: vi.fn(),
  jobQueueSend: vi.fn(),
  prisma: {
    shop: {
      findUnique: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("pg-boss", () => ({
  PgBoss: vi.fn(() => ({
    send: mocks.jobQueueSend,
    start: vi.fn(),
    stop: vi.fn(),
    schedule: vi.fn(),
  })),
}));

vi.mock("../../../app/utils/admin-auth.server", () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
  isPlaywrightBypassRequest: mocks.isPlaywrightBypassRequest,
}));

vi.mock("../../../app/db.server", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../../../app/jobs/queue.server", () => ({
  jobQueue: {
    send: mocks.jobQueueSend,
  },
}));

describe("app.products._index action", () => {
  beforeEach(() => {
    mocks.authenticateAdminRequest.mockReset();
    mocks.isPlaywrightBypassRequest.mockReset();
    mocks.jobQueueSend.mockReset();
    mocks.prisma.auditLog.create.mockReset();
  });

  it("queues a full catalog sync for the current shop", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      session: { shop: "fixture-shop.myshopify.com" },
    });
    mocks.isPlaywrightBypassRequest.mockReturnValue(false);
    mocks.prisma.auditLog.create.mockResolvedValue(undefined);
    mocks.jobQueueSend.mockResolvedValue("job-1");

    const { action } = await import("../../../app/routes/app.products._index");
    const response = await action({
      request: new Request("http://localhost/app/products", {
        method: "POST",
        body: new URLSearchParams({ intent: "sync-catalog" }),
      }),
      params: {},
      context: {},
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message:
        "Catalog sync queued. Shopify products and variants will be added or refreshed without deleting your existing local seed data.",
    });
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(mocks.jobQueueSend).toHaveBeenCalledWith(
      "catalog.sync",
      { shopId: "fixture-shop.myshopify.com" },
      { singletonKey: "fixture-shop.myshopify.com", singletonSeconds: 900 },
    );
  }, 15_000);

  it("skips queueing during Playwright bypass requests", async () => {
    mocks.authenticateAdminRequest.mockResolvedValue({
      session: { shop: "fixture-shop.myshopify.com" },
    });
    mocks.isPlaywrightBypassRequest.mockReturnValue(true);
    mocks.prisma.auditLog.create.mockResolvedValue(undefined);

    const { action } = await import("../../../app/routes/app.products._index");
    const response = await action({
      request: new Request("http://localhost/app/products?__playwrightShop=fixture-shop.myshopify.com", {
        method: "POST",
        body: new URLSearchParams({ intent: "sync-catalog" }),
      }),
      params: {},
      context: {},
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message:
        "Catalog sync queued. Shopify products and variants will be added or refreshed without deleting your existing local seed data.",
    });
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(mocks.jobQueueSend).not.toHaveBeenCalled();
  });
});
