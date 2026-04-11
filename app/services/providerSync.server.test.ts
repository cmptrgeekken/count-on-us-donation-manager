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
    const createAudit = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 555, title: "Validated Shop" }],
      }),
    });
    const db = {
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
          credentialsEncrypted: "c2hvcnQ=.c2hvcnQ=.c2hvcnQ=",
        }),
        update: updateConnection,
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
          providerAccountName: "Validated Shop",
        }),
      }),
    );
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PROVIDER_SYNC_COMPLETED",
        }),
      }),
    );
  });
});
