/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test.describe("staged editor fixture", () => {
  test("save bar appears only after a staged change", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/ui-fixtures/staged-editor");

    const nameField = page.getByTestId("fixture-name");
    const saveBar = page.getByTestId("fixture-save-bar");

    await expect(saveBar).toHaveCount(0);
    await expect(nameField).toHaveValue("Sticker Sheet Template");

    await nameField.fill("Sticker Sheet Template v2");
    await expect(nameField).toHaveValue("Sticker Sheet Template v2");
    await expect(saveBar).toBeVisible();

    await expect(page).toHaveScreenshot("staged-editor-dirty.png", {
      fullPage: true,
    });
  });

  test("discard resets the draft and hides the save bar", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/ui-fixtures/staged-editor");

    await page.getByTestId("fixture-description").fill("Changed description");
    await page.getByTestId("fixture-discard").click();

    await expect(page.getByTestId("fixture-description")).toHaveValue("Laminated sticker set with backing card.");
    await expect(page.getByTestId("fixture-status")).toContainText("Discarded staged changes.");
    await expect(page.getByTestId("fixture-save-bar")).toHaveCount(0);
  });

  test("save commits the draft and clears the dirty state", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/ui-fixtures/staged-editor");

    await page.getByTestId("fixture-name").fill("Saved Template Name");
    await page.getByTestId("fixture-save").click();

    await expect(page.getByTestId("fixture-name")).toHaveValue("Saved Template Name");
    await expect(page.getByTestId("fixture-status")).toContainText("Saved staged changes.");
    await expect(page.getByTestId("fixture-save-bar")).toHaveCount(0);
  });
});
