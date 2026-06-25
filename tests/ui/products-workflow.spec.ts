/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("products page can queue a catalog sync without clearing seed data", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/products-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.productsUrl);

  await expect(page.getByRole("heading", { name: "Catalog sync" })).toBeVisible();
  await expect(page.getByText("Last completed sync")).toBeVisible();
  await expect(page.getByText("Variant costs")).toBeVisible();
  await expect(page.getByText("Configured Product")).toBeVisible();
  await expect(page.getByText("Partial Product")).toBeVisible();
  await expect(page.getByText("1/1")).toBeVisible();
  await expect(page.getByText("1/2")).toBeVisible();
  await expect(page.getByRole("link", { name: "1/1" })).toHaveAttribute(
    "href",
    /\/app\/variants\?__playwrightShop=.*&product=/,
  );
  await expect(page.getByRole("link", { name: "1/2" })).toHaveAttribute(
    "href",
    /\/app\/variants\?__playwrightShop=.*&product=/,
  );
  await expect(page.locator("a[title='All 1 variants have cost information configured.']")).toBeVisible();
  await expect(
    page.locator(
      "a[title='1 of 2 variants have cost information configured. Configure 1 remaining variant before relying on estimates.']",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage" })).toHaveCount(2);

  await page.getByRole("button", { name: "Sync catalog now" }).click();

  await expect(
    page.getByText(
      "Catalog sync queued. Shopify products and variants will be added or refreshed without deleting your existing local seed data.",
    ),
  ).toBeVisible();
});
