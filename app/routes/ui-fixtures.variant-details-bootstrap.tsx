import { jsonResponse } from "~/utils/json-response.server";
import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";
const productShopifyId = "gid://shopify/Product/900000000001";
const variantShopifyId = "gid://shopify/ProductVariant/900000000001";
const sourceVariantShopifyId = "gid://shopify/ProductVariant/900000000002";

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

  const sourceVariant = await prisma.variant.upsert({
    where: {
      shopId_shopifyId: {
        shopId,
        shopifyId: sourceVariantShopifyId,
      },
    },
    update: {
      productId: product.id,
      title: "Playwright Source Variant",
      sku: "PW-SOURCE",
      price: "24.99",
      syncedAt,
    },
    create: {
      shopId,
      shopifyId: sourceVariantShopifyId,
      productId: product.id,
      title: "Playwright Source Variant",
      sku: "PW-SOURCE",
      price: "24.99",
      syncedAt,
    },
  });

  await prisma.variantCostConfig.deleteMany({
    where: {
      shopId,
      variantId: { in: [variant.id, sourceVariant.id] },
    },
  });

  await prisma.shippingPackage.deleteMany({
    where: {
      shopId,
      name: "Playwright Source Package",
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

  await prisma.equipmentLibraryItem.deleteMany({
    where: {
      shopId,
      name: "Playwright Heat Press",
    },
  });

  const productionMaterial = await prisma.materialLibraryItem.create({
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

  const heatPress = await prisma.equipmentLibraryItem.create({
    data: {
      shopId,
      name: "Playwright Heat Press",
      hourlyRate: "12.00",
      perUseCost: "0.25",
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

  const productionTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Playwright Production Template",
      type: "production",
      defaultShippingTemplateId: inheritedShippingTemplate.id,
      status: "active",
    },
  });

  const sourcePackage = await prisma.shippingPackage.create({
    data: {
      shopId,
      name: "Playwright Source Package",
      length: "10",
      width: "8",
      height: "3",
      emptyWeightGrams: "50",
      maxWeightGrams: "900",
      status: "active",
    },
  });

  await prisma.variantCostConfig.create({
    data: {
      shopId,
      variantId: sourceVariant.id,
      productionTemplateId: productionTemplate.id,
      shippingTemplateId: inheritedShippingTemplate.id,
      preferredPackageId: sourcePackage.id,
      packedLength: "10",
      packedWidth: "8",
      packedHeight: "3",
      packedWeightGrams: "250",
      canSharePackage: false,
      laborMinutes: "17",
      laborRate: "18.50",
      mistakeBuffer: "0.0750",
      lineItemCount: 2,
      materialLines: {
        create: [
          {
            shopId,
            materialId: productionMaterial.id,
            quantity: "2",
            yield: "5",
            usesPerVariant: null,
          },
        ],
      },
      equipmentLines: {
        create: [
          {
            shopId,
            equipmentId: heatPress.id,
            usageMode: "direct",
            minutes: "4",
            uses: "1",
          },
        ],
      },
    },
  });

  return jsonResponse({
    shopId,
    productId: product.id,
    variantId: variant.id,
    sourceVariantId: sourceVariant.id,
    variantUrl: `${baseUrl}/app/variants/${variant.id}?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
