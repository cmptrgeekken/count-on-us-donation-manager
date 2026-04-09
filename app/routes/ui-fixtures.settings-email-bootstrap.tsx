import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "../db.server";

const shopId = "playwright-settings-email.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain: shopId,
      currency: "USD",
      postPurchaseEmailEnabled: false,
      managedMarketsEnableDate: null,
    },
    create: {
      shopId,
      shopifyDomain: shopId,
      currency: "USD",
      postPurchaseEmailEnabled: false,
      managedMarketsEnableDate: null,
    },
  });

  return Response.json({
    settingsUrl: `${baseUrl}/app/settings?__playwrightShop=${shopId}`,
  });
};
