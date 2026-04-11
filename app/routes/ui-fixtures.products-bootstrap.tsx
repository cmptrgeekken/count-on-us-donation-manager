import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-products-sync.myshopify.com";
const shopifyDomain = "playwright-products-sync.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.auditLog.deleteMany({
    where: {
      shopId,
      action: {
        in: ["CATALOG_SYNC_REQUESTED", "CATALOG_SYNC_COMPLETED"],
      },
    },
  });

  await prisma.product.deleteMany({ where: { shopId } });

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain,
      currency: "USD",
      catalogSynced: true,
    },
    create: {
      shopId,
      shopifyDomain,
      currency: "USD",
      catalogSynced: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Shop",
      action: "CATALOG_SYNC_COMPLETED",
      actor: "system",
      payload: {
        productCount: 2,
        variantCount: 3,
      },
      createdAt: new Date("2026-04-09T12:00:00Z"),
    },
  });

  return Response.json({
    productsUrl: `${baseUrl}/app/products?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
