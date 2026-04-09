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

export async function authenticatePublicAppProxyRequest(request: Request) {
  const bypassShop = getPlaywrightBypassShop(request);

  if (bypassShop) {
    return {
      shopifyDomain: bypassShop,
    };
  }

  const context = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shopifyDomain = context.session?.shop ?? url.searchParams.get("shop")?.trim();

  if (!shopifyDomain) {
    throw Response.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Shop context is missing from the app proxy request.",
        },
      },
      { status: 401 },
    );
  }

  return {
    shopifyDomain,
  };
}
