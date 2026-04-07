/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("reporting dashboard shows track summaries and charges", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.reportingUrl);

  await expect(page.getByText("Track 1 — Donation pool")).toBeVisible();
  await expect(page.getByText("Track 2 — Tax estimation")).toBeVisible();

  const chargesRow = page.locator("s-table-row").filter({ hasText: "Shopify charge A" });
  await expect(chargesRow).toBeVisible();
  await expect(chargesRow.getByText("$12.00")).toBeVisible();

  const allocationRow = page.locator("s-table-row").filter({ hasText: "Playwright Cause" });
  await expect(allocationRow).toBeVisible();
  await expect(allocationRow.getByText("$54.00")).toBeVisible();

  await expect(page.getByText("Donation pool (after charges)")).toBeVisible();
  const donationPoolSection = page.locator("s-section").filter({ hasText: "Track 1 — Donation pool" });
  await expect(donationPoolSection.getByText("$78.00")).toBeVisible();
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

  await expect(page.locator("s-banner").getByText("Reporting period closed.")).toBeVisible();
});
