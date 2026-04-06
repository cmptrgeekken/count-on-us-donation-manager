/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("expenses can be created and deleted on the real route", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/expenses-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.expensesUrl);

  await page.locator("ui-title-bar button").filter({ hasText: "Add expense" }).click();
  await page.locator("#expense-name").fill("Playwright Expense");
  await page.locator("#expense-amount").fill("25.50");
  await page.locator("#expense-date").fill("2026-04-05");
  await page.locator("#expense-notes").fill("Playwright coverage expense");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("Expense created.")).toBeVisible();
  await expect(page.getByText("Playwright Expense")).toBeVisible();

  const expenseRow = page.getByText("Playwright Expense").locator("xpath=ancestor::s-table-row[1]");
  await expenseRow.getByRole("button", { name: "Delete" }).click();

  const deleteDialog = page.getByRole("dialog").filter({ hasText: "Delete expense" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Expense deleted.")).toBeVisible();
  await expect(page.getByText("Playwright Expense")).toHaveCount(0);
});
