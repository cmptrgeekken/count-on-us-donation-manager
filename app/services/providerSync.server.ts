import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import { Prisma } from "@prisma/client";
import { decryptProviderCredential } from "./providerCredentials.server";
import { listPrintifyProducts, validatePrintifyApiKey } from "./printify.server";

type SyncDbClient = Pick<
  typeof prisma,
  "shop" | "providerConnection" | "providerSyncRun" | "auditLog" | "variant" | "providerVariantMapping" | "providerCostCache"
>;

type JobSender = Pick<typeof jobQueue, "send">;

function normalizeSku(value: string | null | undefined) {
  return value?.trim() || null;
}

function centsToDecimal(value: number) {
  return new Prisma.Decimal(value).div(100);
}

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
        providerAccountId: true,
        providerAccountName: true,
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

    const shopCurrency =
      (
        await db.shop.findUnique({
          where: { shopId: run.shopId },
          select: { currency: true },
        })
      )?.currency ?? "USD";

    const printifyShopId =
      validation.primaryShop && validation.primaryShop.id === connection.providerAccountId
        ? validation.primaryShop.id
        : connection.providerAccountId?.trim() || validation.primaryShop?.id;

    if (!printifyShopId) {
      throw new Error("Validated Printify credentials did not yield a usable shop id.");
    }

    const [printifyVariants, localVariants] = await Promise.all([
      listPrintifyProducts(
        decryptProviderCredential(connection.credentialsEncrypted),
        printifyShopId,
        fetchImpl,
      ),
      db.variant.findMany({
        where: {
          shopId: run.shopId,
          sku: {
            not: null,
          },
        },
        select: {
          id: true,
          sku: true,
        },
      }),
    ]);

    const localVariantsBySku = new Map<string, Array<{ id: string }>>();
    for (const variant of localVariants) {
      const sku = normalizeSku(variant.sku);
      if (!sku) continue;

      const current = localVariantsBySku.get(sku) ?? [];
      current.push({ id: variant.id });
      localVariantsBySku.set(sku, current);
    }

    const printifyVariantsBySku = new Map<string, typeof printifyVariants>();
    for (const variant of printifyVariants) {
      const sku = normalizeSku(variant.sku);
      if (!sku) continue;

      const current = printifyVariantsBySku.get(sku) ?? [];
      current.push(variant);
      printifyVariantsBySku.set(sku, current);
    }

    const matchedPairs = Array.from(localVariantsBySku.entries()).flatMap(([sku, localCandidates]) => {
      const providerCandidates = printifyVariantsBySku.get(sku) ?? [];
      if (localCandidates.length !== 1 || providerCandidates.length !== 1) {
        return [];
      }

      return [
        {
          localVariantId: localCandidates[0]!.id,
          providerVariant: providerCandidates[0]!,
        },
      ];
    });

    const syncedAt = new Date();

    const mappingResults = await Promise.all(
      matchedPairs.map(({ localVariantId, providerVariant }) =>
        db.providerVariantMapping.upsert({
          where: {
            connectionId_variantId: {
              connectionId: connection.id,
              variantId: localVariantId,
            },
          },
          update: {
            provider: connection.provider,
            status: "mapped",
            providerProductId: providerVariant.productId,
            providerProductTitle: providerVariant.productTitle,
            providerVariantId: providerVariant.variantId,
            providerVariantTitle: providerVariant.variantTitle,
            providerSku: normalizeSku(providerVariant.sku),
            matchMethod: "sku",
            lastCostSyncedAt: syncedAt,
            lastSyncError: null,
          },
          create: {
            shopId: run.shopId,
            connectionId: connection.id,
            variantId: localVariantId,
            provider: connection.provider,
            status: "mapped",
            providerProductId: providerVariant.productId,
            providerProductTitle: providerVariant.productTitle,
            providerVariantId: providerVariant.variantId,
            providerVariantTitle: providerVariant.variantTitle,
            providerSku: normalizeSku(providerVariant.sku),
            matchMethod: "sku",
            lastCostSyncedAt: syncedAt,
            lastSyncError: null,
          },
          select: {
            id: true,
          },
        }),
      ),
    );

    const cachedCostRows = mappingResults.flatMap((mappingResult, index) => {
      const providerVariant = matchedPairs[index]?.providerVariant;
      if (!providerVariant || typeof providerVariant.cost !== "number") {
        return [];
      }

      return [
        {
          mappingId: mappingResult.id,
          costLineType: "base_fulfillment",
          description: providerVariant.variantTitle ?? providerVariant.productTitle ?? "Printify fulfillment cost",
          amount: centsToDecimal(providerVariant.cost),
          currency: shopCurrency,
          syncedAt,
          sourceUpdatedAt: providerVariant.productUpdatedAt,
          staleReason: null,
        },
      ];
    });

    const matchedLocalVariantIds = matchedPairs.map((pair) => pair.localVariantId);
    await db.providerVariantMapping.updateMany({
      where: {
        connectionId: connection.id,
        matchMethod: "sku",
        ...(matchedLocalVariantIds.length > 0
          ? {
              variantId: {
                notIn: matchedLocalVariantIds,
              },
            }
          : {}),
      },
      data: {
        status: "unresolved",
        lastSyncError: "No unique Printify SKU match was found during the latest sync.",
      },
    });

    if (cachedCostRows.length > 0) {
      await db.providerCostCache.createMany({
        data: cachedCostRows,
      });
    }

    const now = new Date();

    await db.providerConnection.update({
      where: { id: connection.id },
      data: {
        status: "validated",
        providerAccountId: printifyShopId,
        providerAccountName:
          validation.primaryShop?.id === printifyShopId
            ? validation.primaryShop.title
            : connection.providerAccountName,
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
        mappedCount: matchedPairs.length,
        unmappedCount: Math.max(localVariants.length - matchedPairs.length, 0),
        cachedCostCount: cachedCostRows.length,
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
          primaryShopId: printifyShopId,
          primaryShopName:
            validation.primaryShop?.id === printifyShopId
              ? validation.primaryShop.title
              : connection.providerAccountName,
          shopCount: validation.shopCount,
          mappedCount: matchedPairs.length,
          unmappedCount: Math.max(localVariants.length - matchedPairs.length, 0),
          cachedCostCount: cachedCostRows.length,
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
