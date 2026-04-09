import { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

const FIXTURE_SHOP = "fixture-setup-wizard.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticateAdminRequest(request);

  await prisma.productCauseAssignment.deleteMany({
    where: { shopId: FIXTURE_SHOP },
  });
  await prisma.variantCostConfig.deleteMany({
    where: { shopId: FIXTURE_SHOP },
  });
  await prisma.costTemplate.deleteMany({
    where: { shopId: FIXTURE_SHOP },
  });
  await prisma.materialLibraryItem.deleteMany({
    where: { shopId: FIXTURE_SHOP },
  });
  await prisma.equipmentLibraryItem.deleteMany({
    where: { shopId: FIXTURE_SHOP },
  });
  await prisma.cause.deleteMany({
    where: { shopId: FIXTURE_SHOP },
  });

  await prisma.shop.upsert({
    where: { shopId: FIXTURE_SHOP },
    update: {
      shopifyDomain: FIXTURE_SHOP,
      catalogSynced: true,
      paymentRate: new Prisma.Decimal("0.0290"),
      wizardStep: 0,
    },
    create: {
      shopId: FIXTURE_SHOP,
      shopifyDomain: FIXTURE_SHOP,
      currency: "USD",
      catalogSynced: true,
      paymentRate: new Prisma.Decimal("0.0290"),
      wizardStep: 0,
    },
  });

  await prisma.wizardState.upsert({
    where: { shopId: FIXTURE_SHOP },
    update: {
      currentStep: 0,
      completedSteps: [],
      skippedSteps: [],
    },
    create: {
      shopId: FIXTURE_SHOP,
      currentStep: 0,
      completedSteps: [],
      skippedSteps: [],
    },
  });

  return Response.json({
    dashboardUrl: `/app/dashboard?__playwrightShop=${FIXTURE_SHOP}`,
  });
};
