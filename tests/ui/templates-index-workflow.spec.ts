/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("cost templates can be created, deactivated, and reactivated on the real route", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/library-pages-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.templatesUrl);

  await page.locator("ui-title-bar button").filter({ hasText: "New template" }).click();
  const templateDialog = page.getByRole("dialog").filter({ hasText: "New template" });
  await expect(templateDialog).toBeVisible();

  await templateDialog.getByLabel("Name").fill("Playwright Template UI Fresh");
  await templateDialog.locator("#template-description").fill("Playwright-created template.");
  await templateDialog.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("Template created.")).toBeVisible();
  const templateRow = page
    .locator("s-table-row")
    .filter({ has: page.getByText("Playwright Template UI Fresh", { exact: true }) });
  await expect(templateRow).toBeVisible();

  await templateRow.getByRole("button", { name: "Deactivate" }).click();
  const deactivateDialog = page.getByRole("dialog").filter({ hasText: "Deactivate template" });
  await expect(deactivateDialog).toBeVisible();
  await deactivateDialog.getByRole("button", { name: "Deactivate" }).click();

  await expect(page.getByText("Template deactivated.")).toBeVisible();
  await expect(templateRow.getByText("Inactive")).toBeVisible();

  await templateRow.getByRole("button", { name: "Reactivate" }).click();

  await expect(page.getByText("Template reactivated.")).toBeVisible();
  await expect(templateRow.getByText("Active")).toBeVisible();
});

test("unused templates can be deleted and assigned templates hide the delete action", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/library-pages-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.templatesUrl);

  await page.locator("ui-title-bar button").filter({ hasText: "New template" }).click();
  const templateDialog = page.getByRole("dialog").filter({ hasText: "New template" });
  await templateDialog.getByLabel("Name").fill("Playwright Template UI Delete");
  await templateDialog.locator("#template-description").fill("Delete me");
  await templateDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Template created.")).toBeVisible();

  const deletableRow = page.locator("s-table-row").filter({ has: page.getByText("Playwright Template UI Delete") });
  await expect(deletableRow).toBeVisible();
  await deletableRow.getByRole("button", { name: "Delete" }).click();
  const deleteDialog = page.getByRole("dialog").filter({ hasText: "Delete template" });
  await deleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Template deleted.")).toBeVisible();
  await expect(deletableRow).toHaveCount(0);

  const usedRow = page.locator("s-table-row").filter({ has: page.getByText("Playwright Template UI Used") });
  await expect(usedRow.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(usedRow.getByText("Delete unavailable while assigned")).toBeVisible();
});
