import { Prisma } from "@prisma/client";
import { jsonResponse } from "~/utils/json-response.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "../db.server";

const shopId = "playwright-reporting-imports.myshopify.com";
const shopifyOrderId = "gid://shopify/Order/900000000901";

export const loader = async ({ request }: LoaderFunctionArgs): Promise<Response> => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.shop.upsert({
    where: { shopId },
    update: { shopifyDomain: shopId, currency: "USD" },
    create: { shopId, shopifyDomain: shopId, currency: "USD" },
  });
  await prisma.orderSnapshot.deleteMany({ where: { shopId, shopifyOrderId } });
  await prisma.orderRecord.deleteMany({ where: { shopId, shopifyOrderId } });

  const snapshot = await prisma.orderSnapshot.create({
    data: {
      shopId,
      shopifyOrderId,
      orderRecord: { create: { shopId, shopifyOrderId } },
      orderNumber: "#1901",
      origin: "historical_import",
      subtotalAmount: new Prisma.Decimal("25.00"),
      totalAmount: new Prisma.Decimal("25.00"),
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      lines: {
        create: {
          shopId,
          shopifyLineItemId: "gid://shopify/LineItem/900000000901",
          shopifyVariantId: "gid://shopify/ProductVariant/900000000901",
          variantTitle: "Default Title",
          productTitle: "Historical product",
          quantity: 1,
          salePrice: new Prisma.Decimal("25.00"),
          subtotal: new Prisma.Decimal("25.00"),
          laborCost: new Prisma.Decimal("0"),
          materialCost: new Prisma.Decimal("0"),
          packagingCost: new Prisma.Decimal("0"),
          equipmentCost: new Prisma.Decimal("0"),
          mistakeBufferAmount: new Prisma.Decimal("0"),
          totalCost: new Prisma.Decimal("0"),
          netContribution: new Prisma.Decimal("25.00"),
        },
      },
    },
  });
  await prisma.orderRecord.update({
    where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
    data: {
      currentSnapshotId: snapshot.id,
      lifecycle: { create: { shopId, state: "active", financialStatus: "paid", source: "historical_import" } },
    },
  });

  return jsonResponse({
    snapshotOrderId: shopifyOrderId,
    reportingImportsUrl: `${baseUrl}/app/reporting-imports?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
