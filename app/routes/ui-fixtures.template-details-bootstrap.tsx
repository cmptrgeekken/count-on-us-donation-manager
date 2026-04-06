import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

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

  await prisma.costTemplate.deleteMany({
    where: { shopId },
  });

  await prisma.materialLibraryItem.deleteMany({
    where: { shopId },
  });

  await prisma.equipmentLibraryItem.deleteMany({
    where: { shopId },
  });

  const material = await prisma.materialLibraryItem.create({
    data: {
      shopId,
      name: "Fixture Laminate",
      type: "production",
      costingModel: "yield",
      purchasePrice: "10.00",
      purchaseQty: "1.00",
      perUnitCost: "10.000000",
      totalUsesPerUnit: null,
      status: "active",
    },
  });

  await prisma.materialLibraryItem.create({
    data: {
      shopId,
      name: "Fixture Backer",
      type: "production",
      costingModel: "yield",
      purchasePrice: "6.00",
      purchaseQty: "1.00",
      perUnitCost: "6.000000",
      totalUsesPerUnit: null,
      status: "active",
    },
  });

  const equipment = await prisma.equipmentLibraryItem.create({
    data: {
      shopId,
      name: "Fixture Cutter",
      hourlyRate: "30.00",
      perUseCost: null,
      status: "active",
    },
  });

  await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Playwright Shipping Template A",
      type: "shipping",
      status: "active",
    },
  });

  await prisma.materialLibraryItem.create({
    data: {
      shopId,
      name: "Fixture Shipping Mailer",
      type: "shipping",
      costingModel: "yield",
      purchasePrice: "4.00",
      purchaseQty: "1.00",
      perUnitCost: "4.000000",
      totalUsesPerUnit: null,
      status: "active",
    },
  });

  const shippingTemplateB = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Playwright Shipping Template B",
      type: "shipping",
      status: "active",
    },
  });

  const template = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Playwright Template",
      type: "production",
      description: "Original description",
      status: "active",
      materialLines: {
        create: {
          materialId: material.id,
          quantity: "1.00",
          yield: "10.00",
        },
      },
      equipmentLines: {
        create: {
          equipmentId: equipment.id,
          minutes: "5.00",
        },
      },
    },
  });

  const shippingTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Playwright Shipping Detail Template",
      type: "shipping",
      status: "active",
    },
  });

  return Response.json({
    shopId,
    templateId: template.id,
    shippingTemplateId: shippingTemplate.id,
    shippingTemplateBId: shippingTemplateB.id,
    templateUrl: `${baseUrl}/app/templates/${template.id}?__playwrightShop=${encodeURIComponent(shopId)}`,
    shippingTemplateUrl: `${baseUrl}/app/templates/${shippingTemplate.id}?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
