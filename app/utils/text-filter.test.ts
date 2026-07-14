import { describe, expect, it } from "vitest";

import { buildTextFilter, parseTextMatchMode } from "./text-filter";

describe("text filters", () => {
  it("parses supported operators and rejects empty for required values", () => {
    expect(parseTextMatchMode("startsWith")).toBe("startsWith");
    expect(parseTextMatchMode("endsWith")).toBe("endsWith");
    expect(parseTextMatchMode("equals")).toBe("equals");
    expect(parseTextMatchMode("empty")).toBe("contains");
    expect(parseTextMatchMode("empty", true)).toBe("empty");
    expect(parseTextMatchMode("unsupported", true)).toBe("contains");
  });

  it("builds case-insensitive Prisma filters", () => {
    expect(buildTextFilter("Basic", "contains")).toEqual({ contains: "Basic", mode: "insensitive" });
    expect(buildTextFilter("Basic", "startsWith")).toEqual({ startsWith: "Basic", mode: "insensitive" });
    expect(buildTextFilter("Basic", "endsWith")).toEqual({ endsWith: "Basic", mode: "insensitive" });
    expect(buildTextFilter("Basic", "equals")).toEqual({ equals: "Basic", mode: "insensitive" });
  });
});
