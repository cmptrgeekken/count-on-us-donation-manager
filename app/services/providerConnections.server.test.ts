import { describe, expect, it, vi } from "vitest";

import {
  disconnectProviderConnection,
  getProviderConnectionsPageData,
  savePrintifyConnection,
} from "./providerConnections.server";

describe("providerConnections.server", () => {
  it("summarizes configured and unconfigured providers", async () => {
    const db = {
      providerConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "printify",
            authType: "api_key",
            status: "validated",
            displayName: "Fixture Shop",
            providerAccountName: "Fixture Shop",
            credentialHint: "****1234",
            lastValidatedAt: new Date("2026-04-09T17:00:00Z"),
            lastValidationError: null,
            lastSyncedAt: null,
            lastSyncError: null,
            updatedAt: new Date("2026-04-09T18:00:00Z"),
            _count: {
              mappings: 2,
            },
          },
        ]),
      },
      providerSyncRun: {
        findMany: vi.fn().mockResolvedValue([
          {
            provider: "printify",
            status: "completed",
            mappedCount: 3,
            unmappedCount: 1,
            cachedCostCount: 3,
          },
        ]),
      },
      variant: {
        count: vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(4),
      },
      auditLog: {},
    };

    const result = await getProviderConnectionsPageData("fixture.myshopify.com", db as never);

    expect(result.totalVariantCount).toBe(5);
    expect(result.variantsWithSkuCount).toBe(4);
    expect(result.summaries.find((summary) => summary.provider === "printify")?.configured).toBe(true);
    expect(result.summaries.find((summary) => summary.provider === "printify")?.status).toBe("validated");
    expect(result.summaries.find((summary) => summary.provider === "printify")?.mappedVariantCount).toBe(3);
    expect(result.summaries.find((summary) => summary.provider === "printify")?.unmappedVariantCount).toBe(1);
    expect(result.summaries.find((summary) => summary.provider === "printify")?.latestCachedCostCount).toBe(3);
    expect(result.summaries.find((summary) => summary.provider === "printful")?.configured).toBe(false);
  });

  it("validates and stores encrypted Printify credentials", async () => {
    vi.stubEnv("PROVIDER_CREDENTIALS_SECRET", "provider-test-secret");

    const upsert = vi.fn().mockResolvedValue({ id: "connection_1" });
    const createAudit = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 1234, title: "Fixture Shop" }],
      }),
    });
    const db = {
      providerConnection: {
        upsert,
      },
      providerSyncRun: {},
      auditLog: {
        create: createAudit,
      },
    };

    await savePrintifyConnection(
      {
        shopId: "fixture.myshopify.com",
        apiKey: "pk_live_fixture_printify_key_1234",
        displayName: "",
      },
      db as never,
      fetchMock as never,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledOnce();
    const upsertArgs = upsert.mock.calls[0]?.[0];
    expect(upsertArgs.update.status).toBe("validated");
    expect(upsertArgs.update.credentialHint).toBe("****1234");
    expect(upsertArgs.update.providerAccountId).toBe("1234");
    expect(upsertArgs.update.providerAccountName).toBe("Fixture Shop");
    expect(upsertArgs.update.credentialsEncrypted).not.toContain("pk_live_fixture_printify_key_1234");
    expect(createAudit).toHaveBeenCalledOnce();
  });

  it("disconnects a saved provider connection", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "connection_1" });
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const createAudit = vi.fn().mockResolvedValue(undefined);
    const db = {
      providerConnection: {
        findUnique,
        delete: deleteConnection,
      },
      providerSyncRun: {},
      auditLog: {
        create: createAudit,
      },
    };

    await disconnectProviderConnection(
      {
        shopId: "fixture.myshopify.com",
        provider: "printify",
      },
      db as never,
    );

    expect(findUnique).toHaveBeenCalledOnce();
    expect(deleteConnection).toHaveBeenCalledOnce();
    expect(createAudit).toHaveBeenCalledOnce();
  });
});
