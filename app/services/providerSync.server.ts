import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import { decryptProviderCredential } from "./providerCredentials.server";
import { validatePrintifyApiKey } from "./printify.server";

type SyncDbClient = Pick<
  typeof prisma,
  "providerConnection" | "providerSyncRun" | "auditLog"
>;

type JobSender = Pick<typeof jobQueue, "send">;

export async function queueProviderSyncRun(
  input: {
    shopId: string;
    provider: "printify" | "printful";
    trigger: "manual";
  },
  db: SyncDbClient = prisma,
  send: JobSender = jobQueue,
): Promise<{ runId: string }> {
  const connection = await db.providerConnection.findUnique({
    where: {
      shopId_provider: {
        shopId: input.shopId,
        provider: input.provider,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!connection) {
    throw new Response("Provider connection not found.", { status: 404 });
  }

  if (input.provider === "printify" && connection.status !== "validated") {
    throw new Response("Validate Printify credentials before running provider refresh.", { status: 409 });
  }

  const run = await db.providerSyncRun.create({
    data: {
      shopId: input.shopId,
      connectionId: connection.id,
      provider: input.provider,
      trigger: input.trigger,
      status: "queued",
    },
    select: {
      id: true,
    },
  });

  await db.auditLog.create({
    data: {
      shopId: input.shopId,
      entity: "ProviderSyncRun",
      entityId: run.id,
      action: "PROVIDER_SYNC_QUEUED",
      actor: "merchant",
      payload: {
        provider: input.provider,
        trigger: input.trigger,
      },
    },
  });

  await send.send(
    "provider.sync",
    { shopId: input.shopId, runId: run.id },
    {
      singletonKey: `${input.shopId}:${input.provider}`,
      singletonSeconds: 10 * 60,
    },
  );

  return { runId: run.id };
}

export async function runProviderSync(
  input: {
    shopId: string;
    runId: string;
  },
  db: SyncDbClient = prisma,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const run = await db.providerSyncRun.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      shopId: true,
      provider: true,
      connectionId: true,
    },
  });

  if (!run || run.shopId !== input.shopId) {
    throw new Error("Provider sync run not found.");
  }

  await db.providerSyncRun.update({
    where: { id: run.id },
    data: {
      status: "running",
      startedAt: new Date(),
      errorSummary: null,
    },
  });

  try {
    const connection = await db.providerConnection.findUnique({
      where: { id: run.connectionId },
      select: {
        id: true,
        provider: true,
        credentialsEncrypted: true,
      },
    });

    if (!connection?.credentialsEncrypted) {
      throw new Error("Provider credentials are no longer available.");
    }

    if (connection.provider !== "printify") {
      throw new Error(`Unsupported provider sync target: ${connection.provider}`);
    }

    const validation = await validatePrintifyApiKey(
      decryptProviderCredential(connection.credentialsEncrypted),
      fetchImpl,
    );

    const now = new Date();

    await db.providerConnection.update({
      where: { id: connection.id },
      data: {
        status: "validated",
        providerAccountId: validation.primaryShop?.id ?? null,
        providerAccountName: validation.primaryShop?.title ?? null,
        lastValidatedAt: now,
        lastValidationError: null,
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });

    await db.providerSyncRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        completedAt: now,
        mappedCount: 0,
        unmappedCount: 0,
        cachedCostCount: 0,
      },
    });

    await db.auditLog.create({
      data: {
        shopId: run.shopId,
        entity: "ProviderSyncRun",
        entityId: run.id,
        action: "PROVIDER_SYNC_COMPLETED",
        actor: "system",
        payload: {
          provider: run.provider,
          primaryShopId: validation.primaryShop?.id ?? null,
          primaryShopName: validation.primaryShop?.title ?? null,
          shopCount: validation.shopCount,
          note: "Provider refresh currently revalidates credentials and account metadata. Mapping and cost import land in the next provider slice.",
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provider sync failure";

    await db.providerSyncRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorSummary: message,
      },
    });

    await db.providerConnection.update({
      where: { id: run.connectionId },
      data: {
        lastSyncError: message,
      },
    });

    await db.auditLog.create({
      data: {
        shopId: run.shopId,
        entity: "ProviderSyncRun",
        entityId: run.id,
        action: "PROVIDER_SYNC_FAILED",
        actor: "system",
        payload: {
          provider: run.provider,
          message,
        },
      },
    });

    throw error;
  }
}
