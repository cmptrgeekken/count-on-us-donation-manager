/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("materials can be deactivated and reactivated on the real route", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/library-pages-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.materialsUrl);

  const materialRow = page.locator("s-table-row").filter({ has: page.getByText("Fixture Laminate") });
  await expect(materialRow).toBeVisible();

  await materialRow.getByRole("button", { name: "Deactivate" }).click();
  const deactivateDialog = page.getByRole("dialog").filter({ hasText: "Deactivate material" });
  await expect(deactivateDialog).toBeVisible();
  await deactivateDialog.getByRole("button", { name: "Deactivate" }).click();

  await expect(page.getByText("Material deactivated.")).toBeVisible();
  await expect(materialRow.getByText("Inactive")).toBeVisible();

  await materialRow.getByRole("button", { name: "Reactivate" }).click();

  await expect(page.getByText("Material reactivated.")).toBeVisible();
  await expect(materialRow.getByText("Active")).toBeVisible();
});

test("unused materials can be deleted and used materials show a blocked delete explanation", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/library-pages-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.materialsUrl);

  const deletableRow = page.locator("s-table-row").filter({ has: page.getByText("Playwright Material UI Delete") });
  await expect(deletableRow).toBeVisible();
  await deletableRow.getByRole("button", { name: "Delete" }).click();
  const deleteDialog = page.getByRole("dialog").filter({ hasText: "Delete material" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Material deleted.")).toBeVisible();
  await expect(deletableRow).toHaveCount(0);

  const usedRow = page.locator("s-table-row").filter({ has: page.getByText("Playwright Material UI Used") });
  await usedRow.getByRole("button", { name: "Delete" }).click();
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog.getByText("This material is still used in 1 template(s) and 0 variant config(s), so deletion is blocked.")).toBeVisible();
  await expect(deleteDialog.getByRole("button", { name: "Delete" })).toBeDisabled();
});
