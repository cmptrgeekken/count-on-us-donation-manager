/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("product donations can add a second cause assignment and persist it", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/product-donations-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.productUrl);

  await expect(page.getByText("Total allocation: 60.00%")).toBeVisible();

  await page.getByRole("button", { name: "Add cause" }).click();

  const secondCauseSelect = page.locator("#cause-1");
  const secondPercentageField = page.locator("#percentage-1");

  await secondCauseSelect.selectOption({ label: bootstrap.secondCauseName });
  await secondPercentageField.fill("40");
  await page.getByRole("button", { name: "Save assignments" }).click();

  await expect(page.getByText("Product Cause assignments saved.")).toBeVisible();
  await expect(page.getByText("Total allocation: 100.00%")).toBeVisible();

  await page.reload();

  await expect(page.locator("#cause-0")).toHaveValue(/.+/);
  await expect(page.locator("#cause-1")).toHaveValue(/.+/);
  await expect(page.locator("#percentage-1")).toHaveValue("40");
  await expect(page.getByText("Total allocation: 100.00%")).toBeVisible();
});
