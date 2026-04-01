import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { jobQueue } from "../jobs/queue.server";

// GDPR compliance webhooks — must return 200 promptly.
// All three topics are enqueued for async processing.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[compliance] Received ${topic} for ${shop}`);

  await jobQueue.send("webhook.compliance", {
    shopId: shop,
    topic,
    payload,
  });

  return new Response(null, { status: 200 });
};
