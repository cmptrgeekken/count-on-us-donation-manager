/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("donation receipts page shows closed periods and receipt links", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/donation-receipts-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.donationReceiptsUrl);

  await expect(page.getByRole("heading", { name: "Donation receipts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mar 1, 2026 - Mar 31, 2026" })).toBeVisible();
  const periodSection = page.locator("section").filter({ hasText: "Receipt Fixture Cause" }).first();
  await expect(periodSection.getByText("Receipt Fixture Cause: $42.00")).toBeVisible();
  await expect(periodSection.getByRole("cell", { name: "$42.00" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View receipt" })).toBeVisible();
});
