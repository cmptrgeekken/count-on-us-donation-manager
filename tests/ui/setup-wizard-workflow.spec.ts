/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("setup wizard supports skip, resume, and manual completion flows", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/setup-wizard-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.dashboardUrl);

  await expect(page.getByRole("heading", { name: "Setup wizard" })).toBeVisible();
  await expect(page.getByText("Step 1 of 9: Create your first cause")).toBeVisible();

  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page.getByText("Step 3 of 9: Review Managed Markets enable date")).toBeVisible();
  await expect(page.getByText("Skipped for now")).toBeVisible();

  await page.getByRole("button", { name: "Resume step" }).click();

  await expect(page.getByText("Step 1 of 9: Create your first cause")).toBeVisible();

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("Step 3 of 9: Review Managed Markets enable date")).toBeVisible();

  await page.getByRole("button", { name: "Mark complete" }).click();

  await expect(page.getByText("Step 4 of 9: Set up material and equipment libraries")).toBeVisible();
});
