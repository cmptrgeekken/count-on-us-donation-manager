/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("post-purchase preview transitions from estimated to confirmed", async ({ page }) => {
  await page.goto("/ui-fixtures/post-purchase-donation-preview?mode=confirmed&surface=thank-you");

  await expect(page.getByRole("heading", { name: "Thank you preview" })).toBeVisible();
  await expect(page.getByText("Estimated donation amounts while we confirm the final snapshot.")).toBeVisible();
  await expect(page.getByText("Confirmed donation amounts for this order.")).toBeVisible();
  await expect(page.getByText("$20.00")).toBeVisible();
});

test("post-purchase preview keeps the estimated timeout copy when confirmation never arrives", async ({ page }) => {
  await page.goto("/ui-fixtures/post-purchase-donation-preview?mode=timeout&surface=order-status");

  await expect(page.getByRole("heading", { name: "Order status preview" })).toBeVisible();
  await expect(page.getByText("Estimated — we'll confirm this shortly.")).toBeVisible();
});

test("post-purchase preview hides itself when app data is unavailable or not applicable", async ({ page }) => {
  await page.goto("/ui-fixtures/post-purchase-donation-preview?mode=hidden");

  await expect(page.getByRole("heading", { name: "Thank you preview" })).toBeVisible();
  await expect(page.getByLabel("Donation impact")).toHaveCount(0);
});
