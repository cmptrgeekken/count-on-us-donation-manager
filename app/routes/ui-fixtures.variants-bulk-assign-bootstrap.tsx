import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";
const productShopifyId = "gid://shopify/Product/900000000010";
const configuredVariantShopifyId = "gid://shopify/ProductVariant/900000000010";
const unconfiguredVariantShopifyId = "gid://shopify/ProductVariant/900000000011";

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

  await prisma.product.deleteMany({
    where: { shopId },
  });

  await prisma.costTemplate.deleteMany({
    where: { shopId },
  });

  const oldTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Old Template",
      status: "active",
    },
  });

  const newTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Bulk Assigned Template",
      status: "active",
    },
  });

  const product = await prisma.product.create({
    data: {
      shopId,
      shopifyId: productShopifyId,
      title: "Playwright Bulk Assignment Product",
      handle: "playwright-bulk-assignment-product",
      status: "active",
      syncedAt,
    },
  });

  const configuredVariant = await prisma.variant.create({
    data: {
      shopId,
      shopifyId: configuredVariantShopifyId,
      productId: product.id,
      title: "Configured Variant",
      sku: "PW-BULK-1",
      price: "29.99",
      syncedAt,
    },
  });

  await prisma.variant.create({
    data: {
      shopId,
      shopifyId: unconfiguredVariantShopifyId,
      productId: product.id,
      title: "Unconfigured Variant",
      sku: "PW-BULK-2",
      price: "24.99",
      syncedAt,
    },
  });

  await prisma.variantCostConfig.create({
    data: {
      shopId,
      variantId: configuredVariant.id,
      templateId: oldTemplate.id,
    },
  });

  return Response.json({
    shopId,
    newTemplateName: newTemplate.name,
    variantsUrl: `${baseUrl}/app/variants?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
