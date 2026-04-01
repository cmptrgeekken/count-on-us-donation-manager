import { useRef, useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRouteError, Link } from "@remix-run/react";
import {
  Page,
  Banner,
  Card,
  EmptyState,
  BlockStack,
  InlineStack,
  Text,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

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

  // aria-live region announces when catalog sync completes
  const prevSyncedRef = useRef(catalogSynced);
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prevSyncedRef.current && catalogSynced && liveRef.current) {
      liveRef.current.textContent = "Store catalog sync complete.";
    }
    prevSyncedRef.current = catalogSynced;
  }, [catalogSynced]);

  return (
    <Page>
      <TitleBar title="Dashboard" />

      {/* Screen reader announcement for catalog sync completion */}
      <div
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      />

      <BlockStack gap="400">
        {!catalogSynced && (
          <Banner tone="info">
            <Text as="p" variant="bodyMd">
              We&rsquo;re syncing your store catalog. This may take a few
              minutes. You can start exploring the app while this runs.
            </Text>
          </Banner>
        )}

        {catalogSynced && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Catalog</Text>
              <InlineStack gap="600" wrap>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg">{productCount}</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {productCount === 1 ? "Product" : "Products"}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg">{variantCount}</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {variantCount === 1 ? "Variant" : "Variants"}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg">{configuredCount}</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {configuredCount === 1 ? "Variant configured" : "Variants configured"}
                  </Text>
                </BlockStack>
              </InlineStack>
              <Link to="/app/variants">
                <Button variant="plain">View all variants</Button>
              </Link>
            </BlockStack>
          </Card>
        )}

        <EmptyState
          heading="Welcome to Count On Us"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" tone="subdued">
              Track production costs, calculate donation pools, and allocate
              donations to your chosen causes — with full transparency for your
              customers.
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Complete the setup steps to get started.
            </Text>
          </BlockStack>
        </EmptyState>
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Dashboard] ErrorBoundary caught:", error);
  return (
    <Page>
      <TitleBar title="Dashboard" />
      <Banner tone="critical">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="bold">
            Something went wrong loading the dashboard.
          </Text>
          <Text as="p" variant="bodyMd">
            Please refresh the page. If the problem persists, contact support.
          </Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
