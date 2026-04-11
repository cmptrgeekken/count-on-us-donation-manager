import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateAdminRequest = vi.fn();
const isPlaywrightBypassRequest = vi.fn();
const jobQueueSend = vi.fn();

const prisma = {
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
};

vi.mock("../../../app/utils/admin-auth.server", () => ({
  authenticateAdminRequest,
  isPlaywrightBypassRequest,
}));

vi.mock("../../../app/db.server", () => ({
  prisma,
}));

vi.mock("../../../app/jobs/queue.server", () => ({
  jobQueue: {
    send: jobQueueSend,
  },
}));

describe("app.products._index action", () => {
  beforeEach(() => {
    authenticateAdminRequest.mockReset();
    isPlaywrightBypassRequest.mockReset();
    jobQueueSend.mockReset();
    prisma.auditLog.create.mockReset();
  });

  it("queues a full catalog sync for the current shop", async () => {
    authenticateAdminRequest.mockResolvedValue({
      session: { shop: "fixture-shop.myshopify.com" },
    });
    isPlaywrightBypassRequest.mockReturnValue(false);
    prisma.auditLog.create.mockResolvedValue(undefined);
    jobQueueSend.mockResolvedValue("job-1");

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
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(jobQueueSend).toHaveBeenCalledWith(
      "catalog.sync",
      { shopId: "fixture-shop.myshopify.com" },
      { singletonKey: "fixture-shop.myshopify.com", singletonSeconds: 900 },
    );
  });

  it("skips queueing during Playwright bypass requests", async () => {
    authenticateAdminRequest.mockResolvedValue({
      session: { shop: "fixture-shop.myshopify.com" },
    });
    isPlaywrightBypassRequest.mockReturnValue(true);
    prisma.auditLog.create.mockResolvedValue(undefined);

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
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(jobQueueSend).not.toHaveBeenCalled();
  });
});
