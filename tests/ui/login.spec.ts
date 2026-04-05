/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("login route renders", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/auth/login");

  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.getByLabel("Shop domain")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

  await expect(page).toHaveScreenshot("login-route.png", {
    fullPage: true,
  });
});
