import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.shop.upsert({
    where: { shopId },
    update: { shopifyDomain, currency: "USD" },
    create: { shopId, shopifyDomain, currency: "USD" },
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

  await prisma.materialLibraryItem.create({
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

  return Response.json({
    shopId,
    materialsUrl: `${baseUrl}/app/materials?__playwrightShop=${encodeURIComponent(shopId)}`,
    equipmentUrl: `${baseUrl}/app/equipment?__playwrightShop=${encodeURIComponent(shopId)}`,
    templatesUrl: `${baseUrl}/app/templates?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
