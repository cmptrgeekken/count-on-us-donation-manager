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

  await expect(page.getByText("Manual adjustment created.")).toBeVisible();
  await page.reload();
  await page.locator("summary").filter({ hasText: /Adjustments \(1\)/ }).click();

  await expect(page.getByText("Playwright adjustment")).toBeVisible();
  await expect(page.getByText("Manual adjustment", { exact: true })).toBeVisible();
  const materialsTile = page.getByText("Materials", { exact: true }).locator("xpath=..");
  await expect(materialsTile.getByText("$5.00")).toBeVisible();
});
