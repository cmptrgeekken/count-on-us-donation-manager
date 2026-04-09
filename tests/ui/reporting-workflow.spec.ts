/* eslint-disable testing-library/prefer-screen-queries */
import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test("reporting dashboard shows track summaries and charges", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.reportingUrl);

  await expect(page.getByRole("heading", { name: /Donation pool/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Tax estimation/ })).toBeVisible();

  const chargesRow = page.locator("s-table-row").filter({ hasText: "Shopify charge A" });
  await expect(chargesRow).toBeVisible();
  await expect(chargesRow.getByText("$12.00")).toBeVisible();

  const allocationRow = page.locator("s-table-row").filter({ hasText: "Playwright Cause" }).first();
  await expect(allocationRow).toBeVisible();
  await expect(allocationRow).toContainText("$54.00");

  await expect(page.getByText("Donation pool (after carry-forward)")).toBeVisible();
  const donationPoolSection = page.locator("s-section").filter({ hasText: "Donation pool" });
  await expect(donationPoolSection.getByText("$78.00")).toBeVisible();
});

test("reporting dashboard can close an open period", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.reportingUrl);

  await page.getByRole("button", { name: "Close reporting period" }).click();
  await expect(page.getByText("Close reporting period?")).toBeVisible();
  await page.getByRole("button", { name: "Close period" }).click();

  await expect(page.locator("s-banner").getByText("Reporting period closed.")).toBeVisible();
});

test("reporting dashboard can log a disbursement with a receipt", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.reportingUrl);

  await page.getByRole("button", { name: "Close reporting period" }).click();
  await page.getByRole("button", { name: "Close period" }).click();
  await expect(page.locator("s-banner").getByText("Reporting period closed.")).toBeVisible();

  await page.locator("#disbursement-allocated-amount").fill("20");
  await page.locator("#disbursement-extra-contribution").fill("5");
  await page.locator("#disbursement-fees-covered").fill("2");
  await page.locator("#disbursement-paid-at").fill("2026-03-10");
  await page.locator("#disbursement-method").fill("ACH");
  await page.locator("#disbursement-reference").fill("fixture-ach-001");
  await page.locator("#disbursement-receipt").setInputFiles({
    name: "receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("fixture receipt"),
  });
  await page.getByRole("button", { name: "Log disbursement" }).click();

  await expect(page.locator("s-banner").getByText("Disbursement logged.")).toBeVisible();
  const disbursementRow = page
    .locator("s-table-row")
    .filter({ hasText: "Playwright Cause" })
    .filter({ hasText: "ACH" });
  await expect(disbursementRow).toContainText("$20.00");
  await expect(disbursementRow).toContainText("$5.00");
  await expect(disbursementRow).toContainText("$2.00");
  await expect(disbursementRow).toContainText("$27.00");
  await expect(disbursementRow.getByRole("link", { name: "View receipt" })).toBeVisible();

  const allocationRow = page.locator("s-table-row").filter({ hasText: "Playwright Cause" }).first();
  await expect(allocationRow).toContainText("$20.00");
  await expect(allocationRow).toContainText("$34.00");
});

test("reporting dashboard can record a surplus tax true-up", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/reporting-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.closedReportingUrl);

  const trueUpSection = page.locator("s-section").filter({ hasText: "Tax true-up" });
  await expect(page.getByRole("heading", { name: "Tax true-up" })).toBeVisible();
  await expect(trueUpSection.getByText("$10.00")).toBeVisible();

  await page.locator("#true-up-actual-tax").fill("8");
  await page.locator("#true-up-filed-at").fill("2026-04-08");
  await page.locator('input[name^="redistribution:"]').first().fill("2");
  await page.getByRole("button", { name: "Record tax true-up" }).click();

  await expect(page.locator("s-banner").getByText("Tax true-up recorded.")).toBeVisible();
  const trueUpRow = page.locator("s-table-row").filter({ hasText: "2026" }).filter({ hasText: "$10.00" });
  await expect(trueUpRow).toContainText("$8.00");
  await expect(trueUpRow).toContainText("$2.00");
});
