/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("production usage summarizes materials, equipment, consumables, and packaging", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.productionUsageUrl);

  await expect(page.getByText("Fixture Paper")).toBeVisible();
  await expect(page.getByText(/Fixture Press — 1 hours, 1 uses/)).toBeVisible();
  await page.getByText(/Fixture Press — 1 hours, 1 uses/).click();
  await expect(page.getByText(/Fixture Blade \(uses\): \$0\.50/)).toBeVisible();
  await expect(page.getByText(/Fixture Mailer: 1 packages, \$3\.00/)).toBeVisible();
  await expect(page.getByText("Material cost").locator("..")).toContainText("$10.00");
  await expect(page.getByText("Equipment cost").locator("..")).toContainText("$2.00");
  await expect(page.getByText("Consumable cost").locator("..")).toContainText("$0.50");
});

test("production usage exports the selected report as CSV", async ({ request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();
  const bootstrap = await bootstrapResponse.json();

  const response = await request.get(
    `/app/production-usage-export?__playwrightShop=${encodeURIComponent(bootstrap.shopId)}&range=all`,
  );
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/csv");
  const csv = await response.text();
  expect(csv).toContain("material,Fixture Paper");
  expect(csv).toContain("equipment,Fixture Press");
  expect(csv).toContain("consumable,Fixture Press: Fixture Blade");
  expect(csv).toContain("package,Fixture Mailer");
});
