import { jsonResponse } from "~/utils/json-response.server";
import type { LoaderFunctionArgs } from "@remix-run/node";

import { prisma } from "../db.server";

const shopId = "playwright-products-sync.myshopify.com";
const shopifyDomain = "playwright-products-sync.myshopify.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  await prisma.auditLog.deleteMany({
    where: {
      shopId,
      action: {
        in: ["CATALOG_SYNC_REQUESTED", "CATALOG_SYNC_COMPLETED"],
      },
    },
  });

  await prisma.product.deleteMany({ where: { shopId } });

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain,
      currency: "USD",
      catalogSynced: true,
    },
    create: {
      shopId,
      shopifyDomain,
      currency: "USD",
      catalogSynced: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Shop",
      action: "CATALOG_SYNC_COMPLETED",
      actor: "system",
      payload: {
        productCount: 2,
        variantCount: 3,
      },
      createdAt: new Date("2026-04-09T12:00:00Z"),
    },
  });

  const syncedAt = new Date("2026-04-09T12:00:00Z");
  const [configuredProduct, partialProduct, template] = await Promise.all([
    prisma.product.create({
      data: {
        shopId,
        shopifyId: "gid://shopify/Product/910000000001",
        title: "Configured Product",
        handle: "configured-product",
        status: "active",
        productCategoryId: "gid://shopify/TaxonomyCategory/aa-1",
        productCategoryName: "Stickers",
        productCategoryPath: "Arts & Entertainment > Hobbies & Creative Arts > Stickers",
        syncedAt,
      },
    }),
    prisma.product.create({
      data: {
        shopId,
        shopifyId: "gid://shopify/Product/910000000002",
        title: "Partial Product",
        handle: "partial-product",
        status: "active",
        productCategoryId: "gid://shopify/TaxonomyCategory/aa-2",
        productCategoryName: "Earrings",
        productCategoryPath: "Apparel & Accessories > Jewelry > Earrings",
        syncedAt,
      },
    }),
    prisma.costTemplate.create({
      data: {
        shopId,
        name: "Products Fixture Template",
        type: "production",
        status: "active",
      },
    }),
  ]);

  const [configuredVariant, partialConfiguredVariant, partialBlankVariant] = await Promise.all([
    prisma.variant.create({
      data: {
        shopId,
        shopifyId: "gid://shopify/ProductVariant/910000000101",
        productId: configuredProduct.id,
        title: "Default",
        sku: "CONFIGURED-DEFAULT",
        price: 25,
        syncedAt,
      },
    }),
    prisma.variant.create({
      data: {
        shopId,
        shopifyId: "gid://shopify/ProductVariant/910000000201",
        productId: partialProduct.id,
        title: "Small",
        sku: "PARTIAL-SMALL",
        price: 20,
        syncedAt,
      },
    }),
    prisma.variant.create({
      data: {
        shopId,
        shopifyId: "gid://shopify/ProductVariant/910000000202",
        productId: partialProduct.id,
        title: "Large",
        sku: "PARTIAL-LARGE",
        price: 30,
        syncedAt,
      },
    }),
  ]);

  await prisma.variantCostConfig.createMany({
    data: [
      {
        shopId,
        variantId: configuredVariant.id,
        productionTemplateId: template.id,
      },
      {
        shopId,
        variantId: partialConfiguredVariant.id,
        productionTemplateId: template.id,
      },
      {
        shopId,
        variantId: partialBlankVariant.id,
      },
    ],
  });

  return jsonResponse({
    productsUrl: `${baseUrl}/app/products?__playwrightShop=${encodeURIComponent(shopId)}`,
    variantsUrl: `${baseUrl}/app/variants?__playwrightShop=${encodeURIComponent(shopId)}`,
  });
};
