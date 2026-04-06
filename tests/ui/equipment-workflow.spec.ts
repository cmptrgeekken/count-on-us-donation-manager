/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("equipment can be created, deactivated, and reactivated on the real route", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/library-pages-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.equipmentUrl);

  await page.locator("ui-title-bar button").filter({ hasText: "New equipment" }).click();
  const equipmentDialog = page.getByRole("dialog").filter({ hasText: "New equipment" });
  await expect(equipmentDialog).toBeVisible();

  await equipmentDialog.getByLabel("Name").fill("Playwright Equipment UI Fresh");
  await equipmentDialog.getByLabel(/Hourly rate/).fill("45");
  await equipmentDialog.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("Equipment created.")).toBeVisible();
  const equipmentRow = page
    .locator("s-table-row")
    .filter({ has: page.getByText("Playwright Equipment UI Fresh", { exact: true }) });
  await expect(equipmentRow).toBeVisible();

  await equipmentRow.getByRole("button", { name: "Deactivate" }).click();
  const deactivateDialog = page.getByRole("dialog").filter({ hasText: "Deactivate equipment" });
  await expect(deactivateDialog).toBeVisible();
  await deactivateDialog.getByRole("button", { name: "Deactivate" }).click();

  await expect(page.getByText("Equipment deactivated.")).toBeVisible();
  await expect(equipmentRow.getByText("Inactive")).toBeVisible();

  await equipmentRow.getByRole("button", { name: "Reactivate" }).click();

  await expect(page.getByText("Equipment reactivated.")).toBeVisible();
  await expect(equipmentRow.getByText("Active")).toBeVisible();
});

test("unused equipment can be deleted and used equipment hide the delete action", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/library-pages-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.equipmentUrl);

  await page.locator("ui-title-bar button").filter({ hasText: "New equipment" }).click();
  const equipmentDialog = page.getByRole("dialog").filter({ hasText: "New equipment" });
  await equipmentDialog.getByLabel("Name").fill("Playwright Equipment UI Delete");
  await equipmentDialog.getByLabel(/Hourly rate/).fill("45.00");
  await equipmentDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Equipment created.")).toBeVisible();

  const deletableRow = page.locator("s-table-row").filter({ has: page.getByText("Playwright Equipment UI Delete") });
  await expect(deletableRow).toBeVisible();
  await deletableRow.getByRole("button", { name: "Delete" }).click();
  const deleteDialog = page.getByRole("dialog").filter({ hasText: "Delete equipment" });
  await deleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Equipment deleted.")).toBeVisible();
  await expect(deletableRow).toHaveCount(0);

  const usedRow = page.locator("s-table-row").filter({ has: page.getByText("Playwright Equipment UI Used") });
  await expect(usedRow.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(usedRow.getByText("Delete unavailable while in use")).toBeVisible();
});

test("equipment can save purchase link and equipment cost metadata", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/library-pages-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.equipmentUrl);

  await page.locator("ui-title-bar button").filter({ hasText: "New equipment" }).click();
  const equipmentDialog = page.getByRole("dialog").filter({ hasText: "New equipment" });
  await expect(equipmentDialog).toBeVisible();

  await equipmentDialog.getByLabel("Name").fill("Playwright Equipment UI Metadata");
  await equipmentDialog.getByLabel(/Hourly rate/).fill("45.00");
  await equipmentDialog.getByLabel("Equipment purchase link").fill("https://example.com/equipment");
  await equipmentDialog.getByLabel(/Equipment cost/).fill("1200");
  await equipmentDialog.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("Equipment created.")).toBeVisible();
  const equipmentRow = page.locator("s-table-row").filter({ has: page.getByText("Playwright Equipment UI Metadata") });
  await expect(equipmentRow).toBeVisible();
  await expect(equipmentRow.getByText("$1,200.00")).toBeVisible();
  await expect(equipmentRow.getByRole("link", { name: "Open" })).toHaveAttribute("href", "https://example.com/equipment");

  await equipmentRow.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog").filter({ hasText: "Edit equipment" });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("Equipment purchase link")).toHaveValue("https://example.com/equipment");
  await expect(editDialog.getByLabel(/Equipment cost/)).toHaveValue("1200.00");
});
