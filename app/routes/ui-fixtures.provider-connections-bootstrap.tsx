import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-provider-connections.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.providerCostCache.deleteMany({
    where: {
      mapping: {
        shopId,
      },
    },
  });

  await prisma.providerVariantMapping.deleteMany({
    where: { shopId },
  });

  await prisma.providerConnection.deleteMany({
    where: { shopId },
  });

  await prisma.variantCostConfig.deleteMany({
    where: { shopId },
  });

  await prisma.variant.deleteMany({
    where: { shopId },
  });

  await prisma.product.deleteMany({
    where: { shopId },
  });

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain: shopId,
      currency: "USD",
      catalogSynced: true,
    },
    create: {
      shopId,
      shopifyDomain: shopId,
      currency: "USD",
      catalogSynced: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      shopId,
      shopifyId: "gid://shopify/Product/9100",
      title: "Provider Fixture Product",
      handle: "provider-fixture-product",
      status: "active",
      syncedAt: new Date("2026-04-09T12:00:00Z"),
    },
  });

  await prisma.variant.createMany({
    data: [
      {
        shopId,
        productId: product.id,
        shopifyId: "gid://shopify/ProductVariant/9101",
        title: "Mapped-ready Variant",
        sku: "SKU-READY-001",
        price: "24.00",
        syncedAt: new Date("2026-04-09T12:00:00Z"),
      },
      {
        shopId,
        productId: product.id,
        shopifyId: "gid://shopify/ProductVariant/9102",
        title: "Missing SKU Variant",
        sku: null,
        price: "26.00",
        syncedAt: new Date("2026-04-09T12:00:00Z"),
      },
    ],
  });

  return Response.json({
    providerConnectionsUrl: `${baseUrl}/app/provider-connections?__playwrightShop=${shopId}`,
  });
};
