/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("template details save and discard work on the real route", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/template-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.templateUrl);

  const nameField = page.getByLabel("Name");
  const saveButton = page.locator("ui-save-bar button", { hasText: "Save" });
  const discardButton = page.locator("ui-save-bar button", { hasText: "Discard" });

  await expect(nameField).toHaveValue("Playwright Template");

  await nameField.fill("Updated Playwright Template");
  await saveButton.click();

  await expect(nameField).toHaveValue("Updated Playwright Template");
  await expect(page.getByText("Template saved.")).toBeVisible();

  await page.reload();
  await expect(nameField).toHaveValue("Updated Playwright Template");

  await nameField.fill("Discarded Template Name");
  await discardButton.click();

  await expect(nameField).toHaveValue("Updated Playwright Template");
});

test("template details default new yield-based material lines to 1", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/template-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.templateUrl);

  await page.getByRole("button", { name: "Add material" }).click();
  const addDialog = page.getByRole("dialog").filter({ hasText: "Add material" });
  await expect(addDialog).toBeVisible();
  const searchInput = addDialog.getByPlaceholder("Search materials");
  await expect(searchInput).toBeVisible();
  await searchInput.click();
  await addDialog.getByRole("button", { name: "Fixture Backer" }).click();

  await expect(page.getByLabel("Yield (units produced per purchased unit)")).toHaveValue("1");
});

test("template details can set a default shipping template", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/template-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.templateUrl);

  const saveButton = page.locator("ui-save-bar button", { hasText: "Save" });
  const defaultShippingSelect = page.getByLabel("Default shipping template");

  await defaultShippingSelect.selectOption(bootstrap.shippingTemplateBId);
  await expect(defaultShippingSelect).toHaveValue(bootstrap.shippingTemplateBId);
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/app/templates/${bootstrap.templateId}`) &&
      response.request().method() === "POST" &&
      response.ok(),
  );
  await saveButton.click();
  await saveResponse;

  await expect(defaultShippingSelect).toHaveValue(bootstrap.shippingTemplateBId);
  await page.reload();
  await expect(defaultShippingSelect).toHaveValue(bootstrap.shippingTemplateBId);
});

test("template details only offer materials matching the template type", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/template-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();

  await page.goto(bootstrap.templateUrl);
  await page.getByRole("button", { name: "Add material" }).click();
  let addDialog = page.getByRole("dialog").filter({ hasText: "Add material" });
  await expect(addDialog).toBeVisible();
  let searchInput = addDialog.getByPlaceholder("Search materials");
  await expect(searchInput).toBeVisible();
  await searchInput.click();
  await expect(addDialog.getByRole("button", { name: "Fixture Backer" })).toBeVisible();
  await expect(addDialog.getByRole("button", { name: "Fixture Shipping Mailer" })).toHaveCount(0);
  await addDialog.getByRole("button", { name: "Cancel" }).click();

  await page.goto(bootstrap.shippingTemplateUrl);
  await page.getByRole("button", { name: "Add material" }).click();
  addDialog = page.getByRole("dialog").filter({ hasText: "Add material" });
  await expect(addDialog).toBeVisible();
  searchInput = addDialog.getByPlaceholder("Search materials");
  await expect(searchInput).toBeVisible();
  await searchInput.click();
  await expect(addDialog.getByRole("button", { name: "Fixture Shipping Mailer" })).toBeVisible();
  await expect(addDialog.getByRole("button", { name: "Fixture Backer" })).toHaveCount(0);
});
