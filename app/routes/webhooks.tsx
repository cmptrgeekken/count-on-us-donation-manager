import type { ActionFunctionArgs } from "@remix-run/node";
import { prisma } from "../db.server";
import { jobQueue } from "../jobs/queue.server";
import { verifyWebhookHmac } from "../middleware/hmac.server";

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

  console.log(`[webhook] Received ${topic} for ${shop}`);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    payload = {};
  }

  switch (topic) {
    case "app/uninstalled":
      await handleAppUninstalled(shop);
      break;

    case "orders/create":
      await jobQueue.send("webhook.orders.create", {
        shopId: shop,
        orderId: (payload as { id?: string | number })?.id?.toString() ?? "unknown",
        topic,
      });
      break;

    case "orders/updated":
    case "refunds/create":
    case "products/update": {
      const productGid = (payload as { admin_graphql_api_id?: string })?.admin_graphql_api_id;
      if (productGid) {
        await jobQueue.send("catalog.sync.incremental", { shopId: shop, productGid });
      }
      break;
    }

    default:
      console.warn(`[webhook] Unhandled topic: ${topic} for ${shop}`);
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

  console.log(`[webhook] APP_UNINSTALLED: DeletionJob created for ${shopId}, scheduled for ${scheduledFor.toISOString()}`);
}
