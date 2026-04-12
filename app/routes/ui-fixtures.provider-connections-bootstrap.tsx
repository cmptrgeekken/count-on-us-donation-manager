import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-provider-connections.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const mode = url.searchParams.get("mode");

  await prisma.providerCostCache.deleteMany({
    where: {
      mapping: {
        shopId,
      },
    },
  });

  await prisma.providerSyncRun.deleteMany({
    where: { shopId },
  });

  await prisma.providerVariantMapping.deleteMany({
    where: { shopId },
  });

  await prisma.providerCatalogVariant.deleteMany({
    where: { shopId },
  });

  await prisma.providerConnection.deleteMany({
    where: { shopId },
  });

  await prisma.variantCostConfig.deleteMany({
    where: { shopId },
  });

  await prisma.variant.deleteMany({
    where: { shopId },
  });

  await prisma.product.deleteMany({
    where: { shopId },
  });

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain: shopId,
      currency: "USD",
      catalogSynced: true,
    },
    create: {
      shopId,
      shopifyDomain: shopId,
      currency: "USD",
      catalogSynced: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      shopId,
      shopifyId: "gid://shopify/Product/9100",
      title: "Provider Fixture Product",
      handle: "provider-fixture-product",
      status: "active",
      syncedAt: new Date("2026-04-09T12:00:00Z"),
    },
  });

  await prisma.variant.createMany({
    data: [
      {
        shopId,
        productId: product.id,
        shopifyId: "gid://shopify/ProductVariant/9101",
        title: "Mapped-ready Variant",
        sku: "SKU-READY-001",
        price: "24.00",
        syncedAt: new Date("2026-04-09T12:00:00Z"),
      },
      {
        shopId,
        productId: product.id,
        shopifyId: "gid://shopify/ProductVariant/9102",
        title: "Missing SKU Variant",
        sku: null,
        price: "26.00",
        syncedAt: new Date("2026-04-09T12:00:00Z"),
      },
      {
        shopId,
        productId: product.id,
        shopifyId: "gid://shopify/ProductVariant/9103",
        title: "Manual mapping variant",
        sku: "SKU-MANUAL-001",
        price: "28.00",
        syncedAt: new Date("2026-04-09T12:00:00Z"),
      },
    ],
  });

  if (mode === "manual-review") {
    const connection = await prisma.providerConnection.create({
      data: {
        shopId,
        provider: "printify",
        authType: "api_key",
        status: "validated",
        displayName: "Fixture Printify Shop",
        providerAccountId: "1234",
        providerAccountName: "Fixture Shop",
        credentialHint: "****1234",
        credentialUpdatedAt: new Date("2026-04-10T10:00:00Z"),
        credentialExpiresAt: new Date("2027-04-10T10:00:00Z"),
        lastValidatedAt: new Date("2026-04-10T10:00:00Z"),
        lastSyncedAt: new Date("2026-04-10T10:05:00Z"),
      },
    });

    const variants = await prisma.variant.findMany({
      where: { shopId },
      orderBy: { shopifyId: "asc" },
      select: { id: true, sku: true },
    });
    const mappedVariant = variants.find((variant) => variant.sku === "SKU-READY-001");

    if (mappedVariant) {
      const mapping = await prisma.providerVariantMapping.create({
        data: {
          shopId,
          connectionId: connection.id,
          variantId: mappedVariant.id,
          provider: "printify",
          status: "mapped",
          providerProductId: "printify_product_1",
          providerProductTitle: "Provider Fixture Product",
          providerVariantId: "7001",
          providerVariantTitle: "Mapped-ready Variant",
          providerSku: "SKU-READY-001",
          matchMethod: "sku",
          lastCostSyncedAt: new Date("2026-04-10T10:05:00Z"),
        },
      });

      await prisma.providerCostCache.create({
        data: {
          mappingId: mapping.id,
          costLineType: "base_fulfillment",
          description: "Mapped-ready Variant",
          amount: "8.75",
          currency: "USD",
          syncedAt: new Date("2026-04-10T10:05:00Z"),
        },
      });
    }

    await prisma.providerCatalogVariant.createMany({
      data: [
        {
          shopId,
          connectionId: connection.id,
          provider: "printify",
          providerProductId: "printify_product_1",
          providerProductTitle: "Provider Fixture Product",
          providerVariantId: "7001",
          providerVariantTitle: "Mapped-ready Variant",
          providerSku: "SKU-READY-001",
          baseCost: "8.75",
          currency: "USD",
          syncedAt: new Date("2026-04-10T10:05:00Z"),
        },
        {
          shopId,
          connectionId: connection.id,
          provider: "printify",
          providerProductId: "printify_product_2",
          providerProductTitle: "Provider Fixture Product",
          providerVariantId: "7002",
          providerVariantTitle: "Manual mapping candidate",
          providerSku: "SKU-MANUAL-001",
          baseCost: "9.10",
          currency: "USD",
          syncedAt: new Date("2026-04-10T10:05:00Z"),
        },
      ],
    });

    await prisma.providerSyncRun.create({
      data: {
        shopId,
        connectionId: connection.id,
        provider: "printify",
        trigger: "manual",
        status: "completed",
        startedAt: new Date("2026-04-10T10:04:00Z"),
        completedAt: new Date("2026-04-10T10:05:00Z"),
        mappedCount: 1,
        unmappedCount: 1,
        cachedCostCount: 1,
      },
    });
  }

  return Response.json({
    providerConnectionsUrl: `${baseUrl}/app/provider-connections?__playwrightShop=${shopId}`,
  });
};
