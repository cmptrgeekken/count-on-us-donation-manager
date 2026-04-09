import { authenticate } from "../shopify.server";

function getPlaywrightBypassShop(request: Request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("__playwrightShop");
  const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const isEnabled = process.env.PLAYWRIGHT_BYPASS_ENABLED === "true";

  if (!isEnabled || process.env.NODE_ENV === "production" || !isLocalHost || !shop) {
    return null;
  }

  return shop;
}

function normalizeShopDomain(dest: string) {
  if (dest.startsWith("https://") || dest.startsWith("http://")) {
    return new URL(dest).host;
  }

  return dest;
}

export async function authenticateCheckoutRequest(request: Request) {
  const bypassShop = getPlaywrightBypassShop(request);
  if (bypassShop) {
    return {
      shopifyDomain: bypassShop,
      cors: (response: Response) => response,
    };
  }

  const { sessionToken, cors } = await authenticate.public.checkout(request);
  return {
    shopifyDomain: normalizeShopDomain(sessionToken.dest),
    cors,
  };
}
