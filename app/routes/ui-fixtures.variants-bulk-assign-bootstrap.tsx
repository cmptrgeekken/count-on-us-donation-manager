import { jsonResponse } from "~/utils/json-response.server";
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

  await prisma.materialLibraryItem.deleteMany({
    where: { shopId },
  });

  const oldTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Old Template",
      status: "active",
    },
  });

  const shippingTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Bulk Assigned Shipping Template",
      type: "shipping",
      status: "active",
    },
  });

  const newTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Bulk Assigned Template",
      status: "active",
      defaultShippingTemplateId: shippingTemplate.id,
    },
  });

  const [countedMaterial, yieldMaterial, usesMaterial, shippingMaterial] = await Promise.all([
    prisma.materialLibraryItem.create({
      data: { shopId, name: "Bulk Counted Material", type: "production", costingModel: "counted", purchasePrice: 10, purchaseQty: 10, perUnitCost: 1 },
    }),
    prisma.materialLibraryItem.create({
      data: { shopId, name: "Bulk Yield Material", type: "production", costingModel: "yield", purchasePrice: 10, purchaseQty: 1, perUnitCost: 10 },
    }),
    prisma.materialLibraryItem.create({
      data: { shopId, name: "Bulk Uses Material", type: "production", costingModel: "uses", purchasePrice: 10, purchaseQty: 1, perUnitCost: 10, totalUsesPerUnit: 20 },
    }),
    prisma.materialLibraryItem.create({
      data: { shopId, name: "Bulk Shipping Material", type: "shipping", costingModel: null, purchasePrice: 10, purchaseQty: 10, perUnitCost: 1 },
    }),
  ]);

  await prisma.costTemplateMaterialLine.createMany({
    data: [
      { templateId: newTemplate.id, materialId: countedMaterial.id, quantity: 2 },
      { templateId: newTemplate.id, materialId: yieldMaterial.id, quantity: 2, yield: 8 },
      { templateId: newTemplate.id, materialId: usesMaterial.id, quantity: 1, usesPerVariant: 3 },
      { templateId: shippingTemplate.id, materialId: shippingMaterial.id, quantity: 1 },
    ],
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

  const configuredCostConfig = await prisma.variantCostConfig.create({
    data: {
      shopId,
      variantId: configuredVariant.id,
      productionTemplateId: oldTemplate.id,
      lineItemCount: 4,
    },
  });

  await prisma.variantMaterialLine.createMany({
    data: [
      { shopId, configId: configuredCostConfig.id, materialId: countedMaterial.id, quantity: 2, yield: 99, usesPerVariant: 99 },
      { shopId, configId: configuredCostConfig.id, materialId: yieldMaterial.id, quantity: 2, yield: 8, usesPerVariant: 99 },
      { shopId, configId: configuredCostConfig.id, materialId: usesMaterial.id, quantity: 99, yield: 99, usesPerVariant: 3 },
      { shopId, configId: configuredCostConfig.id, materialId: shippingMaterial.id, quantity: 1, yield: 99, usesPerVariant: 99 },
    ],
  });

  return jsonResponse({
    shopId,
    newTemplateName: newTemplate.name,
    variantsUrl: `${baseUrl}/app/variants?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
