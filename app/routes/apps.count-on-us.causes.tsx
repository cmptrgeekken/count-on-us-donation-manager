import { jsonResponse } from "~/utils/json-response.server";
import type { LoaderFunctionArgs } from "@remix-run/node";

import { buildPublicCausesDirectory } from "../services/publicMerchandising.server";
import { authenticatePublicAppProxyRequest } from "../utils/public-auth.server";
import { checkRateLimit } from "../utils/rate-limit.server";

function getClientIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "anonymous";
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "anonymous";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shopifyDomain } = await authenticatePublicAppProxyRequest(request);
  const rateLimit = checkRateLimit({
    key: `public-causes:${shopifyDomain}:${getClientIpAddress(request)}`,
    limit: 60,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    throw new Response("Too many cause directory requests. Please try again shortly.", {
      status: 429,
      headers: rateLimit.headers,
    });
  }

  const payload = await buildPublicCausesDirectory(shopifyDomain);
  const headers = new Headers(rateLimit.headers);
  headers.set("Cache-Control", "private, max-age=60");
  return jsonResponse(payload, { headers });
};
