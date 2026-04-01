import { prisma } from "~/db.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const PRODUCTS_QUERY = `#graphql
  query CatalogSync($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        status
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
          }
        }
      }
    }
  }
`;

const SINGLE_PRODUCT_QUERY = `#graphql
  query SingleProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      variants(first: 100) {
        nodes {
          id
          title
          sku
          price
        }
      }
    }
  }
`;

type ShopifyVariant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
};

type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  variants: { nodes: ShopifyVariant[] };
};

async function upsertProduct(shopId: string, product: ShopifyProduct): Promise<string> {
  const syncedAt = new Date();
  const record = await prisma.product.upsert({
    where: { shopId_shopifyId: { shopId, shopifyId: product.id } },
    create: {
      shopId,
      shopifyId: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status.toLowerCase(),
      syncedAt,
    },
    update: {
      title: product.title,
      handle: product.handle,
      status: product.status.toLowerCase(),
      syncedAt,
    },
  });
  return record.id;
}

async function upsertVariants(
  shopId: string,
  productId: string,
  variants: ShopifyVariant[],
): Promise<number> {
  const syncedAt = new Date();
  for (const v of variants) {
    await prisma.variant.upsert({
      where: { shopId_shopifyId: { shopId, shopifyId: v.id } },
      create: {
        shopId,
        shopifyId: v.id,
        productId,
        title: v.title,
        sku: v.sku ?? null,
        price: v.price,
        syncedAt,
      },
      update: {
        title: v.title,
        sku: v.sku ?? null,
        price: v.price,
        syncedAt,
      },
    });
  }
  return variants.length;
}

/**
 * Full cursor-based product/variant sync.
 * Runs as a background job after install.
 * Sets Shop.catalogSynced = true on completion.
 */
export async function fullSync(shopId: string, admin: AdminContext): Promise<void> {
  console.log(`[catalogSync] Starting full sync for ${shopId}`);

  let cursor: string | null = null;
  let totalProducts = 0;
  let totalVariants = 0;

  do {
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { cursor },
    });

    const json = (await response.json()) as {
      data?: {
        products?: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          nodes: ShopifyProduct[];
        };
      };
      errors?: unknown[];
    };

    if (json.errors?.length) {
      console.error(`[catalogSync] GraphQL errors for ${shopId}:`, json.errors);
      throw new Error("GraphQL errors during catalog sync");
    }

    const products = json.data?.products;
    if (!products) break;

    for (const product of products.nodes) {
      const productId = await upsertProduct(shopId, product);
      const variantCount = await upsertVariants(shopId, productId, product.variants.nodes);
      totalProducts++;
      totalVariants += variantCount;
    }

    cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
  } while (cursor !== null);

  await prisma.shop.update({
    where: { shopId },
    data: { catalogSynced: true },
  });

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Shop",
      action: "CATALOG_SYNC_COMPLETED",
      actor: "system",
      payload: { productCount: totalProducts, variantCount: totalVariants },
    },
  });

  console.log(`[catalogSync] Full sync complete for ${shopId}: ${totalProducts} products, ${totalVariants} variants`);
}

/**
 * Incremental sync for a single product (triggered by products/update webhook).
 * Does not change Shop.catalogSynced.
 */
export async function incrementalSync(
  shopId: string,
  admin: AdminContext,
  productGid: string,
): Promise<void> {
  console.log(`[catalogSync] Incremental sync for ${shopId}, product ${productGid}`);

  const response = await admin.graphql(SINGLE_PRODUCT_QUERY, {
    variables: { id: productGid },
  });

  const json = (await response.json()) as {
    data?: { product?: ShopifyProduct | null };
    errors?: unknown[];
  };

  if (json.errors?.length) {
    console.error(`[catalogSync] GraphQL errors for ${shopId}:`, json.errors);
    throw new Error("GraphQL errors during incremental sync");
  }

  const product = json.data?.product;
  if (!product) {
    console.warn(`[catalogSync] Product ${productGid} not found for shop ${shopId} — may have been deleted`);
    return;
  }

  const productId = await upsertProduct(shopId, product);
  await upsertVariants(shopId, productId, product.variants.nodes);
}
