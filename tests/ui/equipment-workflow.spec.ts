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

  await equipmentDialog.getByLabel("Name").fill("Playwright Equipment UI");
  await equipmentDialog.getByLabel(/Hourly rate/).fill("45");
  await equipmentDialog.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("Equipment created.")).toBeVisible();
  const equipmentRow = page.locator("s-table-row").filter({ has: page.getByText("Playwright Equipment UI") });
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
