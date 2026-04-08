import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshTaxOffsetCacheForShop,
  refreshTaxOffsetCachesForActiveShops,
} from "./reportingService.server";

const { recomputeTaxOffsetCache } = vi.hoisted(() => ({
  recomputeTaxOffsetCache: vi.fn(),
}));

vi.mock("./taxOffsetCache.server", () => ({
  recomputeTaxOffsetCache,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshTaxOffsetCacheForShop", () => {
  it("delegates to the tax offset cache recompute service", async () => {
    const db = {};
    const cache = { widgetTaxSuppressed: true };
    recomputeTaxOffsetCache.mockResolvedValueOnce(cache);

    await expect(refreshTaxOffsetCacheForShop("shop-1", db as any)).resolves.toBe(cache);

    expect(recomputeTaxOffsetCache).toHaveBeenCalledWith("shop-1", db);
  });
});

describe("refreshTaxOffsetCachesForActiveShops", () => {
  it("refreshes every active shop and returns per-shop summaries", async () => {
    const db = {
      shop: {
        findMany: vi.fn().mockResolvedValue([{ shopId: "shop-1" }, { shopId: "shop-2" }]),
      },
    };
    recomputeTaxOffsetCache
      .mockResolvedValueOnce({ taxableExposure: "10" })
      .mockResolvedValueOnce({ taxableExposure: "-5" });

    const result = await refreshTaxOffsetCachesForActiveShops(db as any);

    expect(db.shop.findMany).toHaveBeenCalledWith({
      select: { shopId: true },
    });
    expect(recomputeTaxOffsetCache).toHaveBeenNthCalledWith(1, "shop-1", expect.any(Object));
    expect(recomputeTaxOffsetCache).toHaveBeenNthCalledWith(2, "shop-2", expect.any(Object));
    expect(result).toEqual([
      { shopId: "shop-1", cache: { taxableExposure: "10" } },
      { shopId: "shop-2", cache: { taxableExposure: "-5" } },
    ]);
  });
});
