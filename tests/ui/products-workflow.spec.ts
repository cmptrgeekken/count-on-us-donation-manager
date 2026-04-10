/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("products page can queue a catalog sync without clearing seed data", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/products-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.productsUrl);

  await expect(page.getByRole("heading", { name: "Catalog sync" })).toBeVisible();
  await expect(page.getByText("Last completed sync")).toBeVisible();

  await page.getByRole("button", { name: "Sync catalog now" }).click();

  await expect(
    page.getByText(
      "Catalog sync queued. Shopify products and variants will be added or refreshed without deleting your existing local seed data.",
    ),
  ).toBeVisible();
});
