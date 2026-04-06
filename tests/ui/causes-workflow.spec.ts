/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("causes can be created, deactivated, and reactivated on the real route", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/causes-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.causesUrl);

  await page.getByText("New cause", { exact: true }).nth(1).click();
  const causeDialog = page.getByRole("dialog").filter({ hasText: "New cause" });
  await expect(causeDialog).toBeVisible();
  await causeDialog.locator("#cause-name").fill("Playwright Cause UI");
  await causeDialog.locator("#cause-legal-name").fill("Playwright Cause UI Foundation");
  await causeDialog.locator("#cause-description").fill("Created by Playwright.");
  await causeDialog.locator("#cause-donationLink").fill("https://example.org/donate");
  await causeDialog.getByRole("button", { name: "Create" }).click();

  const causeRow = page
    .locator("s-table-row")
    .filter({ has: page.getByText("Playwright Cause UI") });

  await expect(page.getByText("Cause created.")).toBeVisible();
  await expect(causeRow).toBeVisible();

  await causeRow.getByRole("button", { name: "Deactivate" }).click();
  const deactivateDialog = page.getByRole("dialog").filter({ hasText: "Deactivate cause" });
  await expect(deactivateDialog).toBeVisible();
  await deactivateDialog.getByRole("button", { name: "Deactivate" }).click();

  await expect(page.getByText("Cause deactivated.")).toBeVisible();
  await expect(causeRow.getByText("Inactive")).toBeVisible();

  await causeRow.getByRole("button", { name: "Reactivate" }).click();

  await expect(page.locator("s-banner").getByText("Cause reactivated.")).toBeVisible();
  await expect(causeRow.getByText("Active")).toBeVisible();
});

test("causes show inline URL validation errors in the modal", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/causes-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.causesUrl);

  await page.getByText("New cause", { exact: true }).nth(1).click();
  const causeDialog = page.getByRole("dialog").filter({ hasText: "New cause" });
  await expect(causeDialog).toBeVisible();

  await causeDialog.locator("#cause-name").fill("Playwright Invalid Cause");
  await causeDialog.locator("#cause-donationLink").fill("not-a-url");
  await causeDialog.getByRole("button", { name: "Create" }).click();

  await expect(causeDialog).toBeVisible();
  await expect(causeDialog.locator("#cause-donationLink").locator("xpath=following-sibling::*[1]")).toHaveText(
    "Donation link must be a valid URL.",
  );
  await expect(causeDialog.locator("#cause-name")).toHaveValue("Playwright Invalid Cause");
  await expect(page.locator("s-table-row").filter({ has: page.getByText("Playwright Invalid Cause") })).toHaveCount(0);
});
