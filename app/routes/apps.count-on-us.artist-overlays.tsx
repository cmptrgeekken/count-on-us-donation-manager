import { jsonResponse } from "~/utils/json-response.server";
import type { LoaderFunctionArgs } from "@remix-run/node";

import { buildPublicProductArtistOverlay } from "../services/publicMerchandising.server";
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
    key: `artist-overlays:${shopifyDomain}:${getClientIpAddress(request)}`,
    limit: 120,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    throw new Response("Too many artist overlay requests. Please try again shortly.", {
      status: 429,
      headers: rateLimit.headers,
    });
  }

  const url = new URL(request.url);
  const products = (url.searchParams.get("products") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const handles = (url.searchParams.get("handles") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const payload = await buildPublicProductArtistOverlay(shopifyDomain, products, handles);
  const headers = new Headers(rateLimit.headers);
  headers.set("Cache-Control", "private, max-age=60");
  return jsonResponse(payload, { headers });
};
