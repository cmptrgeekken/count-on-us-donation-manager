import { describe, expect, it } from "vitest";
import { formatCausePercentage } from "./cause-routing-display";

describe("formatCausePercentage", () => {
  it.each([
    ["100", "100%"],
    ["100.00", "100%"],
    ["33.50", "33.5%"],
    ["33.33", "33.33%"],
    ["0.00", "0%"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatCausePercentage(value)).toBe(expected);
  });
});
