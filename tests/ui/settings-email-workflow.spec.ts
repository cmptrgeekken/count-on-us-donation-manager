/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("settings page exposes the post-purchase donation email toggle", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/settings-email-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.settingsUrl);

  await page.getByRole("tab", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { name: "Donation Email" })).toBeVisible();
  await expect(page.getByLabel("Send post-purchase donation summary emails")).not.toBeChecked();
  await expect(page.getByLabel("Artist submission notification email")).toBeVisible();

  await page.getByLabel("Send post-purchase donation summary emails").check();
  await page.getByLabel("Artist submission notification email").fill("artist-intake@example.com");
  await page.getByRole("button", { name: "Save email settings" }).click();

  await expect(page.locator("s-banner").getByText("Post-purchase donation email enabled.")).toBeVisible();
  await expect(page.getByLabel("Artist submission notification email")).toHaveValue("artist-intake@example.com");
});

test("settings page saves the Managed Markets enable date", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/settings-email-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.settingsUrl);

  await page.getByRole("tab", { name: "Financial" }).click();
  await expect(page.getByLabel("Managed Markets enable date")).toBeVisible();

  await page.getByLabel("Managed Markets enable date").fill("2025-10-15");
  await page.getByRole("button", { name: "Save Managed Markets date" }).click();

  await expect(page.locator("s-banner").getByText("Managed Markets enable date updated.")).toBeVisible();
  await expect(page.getByLabel("Managed Markets enable date")).toHaveValue("2025-10-15");
});

test("settings page groups cost and tax settings into tabs", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/settings-email-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.settingsUrl);

  await page.getByRole("tab", { name: "Cost Defaults" }).click();
  await expect(page.getByRole("heading", { name: "Cost Defaults" })).toBeVisible();
  await page.getByLabel("Mistake buffer (%)").fill("4");
  await page.getByLabel(/Default labor rate/).fill("18.50");
  await page.getByRole("button", { name: "Save cost defaults" }).click();
  await expect(page.locator("s-banner").getByText("Cost defaults updated.")).toBeVisible();

  await page.getByRole("tab", { name: "Tax" }).click();
  await expect(page.getByRole("heading", { name: "Tax Estimation" })).toBeVisible();
  await page.getByLabel("Effective tax rate (%)").fill("25");
  await page.getByLabel("Tax deduction mode").selectOption("all_causes");
  await page.getByRole("button", { name: "Save tax settings" }).click();
  await expect(page.locator("s-banner").getByText("Tax settings updated.")).toBeVisible();

  await page.getByRole("tab", { name: "Localization" }).click();
  await expect(page.getByRole("heading", { name: "Localization" })).toBeVisible();

  await page.getByRole("tab", { name: "Advanced" }).click();
  await expect(page.getByRole("heading", { name: "Advanced" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open audit log" })).toBeVisible();
});
