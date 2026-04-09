import { prisma } from "../db.server";

const FIXTURE_SHOP = "fixture-audit-log.myshopify.com";

export const loader = async () => {
  await prisma.shop.upsert({
    where: { shopId: FIXTURE_SHOP },
    update: {},
    create: {
      shopId: FIXTURE_SHOP,
      shopifyDomain: FIXTURE_SHOP,
      currency: "USD",
    },
  });

  await prisma.auditLog.deleteMany({
    where: { shopId: FIXTURE_SHOP },
  });

  const baseDate = new Date("2026-04-09T12:00:00.000Z");
  await prisma.auditLog.createMany({
    data: Array.from({ length: 55 }, (_, index) => ({
      shopId: FIXTURE_SHOP,
      entity: index % 2 === 0 ? "VariantCostConfig" : "ReportingPeriod",
      entityId: `entity-${index + 1}`,
      action: index % 3 === 0 ? "VARIANT_CONFIG_UPDATED" : "REPORTING_PERIOD_CLOSED",
      actor: index % 2 === 0 ? "merchant" : "system",
      payload: {
        before: `${index}.00`,
        after: `${index + 1}.00`,
      },
      createdAt: new Date(baseDate.getTime() - index * 60 * 60 * 1000),
    })),
  });

  return Response.json({
    auditLogUrl: `/app/audit-log?__playwrightShop=${FIXTURE_SHOP}`,
  });
};
