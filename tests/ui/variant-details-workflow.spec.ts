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
  await expect(page.getByText("Add material line")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add", exact: true }).first()).toBeDisabled();
  const searchInput = page.getByPlaceholder("Search materials");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("Playwright Yield Material");
  await page.getByRole("button", { name: "Playwright Yield Material" }).click();

  await expect(page.getByLabel("Yield per piece")).toHaveValue("1");
});

test("variant details groups additional shipping material lines separately", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Add material" }).click();
  await expect(page.getByText("Add material line")).toBeVisible();
  let searchInput = page.getByPlaceholder("Search materials");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("ZZZ Playwright Shipping Material");
  await page.getByRole("button", { name: "ZZZ Playwright Shipping Material" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  await expect(page.getByRole("heading", { name: "Shipping materials" })).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "ZZZ Playwright Shipping Material" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add material" }).click();
  await expect(page.getByText("Add material line")).toBeVisible();
  searchInput = page.getByPlaceholder("Search materials");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("ZZZ Playwright Shipping Material");
  await expect(page.getByRole("button", { name: "ZZZ Playwright Shipping Material" })).toHaveCount(0);
});

test("variant details use searchable equipment add picker and suppress duplicates", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Add equipment" }).click();
  let addDialog = page.getByRole("dialog").filter({ hasText: "Add equipment line" });
  await expect(addDialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await addDialog.getByPlaceholder("Search equipment").click();
  await addDialog.getByRole("button", { name: "Playwright Heat Press" }).click();
  await addDialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByRole("paragraph").filter({ hasText: "Playwright Heat Press" })).toBeVisible();

  await page.getByRole("button", { name: "Add equipment" }).click();
  addDialog = page.getByRole("dialog").filter({ hasText: "Add equipment line" });
  await addDialog.getByPlaceholder("Search equipment").fill("Playwright Heat Press");
  await expect(addDialog.getByRole("button", { name: "Playwright Heat Press" })).toHaveCount(0);
});

test("variant details persist production and shipping template assignments", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Assign production template" }).click();
  const productionDialog = page.locator("dialog").filter({ hasText: "Assign production template" });
  await expect(productionDialog).toBeVisible();
  await productionDialog.getByLabel("Production template").selectOption({ label: "Playwright Production Template" });
  await productionDialog.getByRole("button", { name: "Assign", exact: true }).click();

  await expect(page.getByText("Inherited from production template")).toBeVisible();
  await expect(page.locator("p").filter({ hasText: "Playwright Shipping Template" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shipping material lines" })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "ZZZ Playwright Shipping Material" })).toBeVisible();
  await expect(
    page.getByText("Edit these line items on the Shipping template itself."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Set override" }).click();
  const shippingDialog = page.locator("dialog").filter({ hasText: "Assign shipping template override" });
  await expect(shippingDialog).toBeVisible();
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
