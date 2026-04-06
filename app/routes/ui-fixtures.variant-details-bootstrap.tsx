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

  await prisma.costTemplateMaterialLine.deleteMany({
    where: {
      template: {
        shopId,
        name: {
          in: [
            "Playwright Production Template",
            "Playwright Shipping Template",
            "Playwright Shipping Override Template",
          ],
        },
      },
    },
  });

  await prisma.costTemplateEquipmentLine.deleteMany({
    where: {
      template: {
        shopId,
        name: {
          in: [
            "Playwright Production Template",
            "Playwright Shipping Template",
            "Playwright Shipping Override Template",
          ],
        },
      },
    },
  });

  await prisma.costTemplate.deleteMany({
    where: {
      shopId,
      name: {
        in: [
          "Playwright Production Template",
          "Playwright Shipping Template",
          "Playwright Shipping Override Template",
        ],
      },
    },
  });

  await prisma.materialLibraryItem.deleteMany({
    where: {
      shopId,
      name: {
        in: ["Playwright Yield Material", "ZZZ Playwright Shipping Material"],
      },
    },
  });

  await prisma.materialLibraryItem.create({
    data: {
      shopId,
      name: "Playwright Yield Material",
      type: "production",
      costingModel: "yield",
      purchasePrice: "8.00",
      purchaseQty: "1.00",
      perUnitCost: "8.000000",
      totalUsesPerUnit: null,
      status: "active",
    },
  });

  const shippingMaterial = await prisma.materialLibraryItem.create({
    data: {
      shopId,
      name: "ZZZ Playwright Shipping Material",
      type: "shipping",
      costingModel: "yield",
      purchasePrice: "3.00",
      purchaseQty: "1.00",
      perUnitCost: "3.000000",
      totalUsesPerUnit: null,
      status: "active",
    },
  });

  const inheritedShippingTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Playwright Shipping Template",
      type: "shipping",
      status: "active",
    },
  });

  await prisma.costTemplateMaterialLine.create({
    data: {
      templateId: inheritedShippingTemplate.id,
      materialId: shippingMaterial.id,
      quantity: "1",
      yield: "1",
      usesPerVariant: null,
    },
  });

  await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Playwright Shipping Override Template",
      type: "shipping",
      status: "active",
    },
  });

  await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Playwright Production Template",
      type: "production",
      defaultShippingTemplateId: inheritedShippingTemplate.id,
      status: "active",
    },
  });

  return Response.json({
    shopId,
    variantId: variant.id,
    variantUrl: `${baseUrl}/app/variants/${variant.id}?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
