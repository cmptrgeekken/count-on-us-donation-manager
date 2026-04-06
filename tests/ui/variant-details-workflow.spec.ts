/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("variant details save and discard work on the real route", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.variantUrl);

  const minutesField = page.getByLabel("Minutes per variant");
  const saveButton = page.locator("ui-save-bar button", { hasText: "Save" });
  const discardButton = page.locator("ui-save-bar button", { hasText: "Discard" });

  await expect(minutesField).toHaveValue("");

  await minutesField.fill("12");
  await saveButton.click();

  await expect(minutesField).toHaveValue("12");
  await expect(page.getByText("Variant configuration saved.")).toBeVisible();

  await page.reload();
  await expect(minutesField).toHaveValue("12");

  await minutesField.fill("20");
  await discardButton.click();

  await expect(minutesField).toHaveValue("12");
});

test("variant details default new yield-based material lines to 1", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Add material" }).click();
  await page.getByLabel("Material", { exact: true }).selectOption({ label: "Playwright Yield Material" });

  await expect(page.getByLabel("Yield per piece")).toHaveValue("1");
});

test("variant details persist production and shipping template assignments", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Assign production template" }).click();
  await page.getByLabel("Production template").selectOption({ label: "Playwright Production Template" });
  await page.getByRole("button", { name: "Assign", exact: true }).click();

  await expect(page.getByText("Inherited from production template")).toBeVisible();
  await expect(page.locator("p").filter({ hasText: "Playwright Shipping Template" })).toBeVisible();

  await page.getByRole("button", { name: "Set override" }).click();
  const shippingDialog = page.getByRole("dialog").filter({ hasText: "Assign shipping template override" });
  await shippingDialog.getByLabel("Shipping template").selectOption({ label: "Playwright Shipping Override Template" });
  await shippingDialog.getByRole("button", { name: "Set override", exact: true }).click();

  const saveButton = page.locator("ui-save-bar button", { hasText: "Save" });
  await saveButton.click();

  await expect(page.getByText("Variant configuration saved.")).toBeVisible();
  await expect(page.getByText("Explicit override")).toBeVisible();
  await expect(page.locator("p").filter({ hasText: "Playwright Shipping Override Template" })).toBeVisible();

  await page.reload();

  await expect(page.locator("p").filter({ hasText: "Playwright Production Template" })).toBeVisible();
  await expect(page.getByText("Explicit override")).toBeVisible();
  await expect(page.locator("p").filter({ hasText: "Playwright Shipping Override Template" })).toBeVisible();
});
