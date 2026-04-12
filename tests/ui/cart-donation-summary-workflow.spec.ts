/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("cart donation summary modal renders per-cause totals and returns focus on close", async ({ page }) => {
  await page.goto("/ui-fixtures/cart-donation-summary");
  await page.waitForFunction(
    () => (window as Window & { __COUNT_ON_US_CART_SUMMARY_READY__?: boolean }).__COUNT_ON_US_CART_SUMMARY_READY__ === true,
  );

  const trigger = page.getByRole("button", { name: "See donation details" });
  await trigger.click();

  await expect(page.locator(".cart-item").nth(0)).toContainText("Donations apply");
  await expect(page.locator(".cart-item").nth(1)).toContainText("Donations apply");
  await page.locator(".cart-item").nth(1).getByLabel("Show supported causes").focus();
  await expect(page.locator(".cart-item").nth(1).getByRole("tooltip")).toContainText("50% to Community Library");

  const dialog = page.getByRole("dialog", { name: "Cart donation impact" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".count-on-us-widget__cause").nth(0)).toContainText("Neighborhood Arts");
  await expect(dialog.locator(".count-on-us-widget__cause").nth(0)).toContainText("$23.88");
  await expect(dialog.locator(".count-on-us-widget__cause").nth(1)).toContainText("Community Library");
  await expect(dialog.locator(".count-on-us-widget__cause").nth(1)).toContainText("$3.16");
  const disclosure = dialog.locator("[data-count-on-us-cart-breakdown]");
  await expect(disclosure).toContainText("See how this estimate is calculated");
  await disclosure.locator("summary").click();
  await expect(disclosure).toContainText("Estimated reconciliation");
  await expect(disclosure).toContainText("Estimated total");
  await expect(disclosure).toContainText("$55.00");
  await expect(disclosure).toContainText("Less: Tax reserve");
  await expect(disclosure).toContainText("- $9.01");
  await expect(disclosure).toContainText("Less: Labor");
  await expect(disclosure).toContainText("- $8.00");
  await expect(disclosure).toContainText("Less: Materials");
  await expect(disclosure).toContainText("- $5.00");
  await expect(disclosure).toContainText("Less: Equipment");
  await expect(disclosure).toContainText("- $2.75");
  await expect(disclosure).toContainText("Less: Shopify fees");
  await expect(disclosure).toContainText("(estimate)");
  await expect(disclosure).toContainText("- $2.20");
  await expect(disclosure).toContainText("Less: Packaging");
  await expect(disclosure).toContainText("- $1.00");
  await expect(disclosure).toContainText("Equals: amount remaining after costs");
  await expect(disclosure).toContainText("$27.04");
  await expect(disclosure).toContainText("Allocated to causes");
  await expect(disclosure).toContainText("$27.04");
  await expect(disclosure).toContainText("Retained by shop");
  await expect(disclosure).toContainText("$0.00");
  const feesInfo = disclosure.locator('[aria-label="Learn more about Shopify fees"]');
  await feesInfo.focus();
  await expect(disclosure.getByRole("tooltip")).toContainText(
    "This estimate helps cover payment processing fees charged on the order.",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("cart donation summary handles carts without donation products", async ({ page }) => {
  await page.goto("/ui-fixtures/cart-donation-summary?mode=no-donation");
  await page.waitForFunction(
    () => (window as Window & { __COUNT_ON_US_CART_SUMMARY_READY__?: boolean }).__COUNT_ON_US_CART_SUMMARY_READY__ === true,
  );

  await expect(page.locator("[data-count-on-us-cart-summary]")).toHaveCount(0);
});

test("cart donation summary includes non-cause variants in reconciliation while keeping causes scoped", async ({
  page,
}) => {
  await page.goto("/ui-fixtures/cart-donation-summary?mode=mixed-no-cause");
  await page.waitForFunction(
    () => (window as Window & { __COUNT_ON_US_CART_SUMMARY_READY__?: boolean }).__COUNT_ON_US_CART_SUMMARY_READY__ === true,
  );

  await page.getByRole("button", { name: "See donation details" }).click();

  const dialog = page.getByRole("dialog", { name: "Cart donation impact" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".count-on-us-widget__cause")).toHaveCount(2);
  await expect(dialog).not.toContainText("gid://shopify/Product/3");
  await expect(page.locator(".cart-item").nth(0)).toContainText("Donations apply");
  await expect(page.locator(".cart-item").nth(1)).toContainText("Donations apply");
  await expect(page.locator(".cart-item").nth(2).locator("[data-count-on-us-cart-annotation]")).toHaveCount(0);

  const disclosure = dialog.locator("[data-count-on-us-cart-breakdown]");
  await disclosure.locator("summary").click();
  await expect(disclosure).toContainText("Estimated total");
  await expect(disclosure).toContainText("$85.00");
  await expect(disclosure).toContainText("Allocated to causes");
  await expect(disclosure).toContainText("$27.04");
  await expect(disclosure).toContainText("Retained by shop");
  await expect(disclosure).toContainText("$14.03");
});

test("cart donation summary stays visible when cart quantities change", async ({ page }) => {
  await page.goto("/ui-fixtures/cart-donation-summary");
  await page.waitForFunction(
    () => (window as Window & { __COUNT_ON_US_CART_SUMMARY_READY__?: boolean }).__COUNT_ON_US_CART_SUMMARY_READY__ === true,
  );

  const widget = page.locator("[data-count-on-us-cart-summary]");
  await expect(widget).toBeVisible();

  await page.evaluate(() => {
    const win = window as unknown as {
      __COUNT_ON_US_FIXTURE__: { lines: Array<{ quantity: number; lineSubtotal?: number }> };
      __COUNT_ON_US_FIXTURE_UNIT_PRICES__: Record<number, number>;
    };
    win.__COUNT_ON_US_FIXTURE__.lines[0].quantity = 3;
    win.__COUNT_ON_US_FIXTURE__.lines[0].lineSubtotal = 60;

    const cartItem = document.querySelectorAll(".cart-item")[0];
    cartItem?.querySelector('[data-fixture-qty]')?.replaceChildren(document.createTextNode("Qty 3"));
    const quantityInput = cartItem?.querySelector('input[name="updates[]"]');
    if (quantityInput instanceof HTMLInputElement) {
      quantityInput.value = "3";
    }
  });
  await expect(page.locator('.cart-item').nth(0)).toContainText("Qty 3");
  await expect(widget).toBeVisible();
});

test("cart donation summary refreshes when a new cart line is added", async ({ page }) => {
  await page.goto("/ui-fixtures/cart-donation-summary");
  await page.waitForFunction(
    () => (window as Window & { __COUNT_ON_US_CART_SUMMARY_READY__?: boolean }).__COUNT_ON_US_CART_SUMMARY_READY__ === true,
  );

  await page.evaluate(() => {
    const win = window as unknown as {
      __COUNT_ON_US_FIXTURE__: {
        lines: Array<{ productId: string; variantId: string; quantity: number; lineSubtotal?: number }>;
      };
      __COUNT_ON_US_FIXTURE_UNIT_PRICES__: Record<number, number>;
    };
    const nextLine = {
      productId: "gid://shopify/Product/1",
      variantId: "gid://shopify/ProductVariant/1",
      quantity: 1,
      lineSubtotal: 20,
    };

    win.__COUNT_ON_US_FIXTURE__.lines.push(nextLine);
    win.__COUNT_ON_US_FIXTURE_UNIT_PRICES__[win.__COUNT_ON_US_FIXTURE__.lines.length - 1] = 20;

    const article = document.createElement("article");
    article.className = "cart-item";
    article.style.display = "grid";
    article.style.gap = "0.35rem";
    article.style.padding = "0.85rem 1rem";
    article.style.borderRadius = "14px";
    article.style.background = "#ffffff";
    article.style.border = "1px solid rgba(17, 24, 39, 0.08)";
    article.innerHTML =
      '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline;"><a href="/products/fixture-3" style="color:#111827;font-weight:600;text-decoration:none;">Fixture cart item 3</a><span data-fixture-qty style="color:#6b7280;font-size:0.92rem;">Qty 1</span></div><label style="display:grid;gap:0.25rem;max-width:6rem;"><span style="color:#6b7280;font-size:0.82rem;">Quantity</span><input name="updates[]" type="number" value="1" min="0"></label>';
    document.querySelector("main section")?.appendChild(article);
  });

  await expect(page.locator("[data-count-on-us-cart-summary]")).toBeVisible();
  await expect(page.locator(".cart-item")).toHaveCount(3);
  await page.locator(".cart-item").nth(2).locator('input[name="updates[]"]').dispatchEvent("change");
  await expect(page.locator(".cart-item").nth(2)).toContainText("Donations apply");
});

test("cart donation summary annotations stay aligned when the cart repeats the same product with different variants", async ({
  page,
}) => {
  await page.goto("/ui-fixtures/cart-donation-summary?mode=duplicate-product");
  await page.waitForFunction(
    () => (window as Window & { __COUNT_ON_US_CART_SUMMARY_READY__?: boolean }).__COUNT_ON_US_CART_SUMMARY_READY__ === true,
  );

  await page.getByRole("button", { name: "See donation details" }).click();
  await page.keyboard.press("Escape");

  await expect(page.locator(".cart-item")).toHaveCount(3);
  await expect(page.locator(".cart-item").nth(0).locator("[data-count-on-us-cart-annotation]")).toHaveCount(1);
  await expect(page.locator(".cart-item").nth(1).locator("[data-count-on-us-cart-annotation]")).toHaveCount(1);
  await expect(page.locator(".cart-item").nth(2).locator("[data-count-on-us-cart-annotation]")).toHaveCount(1);

  await page.locator(".cart-item").nth(2).getByLabel("Show supported causes").focus();
  await expect(page.locator(".cart-item").nth(2).getByRole("tooltip")).toContainText("60% to Neighborhood Arts");
  await expect(page.locator(".cart-item").nth(2).getByRole("tooltip")).toContainText("40% to Community Library");
});
