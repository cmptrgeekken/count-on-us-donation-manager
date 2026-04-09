import type { LoaderFunctionArgs } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { buildDisbursementReceiptKey, createReceiptStorage } from "../services/receiptStorage.server";
import { DONATION_RECEIPTS_APP_PROXY_PATH } from "../utils/public-routes";

const shopId = "playwright-donation-receipts.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const storage = createReceiptStorage();

  await prisma.disbursementApplication.deleteMany({ where: { shopId } });
  await prisma.disbursement.deleteMany({ where: { shopId } });
  await prisma.causeAllocation.deleteMany({ where: { shopId } });
  await prisma.reportingPeriod.deleteMany({ where: { shopId } });
  await prisma.cause.deleteMany({ where: { shopId } });
  await prisma.shop.upsert({
    where: { shopId },
    update: { shopifyDomain: shopId, currency: "USD" },
    create: { shopId, shopifyDomain: shopId, currency: "USD" },
  });

  const cause = await prisma.cause.create({
    data: {
      shopId,
      name: "Receipt Fixture Cause",
      legalName: "Receipt Fixture Cause Org",
      is501c3: true,
      status: "active",
    },
  });

  const closedPeriod = await prisma.reportingPeriod.create({
    data: {
      shopId,
      status: "CLOSED",
      source: "payout",
      startDate: new Date("2026-03-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      shopifyPayoutId: "payout_receipts_fixture",
      closedAt: new Date("2026-04-01T00:00:00.000Z"),
    },
  });

  const receiptKey = await storage.put({
    key: buildDisbursementReceiptKey({
      shopId,
      periodId: closedPeriod.id,
      disbursementId: "receipts-fixture",
      filename: "receipt.pdf",
    }),
    body: new TextEncoder().encode("fixture receipt file"),
    contentType: "application/pdf",
  });

  await prisma.causeAllocation.create({
    data: {
      shopId,
      periodId: closedPeriod.id,
      causeId: cause.id,
      causeName: cause.name,
      is501c3: true,
      allocated: new Prisma.Decimal("42.00"),
      disbursed: new Prisma.Decimal("42.00"),
    },
  });

  await prisma.disbursement.create({
    data: {
      shopId,
      periodId: closedPeriod.id,
      causeId: cause.id,
      amount: new Prisma.Decimal("42.00"),
      allocatedAmount: new Prisma.Decimal("42.00"),
      extraContributionAmount: new Prisma.Decimal("0.00"),
      feesCoveredAmount: new Prisma.Decimal("0.00"),
      paidAt: new Date("2026-04-02T00:00:00.000Z"),
      paymentMethod: "ACH",
      referenceId: "receipts-fixture-001",
      receiptFileKey: receiptKey.key,
    },
  });

  return Response.json({
    donationReceiptsUrl: `${baseUrl}${DONATION_RECEIPTS_APP_PROXY_PATH}?__playwrightShop=${shopId}`,
  });
};
