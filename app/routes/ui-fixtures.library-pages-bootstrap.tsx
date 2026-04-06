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

  await prisma.materialLibraryItem.deleteMany({
    where: {
      shopId,
      name: {
        startsWith: "Playwright Material UI",
      },
    },
  });

  await prisma.equipmentLibraryItem.deleteMany({
    where: {
      shopId,
      name: {
        startsWith: "Playwright Equipment UI",
      },
    },
  });

  await prisma.costTemplate.deleteMany({
    where: {
      shopId,
      name: {
        startsWith: "Playwright Template UI",
      },
    },
  });

  return Response.json({
    shopId,
    materialsUrl: `${baseUrl}/app/materials?__playwrightShop=${encodeURIComponent(shopId)}`,
    equipmentUrl: `${baseUrl}/app/equipment?__playwrightShop=${encodeURIComponent(shopId)}`,
    templatesUrl: `${baseUrl}/app/templates?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
