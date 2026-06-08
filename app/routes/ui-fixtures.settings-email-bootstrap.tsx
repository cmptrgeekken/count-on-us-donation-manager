import { jsonResponse } from "~/utils/json-response.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "../db.server";

const shopId = "playwright-settings-email.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain: shopId,
      currency: "USD",
      postPurchaseEmailEnabled: false,
      artistSubmissionNotificationEmail: "",
      managedMarketsEnableDate: null,
    },
    create: {
      shopId,
      shopifyDomain: shopId,
      currency: "USD",
      postPurchaseEmailEnabled: false,
      artistSubmissionNotificationEmail: "",
      managedMarketsEnableDate: null,
    },
  });

  return jsonResponse({
    settingsUrl: `${baseUrl}/app/settings?__playwrightShop=${shopId}`,
  });
};
