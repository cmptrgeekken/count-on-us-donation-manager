/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("audit log can filter by event type and paginate", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/audit-log-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.auditLogUrl);

  await expect(page.getByRole("heading", { name: "Financial audit log" })).toBeVisible();
  await expect(page.locator("s-table-row").filter({ hasText: "VARIANT_CONFIG_UPDATED" }).first()).toBeVisible();
  await expect(page.locator("s-table-row").filter({ hasText: "REPORTING_PERIOD_CLOSED" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Next page" })).toBeVisible();

  await page.selectOption('select[name="action"]', "VARIANT_CONFIG_UPDATED");
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page.locator("s-table-row").filter({ hasText: "VARIANT_CONFIG_UPDATED" }).first()).toBeVisible();
  await expect(page.locator("s-table-row").filter({ hasText: "REPORTING_PERIOD_CLOSED" })).toHaveCount(0);
});
