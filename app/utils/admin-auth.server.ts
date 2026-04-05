import { authenticate } from "../shopify.server";

type AdminAuthResult = Awaited<ReturnType<typeof authenticate.admin>>;

function getPlaywrightBypassShop(request: Request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("__playwrightShop");
  const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";

  if (process.env.NODE_ENV === "production" || !isLocalHost || !shop) {
    return null;
  }

  return shop;
}

export async function authenticateAdminRequest(request: Request): Promise<AdminAuthResult> {
  const bypassShop = getPlaywrightBypassShop(request);

  if (bypassShop) {
    return {
      admin: undefined,
      billing: undefined,
      cors: () => new Response(),
      redirect: () => new Response(),
      session: {
        shop: bypassShop,
      },
    } as unknown as AdminAuthResult;
  }

  return authenticate.admin(request);
}
