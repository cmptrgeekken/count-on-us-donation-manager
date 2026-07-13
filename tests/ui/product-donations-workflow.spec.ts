/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("product detail summarizes and links to product variants", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/product-donations-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.productUrl);

  await expect(page.getByRole("heading", { name: "Variants" })).toBeVisible();
  await expect(page.getByText("Review whether each variant is ready for donation estimates.")).toBeVisible();
  await expect(page.getByText("Needs setup").first()).toBeVisible();
  await expect(page.getByText("Small")).toBeVisible();
  await expect(page.getByText("Large")).toBeVisible();
  await expect(page.getByText("Playwright Product Detail Template")).toBeVisible();
  await expect(page.getByRole("link", { name: "View all variants for this product" })).toHaveAttribute(
    "href",
    new RegExp(`/app/variants\\?__playwrightShop=.*&product=${bootstrap.productId}`),
  );
  expect(await page.getByRole("button", { name: "Configure" }).count()).toBeGreaterThanOrEqual(2);
});

test("product donations can add a second cause assignment and persist it", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/product-donations-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.productUrl);

  await expect(page.getByText("Total allocation: 60.00%")).toBeVisible();

  await page.getByRole("button", { name: "Add Causes" }).click();
  await page.getByRole("dialog").getByText(bootstrap.secondCauseName).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add selected" }).click();

  const secondPercentageField = page.locator("#percentage-1");
  await secondPercentageField.fill("40");
  await page.getByRole("button", { name: "Save assignments" }).click();

  await expect(page.getByText("Product Cause assignments saved.")).toBeVisible();
  await expect(page.getByText("Total allocation: 100.00%")).toBeVisible();

  await page.reload();

  await expect(page.getByText(bootstrap.secondCauseName)).toBeVisible();
  await expect(page.getByText("Total allocation: 100.00%")).toBeVisible();
});

test("product donations reject assignment totals above 100 percent", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/product-donations-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.productUrl);

  await page.getByRole("button", { name: "Add Causes" }).click();
  await page.getByRole("dialog").getByText(bootstrap.secondCauseName).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add selected" }).click();
  await page.locator("#percentage-1").fill("50");
  await page.getByRole("button", { name: "Save assignments" }).click();

  await expect(page.locator("s-banner").getByText("Cause percentages must total 100% or less.")).toBeVisible();
  await expect(page.getByText("Total allocation: 110.00%")).toBeVisible();

  await page.reload();
  await expect(page.getByText(bootstrap.secondCauseName)).toHaveCount(0);
  await expect(page.getByText("Total allocation: 60.00%")).toBeVisible();
});

test("product Cause overrides preserve Artist routing and can return to Artist preferences", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/product-donations-bootstrap?withArtist=1");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  const overrideResponse = await request.post(bootstrap.productUrl, {
    form: {
      intent: "save-assignments",
      assignments: JSON.stringify([{ causeId: bootstrap.firstCauseId, percentage: "100" }]),
    },
  });
  expect(overrideResponse.ok()).toBeTruthy();
  await page.goto(bootstrap.productUrl);

  await expect(page.locator("#donation-routing-mode")).toHaveValue("product_override");
  await expect(page.getByText(bootstrap.firstCauseName).first()).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#donation-routing-mode").selectOption("automatic");
  await expect(page.getByText("Product Cause override cleared. Artist Cause preferences are active.")).toBeVisible();
  await expect(page.getByText(bootstrap.secondCauseName).first()).toBeVisible();
  await expect(page.getByText(bootstrap.firstCauseName)).toHaveCount(0);

  await page.reload();
  await expect(page.locator("#donation-routing-mode")).toHaveValue("automatic");
  await expect(page.getByText("Playwright Artist").first()).toBeVisible();
});

test("Product List can bulk set and clear Cause overrides without removing Artists", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/product-donations-bootstrap?withArtist=1");
  expect(bootstrapResponse.ok()).toBeTruthy();
  const bootstrap = await bootstrapResponse.json();

  await page.goto(`/app/products?__playwrightShop=${encodeURIComponent(bootstrap.shopId)}`);
  const productCheckbox = page.getByRole("checkbox", { name: "Select Playwright Donation Product" });
  await productCheckbox.check();
  await page.locator("#bulk-assignment-mode").selectOption("cause");
  await page.getByRole("button", { name: "Add Causes" }).click();
  await page.getByRole("dialog").getByText("Playwright Cause A").click();
  await page.getByRole("dialog").getByRole("button", { name: "Add selected" }).click();
  const percentageField = page.getByRole("spinbutton", { name: "Percentage for Playwright Cause A" });
  await percentageField.fill("75");
  await expect(page.getByText("Cause routing (75.00%)")).toBeVisible();
  await percentageField.fill("100");
  await page.getByRole("button", { name: "Apply assignment" }).click();

  await expect(page.getByText("Cause routing updated for 1 product without removing Artists.")).toBeVisible();
  await expect(page.getByText("Product override")).toBeVisible();

  await productCheckbox.check();
  await page.locator("#bulk-assignment-mode").selectOption("clear_override");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear overrides" }).click();

  await expect(page.getByText("1 product override cleared; 0 selected products were unchanged.")).toBeVisible();
  await expect(page.getByText("Artist preferences")).toBeVisible();
  await expect(page.getByText("Playwright Donation Product")).toBeVisible();
});
