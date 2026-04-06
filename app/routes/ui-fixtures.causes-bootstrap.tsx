import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.shop.upsert({
    where: { shopId },
    update: { shopifyDomain, currency: "USD" },
    create: { shopId, shopifyDomain, currency: "USD" },
  });

  await prisma.productCauseAssignment.deleteMany({
    where: { shopId },
  });

  await prisma.cause.deleteMany({
    where: {
      shopId,
      name: {
        startsWith: "Playwright Cause UI",
      },
    },
  });

  return Response.json({
    shopId,
    causesUrl: `${baseUrl}/app/causes?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
