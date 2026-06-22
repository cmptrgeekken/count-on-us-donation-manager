/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("admin shell exposes grouped navigation and preserves embedded query params", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.closedReportingUrl);

  const shellNav = page.getByRole("navigation", { name: "Count On Us admin" });
  await expect(shellNav).toBeVisible();

  const reportingGroup = shellNav.locator(".count-on-us-admin-shell__group-link", { hasText: "Reporting" });
  await expect(reportingGroup).toHaveAttribute("aria-current", "page");

  await expect(shellNav.getByRole("link", { name: "Expenses" })).toBeVisible();
  await expect(shellNav.getByRole("link", { name: "Order History" })).toBeVisible();
  await expect(shellNav.getByRole("link", { name: "Audit Log" })).toBeVisible();

  const expensesHref = await shellNav.getByRole("link", { name: "Expenses" }).getAttribute("href");
  expect(expensesHref).toContain("/app/expenses");
  expect(expensesHref).toContain(`__playwrightShop=${encodeURIComponent(bootstrap.shopId)}`);
  expect(expensesHref).toContain(`periodId=${encodeURIComponent(bootstrap.closedPeriodId)}`);
});

test("admin shell switches to Giving subnav while cross-linking cause assignments", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(`/app/causes?__playwrightShop=${encodeURIComponent(bootstrap.shopId)}`);

  const shellNav = page.getByRole("navigation", { name: "Count On Us admin" });
  const givingGroup = shellNav.locator(".count-on-us-admin-shell__group-link", { hasText: "Giving" });
  await expect(givingGroup).toHaveAttribute("aria-current", "page");

  await expect(shellNav.getByRole("link", { name: "Causes" })).toBeVisible();
  const assignmentLink = shellNav.getByRole("link", { name: "Cause Assignments" });
  await expect(assignmentLink).toBeVisible();
  await expect(assignmentLink).toHaveAttribute("href", /\/app\/products\?__playwrightShop=/);
});

