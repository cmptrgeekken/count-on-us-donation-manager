import { prisma } from "~/db.server";

type AdminContext = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  tags
  category {
    id
    name
    fullName
  }
  collections(first: 250) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      title
      handle
    }
  }
  variants(first: 100) {
    nodes {
      id
      title
      sku
      price
    }
  }
`;

const PRODUCTS_QUERY = `#graphql
  query CatalogSync($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ${PRODUCT_FIELDS}
      }
    }
  }
`;

const SINGLE_PRODUCT_QUERY = `#graphql
  query SingleProduct($id: ID!) {
    product(id: $id) {
      ${PRODUCT_FIELDS}
    }
  }
`;

const PRODUCT_COLLECTIONS_PAGE_QUERY = `#graphql
  query ProductCollectionsPage($id: ID!, $cursor: String!) {
    product(id: $id) {
      collections(first: 250, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          handle
        }
      }
    }
  }
`;

const COLLECTION_QUERY = `#graphql
  query CollectionSync($id: ID!, $cursor: String) {
    collection(id: $id) {
      id
      title
      handle
      products(first: 250, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
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

type ShopifyCollectionSummary = {
  id: string;
  title: string;
  handle: string;
};

type Connection<T> = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
};

type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  tags: string[];
  category: {
    id: string;
    name: string;
    fullName: string;
  } | null;
  collections: Connection<ShopifyCollectionSummary>;
  variants: { nodes: ShopifyVariant[] };
};

type DbClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function parseGraphqlResponse<T>(
  response: Response,
  errorMessage: string,
): Promise<T> {
  const json = (await response.json()) as { data?: T; errors?: unknown[] };
  if (json.errors?.length) throw new Error(errorMessage);
  if (!json.data) throw new Error(errorMessage);
  return json.data;
}

async function fetchRemainingProductCollections(
  admin: AdminContext,
  product: ShopifyProduct,
): Promise<ShopifyCollectionSummary[]> {
  const collections = [...product.collections.nodes];
  let cursor = product.collections.pageInfo.hasNextPage
    ? product.collections.pageInfo.endCursor
    : null;

  while (cursor) {
    const response = await admin.graphql(PRODUCT_COLLECTIONS_PAGE_QUERY, {
      variables: { id: product.id, cursor },
    });
    const data = await parseGraphqlResponse<{
      product?: { collections: Connection<ShopifyCollectionSummary> } | null;
    }>(response, "GraphQL errors while paginating product collections");
    const page = data.product?.collections;
    if (!page) break;
    collections.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  }

  return collections;
}

async function upsertProduct(
  db: DbClient,
  shopId: string,
  product: ShopifyProduct,
): Promise<string> {
  const syncedAt = new Date();
  const record = await db.product.upsert({
    where: { shopId_shopifyId: { shopId, shopifyId: product.id } },
    create: {
      shopId,
      shopifyId: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status.toLowerCase(),
      productCategoryId: product.category?.id ?? null,
      productCategoryName: product.category?.name ?? null,
      productCategoryPath: product.category?.fullName ?? null,
      syncedAt,
    },
    update: {
      title: product.title,
      handle: product.handle,
      status: product.status.toLowerCase(),
      productCategoryId: product.category?.id ?? null,
      productCategoryName: product.category?.name ?? null,
      productCategoryPath: product.category?.fullName ?? null,
      syncedAt,
    },
  });
  return record.id;
}

async function replaceProductSearchMetadata(
  db: DbClient,
  shopId: string,
  productId: string,
  tags: string[],
  collections: ShopifyCollectionSummary[],
): Promise<void> {
  await db.productTag.deleteMany({ where: { shopId, productId } });
  if (tags.length > 0) {
    await db.productTag.createMany({
      data: tags.map((value) => ({ shopId, productId, value })),
      skipDuplicates: true,
    });
  }

  if (collections.length > 0) {
    const syncedAt = new Date();
    await db.shopifyCollection.createMany({
      data: collections.map((collection) => ({
        shopId,
        shopifyId: collection.id,
        title: collection.title,
        handle: collection.handle,
        syncedAt,
      })),
      skipDuplicates: true,
    });
    await Promise.all(
      collections.map((collection) =>
        db.shopifyCollection.updateMany({
          where: { shopId, shopifyId: collection.id },
          data: {
            title: collection.title,
            handle: collection.handle,
            syncedAt,
          },
        }),
      ),
    );
  }

  const localCollections =
    collections.length > 0
      ? await db.shopifyCollection.findMany({
          where: {
            shopId,
            shopifyId: { in: collections.map((collection) => collection.id) },
          },
          select: { id: true },
        })
      : [];

  await db.productCollection.deleteMany({ where: { shopId, productId } });
  if (localCollections.length > 0) {
    await db.productCollection.createMany({
      data: localCollections.map((collection) => ({
        shopId,
        productId,
        collectionId: collection.id,
      })),
      skipDuplicates: true,
    });
  }
}

async function upsertVariants(
  db: DbClient,
  shopId: string,
  productId: string,
  variants: ShopifyVariant[],
): Promise<number> {
  const syncedAt = new Date();
  for (const variant of variants) {
    await db.variant.upsert({
      where: { shopId_shopifyId: { shopId, shopifyId: variant.id } },
      create: {
        shopId,
        shopifyId: variant.id,
        productId,
        title: variant.title,
        sku: variant.sku ?? null,
        price: variant.price,
        syncedAt,
      },
      update: {
        productId,
        title: variant.title,
        sku: variant.sku ?? null,
        price: variant.price,
        syncedAt,
      },
    });
  }
  return variants.length;
}

async function persistProduct(
  shopId: string,
  product: ShopifyProduct,
  collections: ShopifyCollectionSummary[],
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const productId = await upsertProduct(tx, shopId, product);
    await replaceProductSearchMetadata(
      tx,
      shopId,
      productId,
      product.tags,
      collections,
    );
    return upsertVariants(tx, shopId, productId, product.variants.nodes);
  });
}

