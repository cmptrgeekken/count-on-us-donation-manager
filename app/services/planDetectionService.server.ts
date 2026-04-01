import { prisma } from "~/db.server";

// Shopify processing rates by plan name.
// Source: https://www.shopify.com/pricing
// These are fixed rates tied to plan names and stored in code, not the DB.
const PLAN_RATE_MAP: Record<string, number> = {
  Basic: 0.029,
  Shopify: 0.026,
  Advanced: 0.024,
  Plus: 0.0215,
  Development: 0.0,
  Partner: 0.0,
};

const SHOP_PLAN_QUERY = `#graphql
  query ShopPlan {
    shop {
      plan {
        displayName
        partnerDevelopment
        shopifyPlus
      }
    }
  }
`;

type AdminContext = {
  graphql: (query: string) => Promise<Response>;
};

export async function detectAndStorePlan(
  shopId: string,
  admin: AdminContext,
): Promise<void> {
  let planTier: string;
  let paymentRate: number | null;

  try {
    const response = await admin.graphql(SHOP_PLAN_QUERY);
    const json = (await response.json()) as {
      data?: { shop?: { plan?: { displayName?: string; partnerDevelopment?: boolean; shopifyPlus?: boolean } } };
    };
    const plan = json.data?.shop?.plan;

    if (!plan) throw new Error("No plan data returned from GraphQL");

    if (plan.partnerDevelopment) {
      planTier = "Development";
      paymentRate = 0;
    } else if (plan.shopifyPlus) {
      planTier = "Plus";
      paymentRate = PLAN_RATE_MAP["Plus"];
    } else {
      planTier = plan.displayName ?? "Unknown";
      paymentRate = PLAN_RATE_MAP[planTier] ?? null;
    }
  } catch (err) {
    console.error(`[planDetection] Failed for shop ${shopId}:`, err);
    planTier = "Unknown";
    paymentRate = null;
  }

  const current = await prisma.shop.findUnique({
    where: { shopId },
    select: { planTier: true, paymentRate: true },
  });

  await prisma.shop.update({
    where: { shopId },
    data: { planTier, paymentRate },
  });

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Shop",
      action: "PLAN_DETECTED",
      actor: "system",
      payload: {
        previous: {
          planTier: current?.planTier ?? null,
          paymentRate: current?.paymentRate ?? null,
        },
        current: { planTier, paymentRate },
      },
    },
  });
}
