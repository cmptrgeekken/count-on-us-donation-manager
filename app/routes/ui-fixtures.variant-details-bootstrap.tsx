import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";
const productShopifyId = "gid://shopify/Product/900000000001";
const variantShopifyId = "gid://shopify/ProductVariant/900000000001";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const syncedAt = new Date();

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain,
      currency: "USD",
    },
    create: {
      shopId,
      shopifyDomain,
      currency: "USD",
    },
  });

  const product = await prisma.product.upsert({
    where: {
      shopId_shopifyId: {
        shopId,
        shopifyId: productShopifyId,
      },
    },
    update: {
      title: "Playwright Test Product",
      handle: "playwright-test-product",
      status: "active",
      syncedAt,
    },
    create: {
      shopId,
      shopifyId: productShopifyId,
      title: "Playwright Test Product",
      handle: "playwright-test-product",
      status: "active",
      syncedAt,
    },
  });

  const variant = await prisma.variant.upsert({
    where: {
      shopId_shopifyId: {
        shopId,
        shopifyId: variantShopifyId,
      },
    },
    update: {
      productId: product.id,
      title: "Playwright Variant",
      sku: "PW-001",
      price: "19.99",
      syncedAt,
    },
    create: {
      shopId,
      shopifyId: variantShopifyId,
      productId: product.id,
      title: "Playwright Variant",
      sku: "PW-001",
      price: "19.99",
      syncedAt,
    },
  });

  await prisma.variantCostConfig.deleteMany({
    where: {
      shopId,
      variantId: variant.id,
    },
  });

  return Response.json({
    shopId,
    variantId: variant.id,
    variantUrl: `${baseUrl}/app/variants/${variant.id}?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
