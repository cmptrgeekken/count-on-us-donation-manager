import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
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
        <Link to="/app/dashboard" rel="home">Dashboard</Link>
        <Link to="/app/settings">Settings</Link>
        <Link to="/app/materials">Materials</Link>
        <Link to="/app/equipment">Equipment</Link>
        <Link to="/app/templates">Cost Templates</Link>
        <Link to="/app/variants">Variants</Link>
        <Link to="/app/causes">Causes</Link>
        <Link to="/app/products">Products</Link>
        <Link to="/app/reporting">Reporting</Link>
        <Link to="/app/expenses">Expenses</Link>
        <Link to="/app/audit-log">Audit Log</Link>
        <Link to="/app/provider-connections">Provider Connections</Link>
        <Link to="/app/order-history">Order History</Link>
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
