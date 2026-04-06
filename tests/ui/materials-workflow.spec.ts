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

test("unused materials can be deleted and used materials hide the delete action", async ({ page, request }) => {
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
  await expect(usedRow.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(usedRow.getByText("Delete unavailable while in use")).toBeVisible();
});
test("materials can save purchase link and weight metadata", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/library-pages-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.materialsUrl);

  await page.locator("ui-title-bar button").filter({ hasText: "New material" }).click();
  const materialDialog = page.getByRole("dialog").filter({ hasText: "New material" });
  await expect(materialDialog).toBeVisible();

  await materialDialog.getByLabel("Name").fill("Playwright Material UI Metadata");
  await materialDialog.getByLabel("Purchase price").fill("10.00");
  await materialDialog.getByLabel("Purchase quantity").fill("2");
  await materialDialog.getByLabel("Material purchase link").fill("https://example.com/material");
  await materialDialog.getByLabel("Material weight (g)").fill("125.5");
  await materialDialog.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("Material created.")).toBeVisible();
  const materialRow = page.locator("s-table-row").filter({ has: page.getByText("Playwright Material UI Metadata") });
  await expect(materialRow).toBeVisible();
  await expect(materialRow.getByText("125.5 g")).toBeVisible();
  await expect(materialRow.getByRole("link", { name: "Open" })).toHaveAttribute("href", "https://example.com/material");

  await materialRow.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog").filter({ hasText: "Edit material" });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("Material purchase link")).toHaveValue("https://example.com/material");
  await expect(editDialog.getByLabel("Material weight (g)")).toHaveValue("125.5");
});
