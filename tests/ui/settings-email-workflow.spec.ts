/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("settings page exposes the post-purchase donation email toggle", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/settings-email-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.settingsUrl);

  await expect(page.getByRole("heading", { name: "Donation Email" })).toBeVisible();
  await expect(page.getByLabel("Send post-purchase donation summary emails")).not.toBeChecked();

  await page.getByLabel("Send post-purchase donation summary emails").check();
  await page.getByRole("button", { name: "Save email settings" }).click();

  await expect(page.getByText("Post-purchase donation email enabled.")).toBeVisible();
});
