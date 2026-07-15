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
  await prisma.importBatch.deleteMany({ where: { shopId } });
  await prisma.importBatch.create({
    data: {
      shopId,
      kind: "orders",
      status: "completed_with_errors",
      sourceName: "sample-orders.csv",
      sourceType: "csv",
      completedAt: new Date("2026-07-14T12:00:00.000Z"),
      summary: {
        kind: "orders",
        totalRows: 6,
        created: 3,
        updated: 0,
        skipped: 1,
        errors: [
          { row: 2, message: "Resolve line item mappings before importing this order." },
          { row: 3, message: "Resolve line item mappings before importing this order." },
        ],
        warnings: [
          { row: 2, message: "Line Tip could not be matched to a synced variant." },
          { row: 3, message: "Line Tip could not be matched to a synced variant." },
        ],
        lineMappingRequests: [{
          key: "tip|default title|",
          title: "Tip",
          variantTitle: "Default Title",
          sku: null,
          reason: "unresolved",
          candidates: [],
        }],
      },
    },
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
