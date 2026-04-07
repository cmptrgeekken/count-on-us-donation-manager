import type { LoaderFunctionArgs } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";

const shopId = "playwright-test-shop.myshopify.com";
const shopifyDomain = "playwright-test-shop.myshopify.com";
const snapshotOrderId = "gid://shopify/Order/900000000201";
const snapshotLineItemId = "gid://shopify/LineItem/900000000201";
const snapshotVariantId = "gid://shopify/ProductVariant/900000000201";
const chargeTransactionId = "gid://shopify/BalanceTransaction/900000000201";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.shop.upsert({
    where: { shopId },
    update: { shopifyDomain, currency: "USD" },
    create: { shopId, shopifyDomain, currency: "USD" },
  });

  await prisma.adjustment.deleteMany({ where: { shopId } });
  await prisma.lineCauseAllocation.deleteMany({ where: { shopId } });
  await prisma.orderSnapshotLine.deleteMany({ where: { shopId } });
  await prisma.orderSnapshot.deleteMany({ where: { shopId } });
  await prisma.causeAllocation.deleteMany({ where: { shopId } });
  await prisma.shopifyChargeTransaction.deleteMany({ where: { shopId } });
  await prisma.disbursement.deleteMany({ where: { shopId } });
  await prisma.taxTrueUp.deleteMany({ where: { shopId } });
  await prisma.reportingPeriod.deleteMany({ where: { shopId } });
  await prisma.businessExpense.deleteMany({ where: { shopId } });
  await prisma.cause.deleteMany({ where: { shopId } });

  const cause = await prisma.cause.create({
    data: {
      shopId,
      name: "Playwright Cause",
      legalName: "Playwright Cause Org",
      is501c3: true,
      status: "active",
    },
  });

  const periodStart = new Date("2026-03-01T00:00:00.000Z");
  const periodEnd = new Date("2026-03-15T00:00:00.000Z");

  const period = await prisma.reportingPeriod.create({
    data: {
      shopId,
      status: "OPEN",
      source: "payout",
      startDate: periodStart,
      endDate: periodEnd,
      shopifyPayoutId: "payout_fixture_001",
    },
  });

  const snapshot = await prisma.orderSnapshot.create({
    data: {
      shopId,
      shopifyOrderId: snapshotOrderId,
      orderNumber: "1001",
      origin: "webhook",
      createdAt: new Date("2026-03-05T12:00:00.000Z"),
    },
  });

  const snapshotLine = await prisma.orderSnapshotLine.create({
    data: {
      shopId,
      snapshotId: snapshot.id,
      shopifyLineItemId: snapshotLineItemId,
      shopifyVariantId: snapshotVariantId,
      variantTitle: "Playwright Variant",
      productTitle: "Playwright Product",
      quantity: 1,
      salePrice: new Prisma.Decimal("120.00"),
      subtotal: new Prisma.Decimal("120.00"),
      laborCost: new Prisma.Decimal("5.00"),
      materialCost: new Prisma.Decimal("10.00"),
      packagingCost: new Prisma.Decimal("3.00"),
      equipmentCost: new Prisma.Decimal("2.00"),
      mistakeBufferAmount: new Prisma.Decimal("0.00"),
      totalCost: new Prisma.Decimal("20.00"),
      netContribution: new Prisma.Decimal("100.00"),
    },
  });

  await prisma.lineCauseAllocation.create({
    data: {
      shopId,
      snapshotLineId: snapshotLine.id,
      causeId: cause.id,
      causeName: cause.name,
      is501c3: true,
      percentage: new Prisma.Decimal("60.00"),
      amount: new Prisma.Decimal("60.00"),
    },
  });

  await prisma.adjustment.create({
    data: {
      shopId,
      snapshotLineId: snapshotLine.id,
      type: "refund",
      netContribAdj: new Prisma.Decimal("-10.00"),
      laborAdj: new Prisma.Decimal("0.00"),
      materialAdj: new Prisma.Decimal("0.00"),
      packagingAdj: new Prisma.Decimal("0.00"),
      equipmentAdj: new Prisma.Decimal("0.00"),
      actor: "system",
    },
  });

  await prisma.businessExpense.create({
    data: {
      shopId,
      category: "inventory_materials",
      subType: "material_purchase",
      name: "Fixture expense",
      amount: new Prisma.Decimal("20.00"),
      expenseDate: new Date("2026-03-06T00:00:00.000Z"),
    },
  });

  await prisma.shopifyChargeTransaction.create({
    data: {
      shopId,
      shopifyTransactionId: chargeTransactionId,
      periodId: period.id,
      amount: new Prisma.Decimal("12.00"),
      currency: "USD",
      description: "Shopify charge A",
      processedAt: new Date("2026-03-07T00:00:00.000Z"),
    },
  });

  return Response.json({
    shopId,
    reportingUrl: `${baseUrl}/app/reporting?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
