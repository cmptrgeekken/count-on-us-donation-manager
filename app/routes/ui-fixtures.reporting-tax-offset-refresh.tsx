import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { refreshTaxOffsetCacheForShop } from "../services/reportingService.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (process.env.NODE_ENV === "production") {
    throw new Response("Not found", { status: 404 });
  }

  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const cache = await refreshTaxOffsetCacheForShop(shopId);

  return Response.json({
    ok: true,
    shopId,
    cache: {
      taxableExposure: cache.taxableExposure.toString(),
      deductionPool: cache.deductionPool.toString(),
      cumulativeNetContrib: cache.cumulativeNetContrib.toString(),
      widgetTaxSuppressed: cache.widgetTaxSuppressed,
    },
  });
};
