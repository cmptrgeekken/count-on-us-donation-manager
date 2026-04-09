import type { LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import {
  buildConfirmedOrderDonationSummary,
  buildPendingOrderDonationSummary,
  fetchOrderForPostPurchaseEstimate,
} from "../services/postPurchaseDonation.server";
import { authenticateCheckoutRequest } from "../utils/checkout-auth.server";
import { checkRateLimit } from "../utils/rate-limit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const orderId = params.orderId?.trim();
  if (!orderId) {
    throw new Response("Order id is required.", { status: 400 });
  }

  const { shopifyDomain, cors } = await authenticateCheckoutRequest(request);
  const rateLimit = checkRateLimit({
    key: `post-purchase-donation:${shopifyDomain}:${orderId}`,
    limit: 10,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return cors(
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many donation summary requests." } }), {
        status: 429,
        headers: {
          ...Object.fromEntries(rateLimit.headers.entries()),
          "Content-Type": "application/json",
        },
      }),
    );
  }

  const confirmed = await buildConfirmedOrderDonationSummary(orderId, shopifyDomain);
  if (confirmed) {
    return cors(
      Response.json(
        { data: confirmed },
        {
          status: 200,
          headers: rateLimit.headers,
        },
      ),
    );
  }

  const { admin } = await unauthenticated.admin(shopifyDomain);
  const order = await fetchOrderForPostPurchaseEstimate(orderId, admin as Parameters<typeof fetchOrderForPostPurchaseEstimate>[1]);
  if (!order) {
    return cors(
      Response.json(
        { error: { code: "NOT_FOUND", message: "Order not found." } },
        {
          status: 404,
          headers: rateLimit.headers,
        },
      ),
    );
  }

  const pending = await buildPendingOrderDonationSummary(order, shopifyDomain);
  if (!pending) {
    return cors(
      Response.json(
        { error: { code: "NO_DONATION_PRODUCTS", message: "No donation products found for this order." } },
        {
          status: 404,
          headers: rateLimit.headers,
        },
      ),
    );
  }

  return cors(
    Response.json(
      { data: pending },
      {
        status: 202,
        headers: rateLimit.headers,
      },
    ),
  );
};
