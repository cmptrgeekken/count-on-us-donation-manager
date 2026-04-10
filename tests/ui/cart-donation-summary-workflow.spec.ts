/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("cart donation summary modal renders per-cause totals and returns focus on close", async ({ page }) => {
  await page.goto("/ui-fixtures/cart-donation-summary");
  await page.waitForFunction(
    () => (window as Window & { __COUNT_ON_US_CART_SUMMARY_READY__?: boolean }).__COUNT_ON_US_CART_SUMMARY_READY__ === true,
  );

  const trigger = page.getByRole("button", { name: "See your donation impact" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Cart donation impact" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Neighborhood Arts")).toBeVisible();
  await expect(dialog.getByText("Community Library")).toBeVisible();
  await expect(dialog.getByText("$13.00")).toBeVisible();
  await expect(dialog.getByText("$3.00")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("cart donation summary handles carts without donation products", async ({ page }) => {
  await page.goto("/ui-fixtures/cart-donation-summary?mode=no-donation");
  await page.waitForFunction(
    () => (window as Window & { __COUNT_ON_US_CART_SUMMARY_READY__?: boolean }).__COUNT_ON_US_CART_SUMMARY_READY__ === true,
  );

  await page.getByRole("button", { name: "See your donation impact" }).click();

  const dialog = page.getByRole("dialog", { name: "Cart donation impact" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("No donation products in this cart yet.")).toBeVisible();
});
