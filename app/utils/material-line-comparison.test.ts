import { describe, expect, it } from "vitest";

import { materialLineValuesEqual } from "./material-line-comparison";

function decimal(value: string) {
  return { toString: () => value };
}

describe("materialLineValuesEqual", () => {
  it("ignores stale yield and uses values for counted materials", () => {
    expect(materialLineValuesEqual(
      "counted",
      { quantity: decimal("2"), yield: decimal("8"), usesPerVariant: decimal("3") },
      { quantity: decimal("2"), yield: null, usesPerVariant: null },
    )).toBe(true);
  });

  it("compares quantity and yield for yield-based materials", () => {
    expect(materialLineValuesEqual(
      "yield",
      { quantity: decimal("2"), yield: decimal("8"), usesPerVariant: decimal("99") },
      { quantity: decimal("2"), yield: decimal("8"), usesPerVariant: null },
    )).toBe(true);
    expect(materialLineValuesEqual(
      "yield",
      { quantity: decimal("3"), yield: decimal("8"), usesPerVariant: null },
      { quantity: decimal("2"), yield: decimal("8"), usesPerVariant: null },
    )).toBe(false);
  });

  it("compares only portions used for uses-based materials", () => {
    expect(materialLineValuesEqual(
      "uses",
      { quantity: decimal("12"), yield: decimal("4"), usesPerVariant: decimal("3") },
      { quantity: decimal("1"), yield: null, usesPerVariant: decimal("3") },
    )).toBe(true);
    expect(materialLineValuesEqual(
      "uses",
      { quantity: decimal("1"), yield: null, usesPerVariant: decimal("2") },
      { quantity: decimal("1"), yield: null, usesPerVariant: decimal("3") },
    )).toBe(false);
  });

  it("uses quantity for legacy shipping materials", () => {
    expect(materialLineValuesEqual(
      null,
      { quantity: decimal("2"), yield: decimal("10"), usesPerVariant: null },
      { quantity: decimal("2"), yield: null, usesPerVariant: null },
    )).toBe(true);
  });
});
