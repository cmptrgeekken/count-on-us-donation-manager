import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";
import { readPublicIcon } from "../services/publicIconStorage.server";
import { authenticatePublicAppProxyRequest } from "../utils/public-auth.server";
import { checkRateLimit } from "../utils/rate-limit.server";

function getClientIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "anonymous";
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "anonymous";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shopifyDomain } = await authenticatePublicAppProxyRequest(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id") ?? "";
  const rateLimit = checkRateLimit({
    key: `public-icons:${shopifyDomain}:${getClientIpAddress(request)}`,
    limit: 240,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    throw new Response("Too many icon requests. Please try again shortly.", {
      status: 429,
      headers: rateLimit.headers,
    });
  }

  const record =
    type === "artist"
      ? await prisma.artist.findFirst({
          where: { id, shopId: shopifyDomain, status: "active" },
          select: { iconStorageKey: true },
        })
      : type === "cause"
        ? await prisma.cause.findFirst({
            where: { id, shopId: shopifyDomain, status: "active" },
            select: { iconStorageKey: true },
          })
        : null;

  if (!record?.iconStorageKey) {
    throw new Response("Icon not found.", { status: 404 });
  }

  const icon = await readPublicIcon(record.iconStorageKey);
  const headers = new Headers(rateLimit.headers);
  headers.set("Content-Type", icon.contentType);
  headers.set("Content-Length", String(icon.size));
  headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

  const body = new Uint8Array(icon.body.byteLength);
  body.set(icon.body);
  return new Response(body.buffer, { headers });
};
