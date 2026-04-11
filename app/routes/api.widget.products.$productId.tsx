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
  const variantId = url.searchParams.get("variantId")?.trim() || "";
  const quantityParam = url.searchParams.get("quantity")?.trim() || "";
  const lineSubtotalParam = url.searchParams.get("lineSubtotal")?.trim() || "";

  if (!productId) {
    return errorResponse(400, "VALIDATION_ERROR", "Product ID is required.");
  }

  let lineContext:
    | {
        variantShopifyId: string;
        quantity: number;
        lineSubtotal: Prisma.Decimal | null;
      }
    | undefined;

  if (!metadataOnly && variantId) {
    const quantity = Number.parseInt(quantityParam || "1", 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      return errorResponse(400, "VALIDATION_ERROR", "Quantity must be a positive integer.");
    }

    let lineSubtotal: Prisma.Decimal | null = null;
    if (lineSubtotalParam) {
      if (!/^\d+(\.\d{1,2})?$/.test(lineSubtotalParam)) {
        return errorResponse(400, "VALIDATION_ERROR", "Line subtotal must be a valid money amount.");
      }
      lineSubtotal = new Prisma.Decimal(lineSubtotalParam);
    }

    lineContext = {
      variantShopifyId: variantId,
      quantity,
      lineSubtotal,
    };
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
    : await buildWidgetProductPayload(shop.shopId, productId, prisma, lineContext);

  if (!payload) {
    return errorResponse(404, "NOT_FOUND", "Product not found for this shop.", rateLimit.headers);
  }

  const headers = new Headers(rateLimit.headers);
  headers.set("Cache-Control", "private, no-store");

  return Response.json({ data: payload }, { headers });
};
