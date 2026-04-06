import type { LoaderFunctionArgs } from "@remix-run/node";

import { Prisma } from "@prisma/client";

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

  await prisma.businessExpense.deleteMany({
    where: {
      shopId,
      name: {
        startsWith: "Playwright Expense",
      },
    },
  });

  await prisma.taxOffsetCache.upsert({
    where: { shopId },
    update: {
      deductionPool: new Prisma.Decimal("0"),
      taxableExposure: new Prisma.Decimal("0"),
      cumulativeNetContrib: new Prisma.Decimal("0"),
      widgetTaxSuppressed: true,
    },
    create: {
      shopId,
      deductionPool: new Prisma.Decimal("0"),
      taxableExposure: new Prisma.Decimal("0"),
      cumulativeNetContrib: new Prisma.Decimal("0"),
      widgetTaxSuppressed: true,
    },
  });

  return Response.json({
    shopId,
    expensesUrl: `${baseUrl}/app/expenses?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
