import type { LoaderFunctionArgs } from "@remix-run/node";

import { Prisma } from "@prisma/client";

import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";
const webhookOrderId = "gid://shopify/Order/900000000201";
const reconciliationOrderId = "gid://shopify/Order/900000000202";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.shop.upsert({
    where: { shopId },
    update: { shopifyDomain, currency: "USD" },
    create: { shopId, shopifyDomain, currency: "USD" },
  });

  await prisma.adjustment.deleteMany({
    where: {
      shopId,
      snapshotLine: {
        snapshot: {
          shopifyOrderId: {
            in: [webhookOrderId, reconciliationOrderId],
          },
        },
      },
    },
  });

  await prisma.orderSnapshot.deleteMany({
    where: {
      shopId,
      shopifyOrderId: {
        in: [webhookOrderId, reconciliationOrderId],
      },
    },
  });

  const [webhookSnapshot, reconciliationSnapshot] = await Promise.all([
    prisma.orderSnapshot.create({
      data: {
        shopId,
        shopifyOrderId: webhookOrderId,
        orderNumber: "#1001",
        origin: "webhook",
        createdAt: new Date("2026-04-05T12:00:00.000Z"),
        lines: {
          create: {
            shopId,
            shopifyLineItemId: "gid://shopify/LineItem/900000000301",
            shopifyVariantId: "gid://shopify/ProductVariant/900000000401",
            variantTitle: "Default Title",
            productTitle: "Playwright Snapshot Product",
            quantity: 1,
            salePrice: new Prisma.Decimal("25.00"),
            subtotal: new Prisma.Decimal("25.00"),
            laborCost: new Prisma.Decimal("2.0000"),
            materialCost: new Prisma.Decimal("3.0000"),
            packagingCost: new Prisma.Decimal("1.0000"),
            equipmentCost: new Prisma.Decimal("4.0000"),
            podCost: new Prisma.Decimal("0.0000"),
            mistakeBufferAmount: new Prisma.Decimal("0.5000"),
            totalCost: new Prisma.Decimal("10.5000"),
            netContribution: new Prisma.Decimal("14.5000"),
            materialLines: {
              create: {
                materialName: "Playwright Paper",
                materialType: "production",
                costingModel: "area",
                purchasePrice: new Prisma.Decimal("12.00"),
                purchaseQty: new Prisma.Decimal("100.0000"),
                perUnitCost: new Prisma.Decimal("0.1200"),
                quantity: new Prisma.Decimal("1.0000"),
                lineCost: new Prisma.Decimal("3.0000"),
              },
            },
            equipmentLines: {
              create: {
                equipmentName: "Playwright Press",
                hourlyRate: new Prisma.Decimal("60.00"),
                minutes: new Prisma.Decimal("4.00"),
                lineCost: new Prisma.Decimal("4.0000"),
              },
            },
          },
        },
      },
      include: {
        lines: {
          select: { id: true },
        },
      },
    }),
    prisma.orderSnapshot.create({
      data: {
        shopId,
        shopifyOrderId: reconciliationOrderId,
        orderNumber: "#1002",
        origin: "reconciliation",
        createdAt: new Date("2026-04-04T12:00:00.000Z"),
        lines: {
          create: {
            shopId,
            shopifyLineItemId: "gid://shopify/LineItem/900000000302",
            shopifyVariantId: "gid://shopify/ProductVariant/900000000402",
            variantTitle: "Archived Variant",
            productTitle: "Playwright Reconciled Product",
            quantity: 1,
            salePrice: new Prisma.Decimal("20.00"),
            subtotal: new Prisma.Decimal("20.00"),
            laborCost: new Prisma.Decimal("1.0000"),
            materialCost: new Prisma.Decimal("2.0000"),
            packagingCost: new Prisma.Decimal("0.5000"),
            equipmentCost: new Prisma.Decimal("1.5000"),
            podCost: new Prisma.Decimal("0.0000"),
            mistakeBufferAmount: new Prisma.Decimal("0.2500"),
            totalCost: new Prisma.Decimal("5.2500"),
            netContribution: new Prisma.Decimal("14.7500"),
          },
        },
      },
    }),
  ]);

  return Response.json({
    shopId,
    historyUrl: `${baseUrl}/app/order-history?__playwrightShop=${encodeURIComponent(shopId)}`,
    detailUrl: `${baseUrl}/app/order-history/${webhookSnapshot.id}?__playwrightShop=${encodeURIComponent(shopId)}`,
    snapshotLineId: webhookSnapshot.lines[0]?.id ?? "",
    webhookOrderNumber: webhookSnapshot.orderNumber,
    reconciliationOrderNumber: reconciliationSnapshot.orderNumber,
  });
};