export async function fullSync(
  shopId: string,
  admin: AdminContext,
): Promise<void> {
  console.log(`[catalogSync] Starting full sync for ${shopId}`);
  let cursor: string | null = null;
  let totalProducts = 0;
  let totalVariants = 0;

  do {
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { cursor },
    });
    const data = await parseGraphqlResponse<{
      products?: Connection<ShopifyProduct>;
    }>(response, "GraphQL errors during catalog sync");
    const products = data.products;
    if (!products) break;

    for (const product of products.nodes) {
      const collections = await fetchRemainingProductCollections(
        admin,
        product,
      );
      totalVariants += await persistProduct(shopId, product, collections);
      totalProducts++;
    }
    cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
  } while (cursor !== null);

  await prisma.$transaction(async (tx) => {
    await tx.shop.update({ where: { shopId }, data: { catalogSynced: true } });
    await tx.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "CATALOG_SYNC_COMPLETED",
        actor: "system",
        payload: { productCount: totalProducts, variantCount: totalVariants },
      },
    });
  });
  console.log(
    `[catalogSync] Full sync complete for ${shopId}: ${totalProducts} products, ${totalVariants} variants`,
  );
}

export async function incrementalSync(
  shopId: string,
  admin: AdminContext,
  productGid: string,
): Promise<void> {
  console.log(
    `[catalogSync] Incremental sync for ${shopId}, product ${productGid}`,
  );
  const response = await admin.graphql(SINGLE_PRODUCT_QUERY, {
    variables: { id: productGid },
  });
  const data = await parseGraphqlResponse<{ product?: ShopifyProduct | null }>(
    response,
    "GraphQL errors during incremental sync",
  );
  if (!data.product) {
    await deleteProduct(shopId, productGid);
    return;
  }
  const collections = await fetchRemainingProductCollections(
    admin,
    data.product,
  );
  await persistProduct(shopId, data.product, collections);
}

export async function deleteProduct(
  shopId: string,
  productGid: string,
): Promise<void> {
  await prisma.product.deleteMany({ where: { shopId, shopifyId: productGid } });
}

export async function syncCollection(
  shopId: string,
  admin: AdminContext,
  collectionGid: string,
): Promise<void> {
  let cursor: string | null = null;
  let collection: ShopifyCollectionSummary | null = null;
  const productGids: string[] = [];

  do {
    const response = await admin.graphql(COLLECTION_QUERY, {
      variables: { id: collectionGid, cursor },
    });
    const data = await parseGraphqlResponse<{
      collection?:
        | (ShopifyCollectionSummary & { products: Connection<{ id: string }> })
        | null;
    }>(response, "GraphQL errors during collection sync");
    if (!data.collection) {
      await deleteCollection(shopId, collectionGid);
      return;
    }
    collection = data.collection;
    productGids.push(
      ...data.collection.products.nodes.map((product) => product.id),
    );
    cursor = data.collection.products.pageInfo.hasNextPage
      ? data.collection.products.pageInfo.endCursor
      : null;
  } while (cursor !== null);

  if (!collection) return;
  await prisma.$transaction(async (tx) => {
    const localCollection = await tx.shopifyCollection.upsert({
      where: { shopId_shopifyId: { shopId, shopifyId: collectionGid } },
      create: {
        shopId,
        shopifyId: collectionGid,
        title: collection.title,
        handle: collection.handle,
        syncedAt: new Date(),
      },
      update: {
        title: collection.title,
        handle: collection.handle,
        syncedAt: new Date(),
      },
      select: { id: true },
    });
    const products =
      productGids.length > 0
        ? await tx.product.findMany({
            where: { shopId, shopifyId: { in: productGids } },
            select: { id: true },
          })
        : [];
    await tx.productCollection.deleteMany({
      where: { shopId, collectionId: localCollection.id },
    });
    if (products.length > 0) {
      await tx.productCollection.createMany({
        data: products.map((product) => ({
          shopId,
          productId: product.id,
          collectionId: localCollection.id,
        })),
        skipDuplicates: true,
      });
    }
  });
}

export async function deleteCollection(
  shopId: string,
  collectionGid: string,
): Promise<void> {
  await prisma.shopifyCollection.deleteMany({
    where: { shopId, shopifyId: collectionGid },
  });
}
