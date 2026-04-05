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
