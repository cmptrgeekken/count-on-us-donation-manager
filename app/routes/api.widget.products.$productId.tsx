import type { LoaderFunctionArgs } from "@remix-run/node";
import { Prisma } from "@prisma/client";

import { prisma } from "../db.server";
import {
  buildWidgetProductMetadata,
  buildWidgetProductPayload,
  WIDGET_RATE_LIMIT_PER_MINUTE,
} from "../services/widgetData.server";
import { authenticatePublicAppProxyRequest } from "../utils/public-auth.server";
import { checkRateLimit } from "../utils/rate-limit.server";

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Headers,
) {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers,
    },
  );
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const productId = params.productId?.trim();
  const url = new URL(request.url);
  const metadataOnly = url.searchParams.get("metadataOnly") === "1";

  if (!productId) {
    return errorResponse(400, "VALIDATION_ERROR", "Product ID is required.");
  }

  const { shopifyDomain } = await authenticatePublicAppProxyRequest(request);
  const [shop] = await prisma.$queryRaw<Array<{ shopId: string }>>(
    Prisma.sql`SELECT "shopId" FROM "Shop" WHERE "shopifyDomain" = ${shopifyDomain} LIMIT 1`,
  );

  if (!shop) {
    return errorResponse(404, "NOT_FOUND", "Shop not found for widget request.");
  }

  const rateLimit = checkRateLimit({
    key: `widget:${shop.shopId}`,
    limit: WIDGET_RATE_LIMIT_PER_MINUTE,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Too many widget requests for this shop. Please try again shortly.",
      rateLimit.headers,
    );
  }

  const payload = metadataOnly
    ? await buildWidgetProductMetadata(shop.shopId, productId, prisma)
    : await buildWidgetProductPayload(shop.shopId, productId, prisma);

  if (!payload) {
    return errorResponse(404, "NOT_FOUND", "Product not found for this shop.", rateLimit.headers);
  }

  const headers = new Headers(rateLimit.headers);
  headers.set("Cache-Control", "private, no-store");

  return Response.json({ data: payload }, { headers });
};
