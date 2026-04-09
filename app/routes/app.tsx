import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";

import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { getLocaleFromRequest } from "../utils/localization.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const locale = getLocaleFromRequest(request);
  const shop = await prisma.shop.findUnique({
    where: { shopId: session.shop },
    select: { currency: true },
  });

  return Response.json(
    {
      apiKey: process.env.SHOPIFY_API_KEY || "",
      localization: {
        currency: shop?.currency ?? "USD",
        locale,
      },
    },
    {
      headers: {
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    },
  );
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {/* Navigation renders in the Shopify admin sidebar */}
      <ui-nav-menu>
        <a href="/app/dashboard" rel="home">Dashboard</a>
        <a href="/app/settings">Settings</a>
        <a href="/app/materials">Materials</a>
        <a href="/app/equipment">Equipment</a>
        <a href="/app/templates">Cost Templates</a>
        <a href="/app/variants">Variants</a>
        <a href="/app/causes">Causes</a>
        <a href="/app/products">Products</a>
        <a href="/app/reporting">Reporting</a>
        <a href="/app/expenses">Expenses</a>
        <a href="/app/audit-log">Audit Log</a>
        <a href="/app/provider-connections">Provider Connections</a>
        <a href="/app/order-history">Order History</a>
      </ui-nav-menu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
