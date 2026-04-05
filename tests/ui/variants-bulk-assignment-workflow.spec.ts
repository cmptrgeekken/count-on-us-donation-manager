/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("variants bulk template assignment works on the real route", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variants-bulk-assign-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.variantsUrl);

  const configuredCheckbox = page.getByLabel("Select Configured Variant");
  const unconfiguredCheckbox = page.getByLabel("Select Unconfigured Variant");

  await configuredCheckbox.check();
  await unconfiguredCheckbox.check();

  await page.getByRole("button", { name: "Assign template" }).click();
  const assignDialog = page.getByRole("dialog").filter({ hasText: "Assign template" });
  await expect(assignDialog).toBeVisible();

  await page.locator("#variant-template-assign").selectOption({ label: bootstrap.newTemplateName });
  await assignDialog.getByRole("button", { name: "Assign", exact: true }).click();

  const confirmDialog = page.getByRole("dialog").filter({ hasText: "Overwrite existing configurations?" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Yes, overwrite" }).click();

  const successBanner = page.locator("s-banner[tone='success']");
  await expect(successBanner).toContainText("Template assigned to 2 variant(s).");

  const configuredRow = configuredCheckbox.locator("xpath=ancestor::s-table-row[1]");
  const unconfiguredRow = unconfiguredCheckbox.locator("xpath=ancestor::s-table-row[1]");

  await expect(configuredRow).toContainText(bootstrap.newTemplateName);
  await expect(unconfiguredRow).toContainText(bootstrap.newTemplateName);

  await page.reload();
  await expect(page.getByLabel("Select Configured Variant").locator("xpath=ancestor::s-table-row[1]")).toContainText(bootstrap.newTemplateName);
  await expect(page.getByLabel("Select Unconfigured Variant").locator("xpath=ancestor::s-table-row[1]")).toContainText(bootstrap.newTemplateName);
});
