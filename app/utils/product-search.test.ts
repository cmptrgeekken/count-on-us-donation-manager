import { describe, expect, it } from "vitest";
import { buildProductSearchFilter } from "./product-search";

describe("buildProductSearchFilter", () => {
  it("searches product title and handle without implicitly searching metadata", () => {
    const filter = buildProductSearchFilter("summer", "contains");

    expect(filter).toEqual({
      OR: [
        { title: { contains: "summer", mode: "insensitive" } },
        { handle: { contains: "summer", mode: "insensitive" } },
      ],
    });
  });
});
