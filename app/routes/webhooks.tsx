import type { ActionFunctionArgs } from "@remix-run/node";
import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import { verifyWebhookHmac } from "../middleware/hmac.server";
import { parseCatalogWebhookOperation } from "../utils/shopify-webhook-resource";

async function queueSettledSync(
  queueName: "catalog.sync.incremental" | "catalog.sync.collection",
  data:
    | { shopId: string; productGid: string }
    | { shopId: string; collectionGid: string },
  singletonKey: string,
): Promise<void> {
  await jobQueue.send(queueName, data, {
    singletonKey: `${singletonKey}:immediate`,
    singletonSeconds: 30,
  });
  await jobQueue.sendAfter(
    queueName,
    data,
    { singletonKey: `${singletonKey}:settled`, singletonSeconds: 120 },
    new Date(Date.now() + 45_000),
  );
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Read raw body before any parsing — HMAC depends on unmodified bytes
  const rawBody = Buffer.from(await request.arrayBuffer());

  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256") ?? "";
  const secret = process.env.SHOPIFY_API_SECRET ?? "";

  if (!verifyWebhookHmac(rawBody, hmacHeader, secret)) {
    return new Response(null, { status: 401 });
  }

  const topic = request.headers.get("X-Shopify-Topic") ?? "";
  const shop = request.headers.get("X-Shopify-Shop-Domain") ?? "";

  console.log(`[webhook] Received ${topic}`);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return new Response(null, { status: 400 });
  }

  const catalogOperation = parseCatalogWebhookOperation(topic, payload);
  if (catalogOperation === null) return new Response(null, { status: 400 });
  if (catalogOperation?.kind === "product-sync") {
    await queueSettledSync(
      "catalog.sync.incremental",
      { shopId: shop, productGid: catalogOperation.productGid },
      `${shop}:${catalogOperation.productGid}`,
    );
    return new Response(null, { status: 200 });
  }
  if (catalogOperation?.kind === "product-delete") {
    await prisma.product.deleteMany({
      where: { shopId: shop, shopifyId: catalogOperation.productGid },
    });
    return new Response(null, { status: 200 });
  }
  if (catalogOperation?.kind === "collection-sync") {
    await queueSettledSync(
      "catalog.sync.collection",
      { shopId: shop, collectionGid: catalogOperation.collectionGid },
      `${shop}:${catalogOperation.collectionGid}`,
    );
    return new Response(null, { status: 200 });
  }
  if (catalogOperation?.kind === "collection-delete") {
    await prisma.shopifyCollection.deleteMany({
      where: { shopId: shop, shopifyId: catalogOperation.collectionGid },
    });
    return new Response(null, { status: 200 });
  }

  switch (topic) {
    case "app/uninstalled":
      await handleAppUninstalled(shop);
      break;

    case "orders/create":
      await jobQueue.send("orders.snapshot", {
        shopId: shop,
        shopifyOrderId:
          (payload as { admin_graphql_api_id?: string })
            ?.admin_graphql_api_id ??
          (payload as { id?: string | number })?.id?.toString() ??
          "unknown",
        payload,
      });
      break;

    case "orders/updated":
      await jobQueue.send("orders.updated", {
        shopId: shop,
        shopifyOrderId:
          (payload as { admin_graphql_api_id?: string })
            ?.admin_graphql_api_id ??
          (payload as { id?: string | number })?.id?.toString() ??
          "unknown",
        payload,
      });
      break;

    case "refunds/create":
      await jobQueue.send("orders.refund", {
        shopId: shop,
        payload,
      });
      break;

    default:
      console.warn(`[webhook] Unhandled topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};

async function handleAppUninstalled(shopId: string): Promise<void> {
  // Phase 1: no metaobjects or metafields exist yet — skip that step.
  // Phase 2+ will add metaobject/metafield deletion here before the job is queued.

  // Delete sessions immediately so the shop cannot re-authenticate with stale tokens
  await prisma.session.deleteMany({ where: { shop: shopId } });

  // Check if a deletion job already exists (idempotency — webhook may fire twice)
  const existing = await prisma.deletionJob.findUnique({ where: { shopId } });
  if (existing) return;

  const scheduledFor = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const deletionJob = await prisma.deletionJob.create({
    data: {
      shopId,
      scheduledFor,
      status: "pending",
    },
  });

  // Enqueue deletion to run 48 hours from now
  await jobQueue.sendAfter(
    "shop.delete",
    { shopId, deletionJobId: deletionJob.id },
    {},
    scheduledFor,
  );

  console.log(
    `[webhook] APP_UNINSTALLED: DeletionJob created for ${shopId}, scheduled for ${scheduledFor.toISOString()}`,
  );
}
