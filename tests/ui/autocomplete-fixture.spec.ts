/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test.describe("autocomplete fixture", () => {
  test("results stay hidden until search input interaction", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/ui-fixtures/autocomplete");

    await page.getByTestId("open-dialog").click();
    await expect(page.getByRole("dialog", { name: "Add material" })).toBeVisible();
    await expect(page.getByTestId("material-results")).toHaveCount(0);

    await expect(page.getByRole("dialog", { name: "Add material" })).toHaveScreenshot("autocomplete-dialog-closed.png");

    await page.getByTestId("material-search").click();
    await expect(page.getByTestId("material-results")).toBeVisible();
    await expect(page.getByText("Laminate Sheet")).toBeVisible();

    await expect(page.getByRole("dialog", { name: "Add material" })).toHaveScreenshot("autocomplete-dialog-open.png");
  });

  test("selecting a result populates the field and closes the list", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/ui-fixtures/autocomplete");

    await page.getByTestId("open-dialog").click();
    await page.getByTestId("material-search").click();
    await page.getByRole("button", { name: "Super Glue" }).click();

    await expect(page.getByTestId("material-search")).toHaveValue("Super Glue");
    await expect(page.getByTestId("selected-material")).toContainText("Super Glue");
    await expect(page.getByTestId("material-results")).toHaveCount(0);
  });
});
