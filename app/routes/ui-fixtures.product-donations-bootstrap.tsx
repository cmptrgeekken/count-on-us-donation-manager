import { jsonResponse } from "~/utils/json-response.server";
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
      OR: [{ productId: product.id }, { shopifyProductId: product.shopifyId }],
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

  const [configuredVariant, unconfiguredVariant, existingTemplate] = await Promise.all([
    prisma.variant.upsert({
      where: {
        shopId_shopifyId: {
          shopId,
          shopifyId: "gid://shopify/ProductVariant/900000000201",
        },
      },
      update: {
        productId: product.id,
        title: "Small",
        sku: "PW-DONATION-S",
        price: 24,
        syncedAt,
      },
      create: {
        shopId,
        shopifyId: "gid://shopify/ProductVariant/900000000201",
        productId: product.id,
        title: "Small",
        sku: "PW-DONATION-S",
        price: 24,
        syncedAt,
      },
    }),
    prisma.variant.upsert({
      where: {
        shopId_shopifyId: {
          shopId,
          shopifyId: "gid://shopify/ProductVariant/900000000202",
        },
      },
      update: {
        productId: product.id,
        title: "Large",
        sku: "PW-DONATION-L",
        price: 32,
        syncedAt,
      },
      create: {
        shopId,
        shopifyId: "gid://shopify/ProductVariant/900000000202",
        productId: product.id,
        title: "Large",
        sku: "PW-DONATION-L",
        price: 32,
        syncedAt,
      },
    }),
    prisma.costTemplate.findFirst({
      where: { shopId, name: "Playwright Product Detail Template", type: "production" },
      select: { id: true },
    }),
  ]);

  const template = existingTemplate
    ? await prisma.costTemplate
        .updateMany({
          where: { id: existingTemplate.id, shopId },
          data: { status: "active" },
        })
        .then(() => prisma.costTemplate.findFirstOrThrow({ where: { id: existingTemplate.id, shopId } }))
    : await prisma.costTemplate.create({
        data: {
          shopId,
          name: "Playwright Product Detail Template",
          type: "production",
          status: "active",
        },
      });

  const configuredVariantCostConfig = await prisma.variantCostConfig.findFirst({
    where: { shopId, variantId: configuredVariant.id },
    select: { id: true },
  });
  if (configuredVariantCostConfig) {
    await prisma.variantCostConfig.updateMany({
      where: { id: configuredVariantCostConfig.id, shopId },
      data: { productionTemplateId: template.id },
    });
  } else {
    await prisma.variantCostConfig.create({
      data: {
        shopId,
        variantId: configuredVariant.id,
        productionTemplateId: template.id,
      },
    });
  }
  await prisma.variantCostConfig.deleteMany({
    where: {
      shopId,
      variantId: unconfiguredVariant.id,
    },
  });
  await prisma.variantCostConfig.create({
    data: {
      shopId,
      variantId: unconfiguredVariant.id,
    },
  });

  return jsonResponse({
    shopId,
    productId: product.id,
    secondCauseName: causeB.name,
    productUrl: `${baseUrl}/app/products/${product.id}?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
