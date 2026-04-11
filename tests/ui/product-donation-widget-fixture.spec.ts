/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("product donation widget fixture renders the widget shell and product controls", async ({ page }) => {
  await page.goto("/ui-fixtures/product-donation-widget");
  await page.waitForFunction(
    () =>
      (window as Window & { __COUNT_ON_US_PRODUCT_WIDGET_READY__?: boolean }).__COUNT_ON_US_PRODUCT_WIDGET_READY__ === true,
  );

  await expect(page.locator("[data-count-on-us-widget]")).toBeVisible();
  const trigger = page.getByRole("button", { name: "See how we calculate this" });
  await expect(trigger).toBeVisible();
  await expect(page.locator('select[name="id"]')).toBeVisible();
  await expect(page.locator('input[name="quantity"]')).toBeVisible();
});
