import { afterEach, describe, expect, it } from "vitest";

import { checkRateLimit, resetRateLimitBuckets } from "./rate-limit.server";

describe("checkRateLimit", () => {
  afterEach(() => {
    resetRateLimitBuckets();
  });

  it("allows requests within the configured limit", () => {
    const first = checkRateLimit({
      key: "widget:shop-1",
      limit: 2,
      windowMs: 60_000,
      now: 1_000,
    });
    const second = checkRateLimit({
      key: "widget:shop-1",
      limit: 2,
      windowMs: 60_000,
      now: 2_000,
    });

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    expect(second.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(second.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("blocks requests above the configured limit until the window resets", () => {
    checkRateLimit({
      key: "widget:shop-1",
      limit: 1,
      windowMs: 60_000,
      now: 1_000,
    });

    const blocked = checkRateLimit({
      key: "widget:shop-1",
      limit: 1,
      windowMs: 60_000,
      now: 2_000,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.headers.get("Retry-After")).toBe("59");
  });

  it("resets usage after the configured window expires", () => {
    checkRateLimit({
      key: "widget:shop-1",
      limit: 1,
      windowMs: 60_000,
      now: 1_000,
    });

    const reset = checkRateLimit({
      key: "widget:shop-1",
      limit: 1,
      windowMs: 60_000,
      now: 61_001,
    });

    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(0);
  });
});
