/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("reporting dashboard shows track summaries and charges", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.reportingUrl);

  await expect(page.getByText("Track 1 — Donation pool")).toBeVisible();
  await expect(page.getByText("Track 2 — Tax estimation")).toBeVisible();

  await expect(page.getByText("Shopify charge A")).toBeVisible();
  await expect(page.getByText("$12.00")).toBeVisible();

  await expect(page.getByText("Playwright Cause")).toBeVisible();
  await expect(page.getByText("$54.00")).toBeVisible();

  await expect(page.getByText("Donation pool (after charges)")).toBeVisible();
  await expect(page.getByText("$78.00")).toBeVisible();
});

test("reporting dashboard can close an open period", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.reportingUrl);

  await page.getByRole("button", { name: "Close reporting period" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Close reporting period?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close period" }).click();

  await expect(page.getByText("Reporting period closed.")).toBeVisible();
});
