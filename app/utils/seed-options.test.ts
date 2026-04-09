import { describe, expect, it } from "vitest";

import { applySeedPreset, DEFAULT_SEED_OPTIONS } from "../../scripts/seed-options.mjs";

describe("applySeedPreset", () => {
  it("returns defaults unchanged when no preset is supplied", () => {
    const result = applySeedPreset({ ...DEFAULT_SEED_OPTIONS }, null);
    expect(result).toEqual(DEFAULT_SEED_OPTIONS);
  });

  it("applies the demo-store preset", () => {
    const result = applySeedPreset({ ...DEFAULT_SEED_OPTIONS }, "demo-store");
    expect(result).toMatchObject({
      months: 4,
      ordersMin: 8,
      ordersMax: 12,
      completeSetup: true,
      preset: "demo-store",
    });
  });

  it("throws for unknown presets", () => {
    expect(() => applySeedPreset({ ...DEFAULT_SEED_OPTIONS }, "mystery")).toThrow(
      "Unknown seed preset: mystery",
    );
  });
});
