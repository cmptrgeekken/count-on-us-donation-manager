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

test("variants page filters by product category for bulk selection", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/products-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantsUrl);

  await page.getByRole("button", { name: "Filter Product" }).click();
  const productFilter = page.getByRole("dialog", { name: "Filter Product" });
  await page.locator("#variants-category-filter").selectOption({ label: "Earrings" });
  await productFilter.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByLabel("Select Small")).toBeVisible();
  await expect(page.getByLabel("Select Large")).toBeVisible();
  await expect(page.getByLabel("Select Small").locator("xpath=ancestor::s-table-row[1]")).toContainText("Partial Product");
  await expect(page.getByLabel("Select Large").locator("xpath=ancestor::s-table-row[1]")).toContainText("Partial Product");
  await expect(page.getByLabel("Select Default")).toHaveCount(0);
});

test("product and variant text-column filters narrow search results", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/products-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();
  const bootstrap = await bootstrapResponse.json();

  await page.goto(bootstrap.productsUrl);
  await page.getByRole("button", { name: "Filter Product" }).click();
  await page.locator("#products-product-match-filter").selectOption("equals");
  await page.locator("#products-product-filter").fill("configured-product");
  await page.getByRole("dialog", { name: "Filter Product" }).getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Configured Product", { exact: true })).toBeVisible();
  await expect(page.getByText("Partial Product", { exact: true })).toHaveCount(0);

  await page.goto(bootstrap.variantsUrl);
  await page.getByRole("button", { name: "Filter Variant" }).click();
  await page.locator("#variants-variant-title-match-filter").selectOption("startsWith");
  await page.locator("#variants-variant-title-filter").fill("Lar");
  await page.getByRole("dialog", { name: "Filter Variant" }).getByRole("button", { name: "Apply" }).click();
  await expect(page.getByLabel("Select Large")).toBeVisible();
  await expect(page.getByLabel("Select Small")).toHaveCount(0);
  await expect(page.getByLabel("Select Default")).toHaveCount(0);
});

test("variant filters can find rows with no template value", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/products-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();
  const bootstrap = await bootstrapResponse.json();

  await page.goto(bootstrap.variantsUrl);
  await page.getByRole("button", { name: "Filter Template" }).click();
  await page.locator("#variants-template-match-filter").selectOption("empty");
  await expect(page.locator("#variants-template-filter")).toHaveCount(0);
  await page.getByRole("dialog", { name: "Filter Template" }).getByRole("button", { name: "Apply" }).click();

  await expect(page.getByLabel("Select Large")).toBeVisible();
  await expect(page.getByLabel("Select Small")).toHaveCount(0);
  await expect(page.getByLabel("Select Default")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change Template" })).toBeVisible();
});
