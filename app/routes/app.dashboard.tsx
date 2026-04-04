import { useEffect, useRef } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useRouteError } from "@remix-run/react";

import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopId },
    select: { catalogSynced: true },
  });

  const catalogSynced = shop?.catalogSynced ?? false;

  if (!catalogSynced) {
    return Response.json({ catalogSynced: false, productCount: 0, variantCount: 0, configuredCount: 0 });
  }

  const [productCount, variantCount, configuredCount] = await Promise.all([
    prisma.product.count({ where: { shopId } }),
    prisma.variant.count({ where: { shopId } }),
    prisma.variantCostConfig.count({ where: { shopId } }),
  ]);

  return Response.json({ catalogSynced: true, productCount, variantCount, configuredCount });
};

export default function Dashboard() {
  const { catalogSynced, productCount, variantCount, configuredCount } = useLoaderData<typeof loader>();

  const prevSyncedRef = useRef(catalogSynced);
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prevSyncedRef.current && catalogSynced && liveRef.current) {
      liveRef.current.textContent = "Store catalog sync complete.";
    }
    prevSyncedRef.current = catalogSynced;
  }, [catalogSynced]);

  return (
    <>
      <ui-title-bar title="Dashboard" />

      <div
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      />

      <s-page>
        {!catalogSynced && (
          <s-banner tone="info" heading="Catalog sync in progress">
            <s-text>
              We&apos;re syncing your store catalog. This may take a few minutes. You can start exploring the app while this runs.
            </s-text>
          </s-banner>
        )}

        {catalogSynced && (
          <s-section heading="Catalog">
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "1.75rem", fontWeight: 650 }}>{productCount}</div>
                <s-text>{productCount === 1 ? "Product" : "Products"}</s-text>
              </div>
              <div>
                <div style={{ fontSize: "1.75rem", fontWeight: 650 }}>{variantCount}</div>
                <s-text>{variantCount === 1 ? "Variant" : "Variants"}</s-text>
              </div>
              <div>
                <div style={{ fontSize: "1.75rem", fontWeight: 650 }}>{configuredCount}</div>
                <s-text>{configuredCount === 1 ? "Variant configured" : "Variants configured"}</s-text>
              </div>
            </div>
            <div style={{ marginTop: "1rem" }}>
              <Link to="/app/variants">
                <s-button>View all variants</s-button>
              </Link>
            </div>
          </s-section>
        )}

        <s-section heading="Welcome to Count On Us">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <s-text>
              Track production costs, calculate donation pools, and allocate donations to your chosen causes with full transparency for your customers.
            </s-text>
            <s-text>Complete the setup steps to get started.</s-text>
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Dashboard] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Dashboard" />
      <s-page>
        <s-banner tone="critical" heading="Dashboard unavailable">
          <p style={{ margin: 0, fontWeight: 650 }}>Something went wrong loading the dashboard.</p>
          <p style={{ margin: "0.5rem 0 0" }}>Please refresh the page. If the problem persists, contact support.</p>
        </s-banner>
      </s-page>
    </>
  );
}
