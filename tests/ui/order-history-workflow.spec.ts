/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("order history can filter and create a manual adjustment on the real routes", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/order-history-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.historyUrl);

  await expect(page.getByText(bootstrap.webhookOrderNumber)).toBeVisible();
  await expect(page.getByText(bootstrap.reconciliationOrderNumber)).toBeVisible();

  await page.getByRole("link", { name: "Reconciliation" }).click();
  await expect(page.getByText(bootstrap.reconciliationOrderNumber)).toBeVisible();
  await expect(page.getByText(bootstrap.webhookOrderNumber)).toHaveCount(0);

  await page.goto(bootstrap.detailUrl);
  await expect(page.getByText("Playwright Snapshot Product")).toBeVisible();
  await page.locator("summary").filter({ hasText: /Adjustments \(0\)/ }).click();

  await page.locator('input[name="reason"]').fill("Playwright adjustment");
  await page.locator('input[name="materialAdj"]').fill("2.00");
  await page.getByRole("button", { name: "Add manual adjustment" }).click();

  await expect(page.locator("s-banner").getByText("Manual adjustment created.")).toBeVisible();
  await page.reload();
  await page.locator("summary").filter({ hasText: /Adjustments \(1\)/ }).click();

  await expect(page.getByText("Playwright adjustment")).toBeVisible();
  await expect(page.getByText("Manual adjustment", { exact: true })).toBeVisible();
  const materialsTile = page.getByText("Materials", { exact: true }).locator("xpath=..");
  await expect(materialsTile.getByText("$5.00")).toBeVisible();
});

test("order history date filters narrow and clear the list", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/order-history-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.historyUrl);

  await expect(page.getByText(bootstrap.webhookOrderNumber)).toBeVisible();
  await expect(page.getByText(bootstrap.reconciliationOrderNumber)).toBeVisible();

  await page.locator('input[name="startDate"]').fill("2026-04-05");
  await page.getByRole("button", { name: "Apply dates" }).click();

  await expect(page.getByText(bootstrap.webhookOrderNumber)).toBeVisible();
  await expect(page.getByText(bootstrap.reconciliationOrderNumber)).toHaveCount(0);

  await page.goto(bootstrap.historyUrl);

  await expect(page.getByText(bootstrap.webhookOrderNumber)).toBeVisible();
  await expect(page.getByText(bootstrap.reconciliationOrderNumber)).toBeVisible();
});

test("order history gives merchants a resolution path for lifecycle-excluded orders", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/order-history-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.reviewHistoryUrl);

  await expect(page.getByText(bootstrap.reconciliationOrderNumber)).toBeVisible();
  await expect(page.getByText(bootstrap.webhookOrderNumber)).toHaveCount(0);
  await expect(page.getByText(/Showing orders excluded from finalized reporting/)).toBeVisible();

  await page.goto(bootstrap.reviewDetailUrl);
  await expect(page.getByText(/excluded from finalized reporting and production usage/)).toBeVisible();
  await page.getByLabel("I reviewed this order in Shopify and confirm this status.").check();
  await page.getByRole("button", { name: "Save lifecycle status" }).click();

  await expect(page.locator("s-banner").getByText(/Order lifecycle confirmed/)).toBeVisible();
  await expect(page.getByText(/Current lifecycle: active/)).toBeVisible();
});

test("order history supports bulk lifecycle review", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/order-history-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.reviewHistoryUrl);

  await page.getByLabel(`Select ${bootstrap.reconciliationOrderNumber} for lifecycle review`).check();
  await page.getByLabel("I reviewed the selected orders in Shopify and confirm this status.").check();
  await page.getByRole("button", { name: "Confirm selected orders" }).click();

  await expect(page.locator("s-banner").getByText(/1 order lifecycle\(s\) confirmed/)).toBeVisible();
  await expect(page.getByText(bootstrap.reconciliationOrderNumber)).toHaveCount(0);
});
