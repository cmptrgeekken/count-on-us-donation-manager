import { describe, expect, it, vi } from "vitest";

import { queueProviderSyncRun, runProviderSync } from "./providerSync.server";

describe("providerSync.server", () => {
  it("queues a validated provider refresh run", async () => {
    const send = { send: vi.fn().mockResolvedValue(undefined) };
    const createRun = vi.fn().mockResolvedValue({ id: "run_1" });
    const createAudit = vi.fn().mockResolvedValue(undefined);
    const db = {
      providerConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "connection_1",
          status: "validated",
        }),
      },
      providerSyncRun: {
        create: createRun,
      },
      auditLog: {
        create: createAudit,
      },
    };

    const result = await queueProviderSyncRun(
      {
        shopId: "fixture.myshopify.com",
        provider: "printify",
        trigger: "manual",
      },
      db as never,
      send as never,
    );

    expect(result.runId).toBe("run_1");
    expect(send.send).toHaveBeenCalledWith(
      "provider.sync",
      { shopId: "fixture.myshopify.com", runId: "run_1" },
      expect.objectContaining({
        singletonKey: "fixture.myshopify.com:printify",
      }),
    );
    expect(createAudit).toHaveBeenCalledOnce();
  });

  it("revalidates Printify state when a sync run executes", async () => {
    vi.stubEnv("PROVIDER_CREDENTIALS_SECRET", "provider-test-secret");

    const updateRun = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const updateConnection = vi.fn().mockResolvedValue(undefined);
    const upsertMapping = vi.fn().mockResolvedValue({ id: "mapping_1" });
    const updateManyMappings = vi.fn().mockResolvedValue({ count: 0 });
    const createManyCostCache = vi.fn().mockResolvedValue({ count: 1 });
    const createAudit = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 555, title: "Validated Shop" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          current_page: 1,
          last_page: 1,
          data: [
            {
              id: "prod_1",
              title: "Fixture Tee",
              blueprint_id: 10,
              print_provider_id: 20,
              updated_at: "2026-04-10T16:00:00Z",
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
    const db = {
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          currency: "USD",
        }),
      },
      providerSyncRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "run_1",
          shopId: "fixture.myshopify.com",
          provider: "printify",
          connectionId: "connection_1",
        }),
        update: updateRun,
      },
      providerConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "connection_1",
          provider: "printify",
          providerAccountId: "555",
          providerAccountName: "Validated Shop",
          credentialsEncrypted: "c2hvcnQ=.c2hvcnQ=.c2hvcnQ=",
        }),
        update: updateConnection,
      },
      variant: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "variant_1",
            sku: "SKU-READY-001",
          },
          {
            id: "variant_2",
            sku: "SKU-DUPLICATE",
          },
          {
            id: "variant_3",
            sku: "SKU-DUPLICATE",
          },
        ]),
      },
      providerVariantMapping: {
        upsert: upsertMapping,
        updateMany: updateManyMappings,
      },
      providerCostCache: {
        createMany: createManyCostCache,
      },
      auditLog: {
        create: createAudit,
      },
    };

    const { encryptProviderCredential } = await import("./providerCredentials.server");
    db.providerConnection.findUnique = vi.fn().mockResolvedValue({
      id: "connection_1",
      provider: "printify",
      credentialsEncrypted: encryptProviderCredential("pk_live_fixture"),
    });

    await runProviderSync(
      {
        shopId: "fixture.myshopify.com",
        runId: "run_1",
      },
      db as never,
      fetchMock as never,
    );

    expect(updateConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "connection_1" },
        data: expect.objectContaining({
          status: "validated",
          providerAccountId: "555",
        }),
      }),
    );
    expect(upsertMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          providerProductId: "prod_1",
          providerVariantId: "9001",
          providerSku: "SKU-READY-001",
          matchMethod: "sku",
        }),
      }),
    );
    const cachedCostArgs = createManyCostCache.mock.calls[0]?.[0];
    expect(cachedCostArgs.data).toHaveLength(1);
    expect(cachedCostArgs.data[0]).toEqual(
      expect.objectContaining({
        mappingId: "mapping_1",
        costLineType: "base_fulfillment",
        currency: "USD",
      }),
    );
    expect(cachedCostArgs.data[0].amount.toString()).toBe("12.99");
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PROVIDER_SYNC_COMPLETED",
        }),
      }),
    );
    expect(updateRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mappedCount: 1,
          unmappedCount: 2,
          cachedCostCount: 1,
        }),
      }),
    );
  });

  it("marks the connection unhealthy when Printify credentials stop validating", async () => {
    vi.stubEnv("PROVIDER_CREDENTIALS_SECRET", "provider-test-secret");

    const updateRun = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const updateConnection = vi.fn().mockResolvedValue(undefined);
    const createAudit = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({
        message: "Unauthorized",
      }),
    });
    const { encryptProviderCredential } = await import("./providerCredentials.server");
    const db = {
      shop: {
        findUnique: vi.fn(),
      },
      providerSyncRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "run_1",
          shopId: "fixture.myshopify.com",
          provider: "printify",
          connectionId: "connection_1",
        }),
        update: updateRun,
      },
      providerConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "connection_1",
          provider: "printify",
          providerAccountId: "555",
          providerAccountName: "Validated Shop",
          credentialsEncrypted: encryptProviderCredential("pk_live_fixture"),
        }),
        update: updateConnection,
      },
      variant: {
        findMany: vi.fn(),
      },
      providerVariantMapping: {
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
      providerCostCache: {
        createMany: vi.fn(),
      },
      auditLog: {
        create: createAudit,
      },
    };

    await expect(
      runProviderSync(
        {
          shopId: "fixture.myshopify.com",
          runId: "run_1",
        },
        db as never,
        fetchMock as never,
      ),
    ).rejects.toMatchObject({
      message: "Unauthorized",
    });

    expect(updateConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "connection_1" },
        data: expect.objectContaining({
          status: "sync_failed",
          lastValidationError: "Unauthorized",
          lastSyncError: "Unauthorized",
        }),
      }),
    );
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PROVIDER_SYNC_FAILED",
        }),
      }),
    );
  });
});
