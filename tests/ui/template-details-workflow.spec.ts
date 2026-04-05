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
