/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

async function chooseTemplate(
  page: import("@playwright/test").Page,
  assignDialog: import("@playwright/test").Locator,
  templateName: string,
): Promise<void> {
  await assignDialog.getByRole("button", { name: "Choose template" }).click();
  const templatePicker = page.getByRole("dialog", { name: "Choose template" });
  await expect(templatePicker.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(templatePicker).toContainText("0 selected");
  await templatePicker.getByLabel(templateName).check();
  await expect(templatePicker).toContainText("1 selected");
  await templatePicker.getByRole("button", { name: "Add selected" }).click();
}

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

  await expect(assignDialog).toContainText("No template selected");
  await expect(assignDialog.getByRole("button", { name: "Assign", exact: true })).toBeDisabled();
  await chooseTemplate(page, assignDialog, bootstrap.newTemplateName);
  await expect(assignDialog.getByRole("button", { name: "Assign", exact: true })).toBeEnabled();
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

test("bulk assignment removes yield-aware production and shipping duplicates", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variants-bulk-assign-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantsUrl);

  await page.getByLabel("Select Configured Variant").check();
  await page.getByRole("button", { name: "Assign template" }).click();
  const assignDialog = page.getByRole("dialog").filter({ hasText: "Assign template" });
  await chooseTemplate(page, assignDialog, bootstrap.newTemplateName);
  await assignDialog.getByLabel("Remove exact duplicate variant lines already included in this template.").check();
  await assignDialog.getByRole("button", { name: "Assign", exact: true }).click();

  const confirmDialog = page.getByRole("dialog").filter({ hasText: "Overwrite existing configurations?" });
  await confirmDialog.getByRole("button", { name: "Yes, overwrite" }).click();

  await expect(page.locator("s-banner[tone='success']")).toContainText(
    "Removed 4 exact duplicate line item(s).",
  );
});
