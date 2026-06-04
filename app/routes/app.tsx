import { jsonResponse } from "~/utils/json-response.server";
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "@remix-run/react";
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

  return jsonResponse(
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
  const { search } = useLocation();
  const appHref = (path: string) => `${path}${search}`;

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {/* Navigation renders in the Shopify admin sidebar */}
      <ui-nav-menu>
        <Link to={appHref("/app/dashboard")} rel="home">Dashboard</Link>
        <Link to={appHref("/app/settings")}>Settings</Link>
        <Link to={appHref("/app/materials")}>Materials</Link>
        <Link to={appHref("/app/packages")}>Shipping Packages</Link>
        <Link to={appHref("/app/equipment")}>Equipment</Link>
        <Link to={appHref("/app/templates")}>Cost Templates</Link>
        <Link to={appHref("/app/variants")}>Variants</Link>
        <Link to={appHref("/app/causes")}>Causes</Link>
        <Link to={appHref("/app/artists")}>Artists</Link>
        <Link to={appHref("/app/artist-submissions")}>Artist Submissions</Link>
        <Link to={appHref("/app/products")}>Products</Link>
        <Link to={appHref("/app/reporting")}>Reporting</Link>
        <Link to={appHref("/app/expenses")}>Expenses</Link>
        <Link to={appHref("/app/audit-log")}>Audit Log</Link>
        <Link to={appHref("/app/provider-connections")}>Provider Connections</Link>
        <Link to={appHref("/app/order-history")}>Order History</Link>
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
