import { describe, expect, it } from "vitest";

import {
  parseOptionalNonNegativeNumber,
  parseOptionalNonNegativeWholeNumber,
  parseOptionalPercent,
  parseRequiredNonNegativeWholeNumber,
} from "./number-parsing";

async function expectResponseError(callback: () => unknown, message: string) {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect(await (error as Response).text()).toBe(message);
    return;
  }

  throw new Error("Expected parser to throw a Response.");
}

describe("number parsing", () => {
  it("parses optional non-negative decimals", async () => {
    expect(parseOptionalNonNegativeNumber("", "Minutes")).toBeNull();
    expect(parseOptionalNonNegativeNumber("1.5", "Minutes")).toBe(1.5);
    await expectResponseError(
      () => parseOptionalNonNegativeNumber("-1", "Minutes"),
      "Minutes must be a non-negative number.",
    );
  });

  it("parses optional non-negative whole numbers", async () => {
    expect(parseOptionalNonNegativeWholeNumber("", "Material yield")).toBeNull();
    expect(parseOptionalNonNegativeWholeNumber("3", "Material yield")).toBe(3);
    await expectResponseError(
      () => parseOptionalNonNegativeWholeNumber("1.5", "Material yield"),
      "Material yield must be a non-negative whole number.",
    );
  });

  it("requires whole numbers when a value must be present", async () => {
    expect(parseRequiredNonNegativeWholeNumber("2", "Material quantity")).toBe(2);
    await expectResponseError(
      () => parseRequiredNonNegativeWholeNumber("", "Material quantity"),
      "Material quantity must be a non-negative whole number.",
    );
  });

  it("parses optional percent values into decimal rates", async () => {
    expect(parseOptionalPercent("", "Mistake buffer")).toBeNull();
    expect(parseOptionalPercent("12.5", "Mistake buffer")).toBe(0.125);
    await expectResponseError(
      () => parseOptionalPercent("101", "Mistake buffer"),
      "Mistake buffer must be between 0 and 100.",
    );
  });
});
