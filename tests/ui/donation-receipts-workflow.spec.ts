/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("donation receipts page shows closed periods and receipt links", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/donation-receipts-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.donationReceiptsUrl);

  await expect(page.getByRole("heading", { name: "Donation receipts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mar 1, 2026 - Mar 31, 2026" })).toBeVisible();
  await expect(page.getByText("Receipt Fixture Cause")).toBeVisible();
  await expect(page.getByText("$42.00")).toBeVisible();
  await expect(page.getByRole("link", { name: "View receipt" })).toBeVisible();
});
