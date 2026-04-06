import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";
const productShopifyId = "gid://shopify/Product/900000000101";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const syncedAt = new Date();

  await prisma.shop.upsert({
    where: { shopId },
    update: { shopifyDomain, currency: "USD" },
    create: { shopId, shopifyDomain, currency: "USD" },
  });

  const [product, existingCauseA, existingCauseB] = await Promise.all([
    prisma.product.upsert({
      where: {
        shopId_shopifyId: {
          shopId,
          shopifyId: productShopifyId,
        },
      },
      update: {
        title: "Playwright Donation Product",
        handle: "playwright-donation-product",
        status: "active",
        syncedAt,
      },
      create: {
        shopId,
        shopifyId: productShopifyId,
        title: "Playwright Donation Product",
        handle: "playwright-donation-product",
        status: "active",
        syncedAt,
      },
    }),
    prisma.cause.findFirst({
      where: {
        shopId,
        name: "Playwright Cause A",
      },
      select: { id: true },
    }),
    prisma.cause.findFirst({
      where: {
        shopId,
        name: "Playwright Cause B",
      },
      select: { id: true },
    }),
  ]);

  const [causeA, causeB] = await Promise.all([
    existingCauseA
      ? prisma.cause
          .updateMany({
            where: { id: existingCauseA.id, shopId },
            data: {
              status: "active",
              is501c3: true,
              legalName: "Playwright Cause A Foundation",
            },
          })
          .then(() =>
            prisma.cause.findFirstOrThrow({
              where: { id: existingCauseA.id, shopId },
            }),
          )
      : prisma.cause.create({
          data: {
            shopId,
            name: "Playwright Cause A",
            legalName: "Playwright Cause A Foundation",
            status: "active",
            is501c3: true,
          },
        }),
    existingCauseB
      ? prisma.cause
          .updateMany({
            where: { id: existingCauseB.id, shopId },
            data: {
              status: "active",
              is501c3: false,
              legalName: "Playwright Cause B Initiative",
            },
          })
          .then(() =>
            prisma.cause.findFirstOrThrow({
              where: { id: existingCauseB.id, shopId },
            }),
          )
      : prisma.cause.create({
          data: {
            shopId,
            name: "Playwright Cause B",
            legalName: "Playwright Cause B Initiative",
            status: "active",
            is501c3: false,
          },
        }),
  ]);

  await prisma.productCauseAssignment.deleteMany({
    where: {
      shopId,
      productId: product.id,
    },
  });

  await prisma.productCauseAssignment.create({
    data: {
      shopId,
      productId: product.id,
      shopifyProductId: product.shopifyId,
      causeId: causeA.id,
      percentage: 60,
    },
  });

  return Response.json({
    shopId,
    productId: product.id,
    secondCauseName: causeB.name,
    productUrl: `${baseUrl}/app/products/${product.id}?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
