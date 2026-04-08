import { prisma } from "../db.server";
import { recomputeTaxOffsetCache } from "./taxOffsetCache.server";

type DbClient = typeof prisma;

export async function refreshTaxOffsetCacheForShop(
  shopId: string,
  db: DbClient = prisma,
) {
  return recomputeTaxOffsetCache(shopId, db);
}

export async function refreshTaxOffsetCachesForActiveShops(
  db: DbClient = prisma,
) {
  const shops = await db.shop.findMany({
    select: { shopId: true },
  });

  const results = [];
  for (const shop of shops) {
    const cache = await refreshTaxOffsetCacheForShop(shop.shopId, db);
    results.push({ shopId: shop.shopId, cache });
  }

  return results;
}
