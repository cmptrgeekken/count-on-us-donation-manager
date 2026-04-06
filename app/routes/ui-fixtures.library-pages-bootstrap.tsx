import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";
const productShopifyId = "gid://shopify/Product/900000000101";
const variantShopifyId = "gid://shopify/ProductVariant/900000000101";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.shop.upsert({
    where: { shopId },
    update: { shopifyDomain, currency: "USD" },
    create: { shopId, shopifyDomain, currency: "USD" },
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
      title: "Playwright Library Product",
      handle: "playwright-library-product",
      status: "active",
      syncedAt,
    },
    create: {
      shopId,
      shopifyId: productShopifyId,
      title: "Playwright Library Product",
      handle: "playwright-library-product",
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
      title: "Playwright Library Variant",
      sku: "PW-LIB-001",
      price: "24.99",
      syncedAt,
    },
    create: {
      shopId,
      shopifyId: variantShopifyId,
      productId: product.id,
      title: "Playwright Library Variant",
      sku: "PW-LIB-001",
      price: "24.99",
      syncedAt,
    },
  });

  await prisma.variantCostConfig.deleteMany({
    where: { shopId, variantId: variant.id },
  });
  await prisma.costTemplate.deleteMany({
    where: {
      shopId,
      name: {
        startsWith: "Playwright Template UI",
      },
    },
  });

  const materialFixtureIds = (
    await prisma.materialLibraryItem.findMany({
      where: {
        shopId,
        OR: [
          {
            name: {
              startsWith: "Playwright Material UI",
            },
          },
          { name: "Fixture Laminate" },
        ],
      },
      select: { id: true },
    })
  ).map((material) => material.id);

  if (materialFixtureIds.length > 0) {
    await prisma.costTemplateMaterialLine.deleteMany({
      where: { materialId: { in: materialFixtureIds } },
    });

    await prisma.variantMaterialLine.deleteMany({
      where: { shopId, materialId: { in: materialFixtureIds } },
    });
  }

  await prisma.materialLibraryItem.deleteMany({
    where: {
      shopId,
      OR: [
        {
          name: {
            startsWith: "Playwright Material UI",
          },
        },
        { name: "Fixture Laminate" },
      ],
    },
  });

  await prisma.equipmentLibraryItem.deleteMany({
    where: {
      shopId,
      name: {
        startsWith: "Playwright Equipment UI",
      },
    },
  });

  const fixtureLaminate = await prisma.materialLibraryItem.create({
    data: {
      shopId,
      name: "Fixture Laminate",
      type: "production",
      costingModel: "yield",
      purchasePrice: "12.00",
      purchaseQty: "1.00",
      perUnitCost: "12.000000",
      totalUsesPerUnit: null,
      purchaseLink: "https://example.com/fixture-laminate",
      weightGrams: "250.000",
      status: "active",
      notes: null,
    },
  });

  const usedMaterial = await prisma.materialLibraryItem.create({
    data: {
      shopId,
      name: "Playwright Material UI Used",
      type: "production",
      costingModel: "yield",
      purchasePrice: "12.00",
      purchaseQty: "1.00",
      perUnitCost: "12.000000",
      totalUsesPerUnit: null,
      purchaseLink: null,
      weightGrams: null,
      status: "active",
      notes: null,
    },
  });

  await prisma.materialLibraryItem.create({
    data: {
      shopId,
      name: "Playwright Material UI Delete",
      type: "production",
      costingModel: "yield",
      purchasePrice: "10.00",
      purchaseQty: "1.00",
      perUnitCost: "10.000000",
      totalUsesPerUnit: null,
      purchaseLink: null,
      weightGrams: null,
      status: "active",
      notes: null,
    },
  });

  const usedEquipment = await prisma.equipmentLibraryItem.create({
    data: {
      shopId,
      name: "Playwright Equipment UI Used",
      hourlyRate: "30.00",
      perUseCost: null,
      status: "active",
    },
  });

  const usedTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Playwright Template UI Used",
      description: "Used by a fixture variant config",
      status: "active",
      materialLines: {
        create: [
          {
            materialId: usedMaterial.id,
            quantity: "1.00",
            yield: "12.00",
          },
          {
            materialId: fixtureLaminate.id,
            quantity: "1.00",
            yield: "12.00",
          },
        ],
      },
      equipmentLines: {
        create: {
          equipmentId: usedEquipment.id,
          minutes: "5.00",
        },
      },
    },
  });

  await prisma.variantCostConfig.create({
    data: {
      shopId,
      variantId: variant.id,
      productionTemplateId: usedTemplate.id,
      lineItemCount: 0,
    },
  });

  return Response.json({
    shopId,
    materialsUrl: `${baseUrl}/app/materials?__playwrightShop=${encodeURIComponent(shopId)}`,
    equipmentUrl: `${baseUrl}/app/equipment?__playwrightShop=${encodeURIComponent(shopId)}`,
    templatesUrl: `${baseUrl}/app/templates?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
