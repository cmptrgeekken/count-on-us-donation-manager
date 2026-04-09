/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("audit log can filter by event type and paginate", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/audit-log-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.auditLogUrl);

  await expect(page.getByRole("heading", { name: "Financial audit log" })).toBeVisible();
  await expect(page.getByText("VARIANT_CONFIG_UPDATED")).toBeVisible();
  await expect(page.getByText("REPORTING_PERIOD_CLOSED")).toBeVisible();

  await page.selectOption('select[name="action"]', "VARIANT_CONFIG_UPDATED");
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page.getByText("VARIANT_CONFIG_UPDATED")).toBeVisible();
  await expect(page.getByText("REPORTING_PERIOD_CLOSED")).toHaveCount(0);

  await expect(page.getByRole("link", { name: "Next page" })).toBeVisible();
});
