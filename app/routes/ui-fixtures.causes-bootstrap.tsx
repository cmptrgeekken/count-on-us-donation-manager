import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";
const productShopifyId = "gid://shopify/Product/900000000201";

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

  const syncedAt = new Date();
  const product = await prisma.product.upsert({
    where: {
      shopId_shopifyId: {
        shopId,
        shopifyId: productShopifyId,
      },
    },
    update: {
      title: "Playwright Cause Product",
      handle: "playwright-cause-product",
      status: "active",
      syncedAt,
    },
    create: {
      shopId,
      shopifyId: productShopifyId,
      title: "Playwright Cause Product",
      handle: "playwright-cause-product",
      status: "active",
      syncedAt,
    },
  });

  const assignedCause = await prisma.cause.create({
    data: {
      shopId,
      name: "Playwright Cause UI Assigned",
      legalName: "Playwright Cause UI Assigned Foundation",
      status: "active",
      is501c3: true,
    },
  });

  await prisma.productCauseAssignment.create({
    data: {
      shopId,
      shopifyProductId: product.shopifyId,
      causeId: assignedCause.id,
      productId: product.id,
      percentage: "25.00",
    },
  });

  return Response.json({
    shopId,
    causesUrl: `${baseUrl}/app/causes?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
