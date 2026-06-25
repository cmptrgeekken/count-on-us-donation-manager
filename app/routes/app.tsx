import { jsonResponse } from "~/utils/json-response.server";
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";

import { AdminShell, getAdminCompatibilityNavItems } from "../components/AdminShell";
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
  const compatibilityNavItems = getAdminCompatibilityNavItems();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {/* Shopify sidebar compatibility; primary navigation is rendered by AdminShell. */}
      <ui-nav-menu>
        {compatibilityNavItems.map((item) => (
          <Link key={item.path} to={appHref(item.path)} rel={item.path === "/app/dashboard" ? "home" : undefined}>
            {item.label}
          </Link>
        ))}
      </ui-nav-menu>
      <AdminShell>
        <Outlet />
      </AdminShell>
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
