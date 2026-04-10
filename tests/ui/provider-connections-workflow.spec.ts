/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("provider connections can save and disconnect Printify credentials", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/provider-connections-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.providerConnectionsUrl);

  await expect(page.getByRole("heading", { name: "Provider Connections" })).toBeVisible();
  await expect(page.getByText("Variants with SKU")).toBeVisible();
  await expect(page.getByText("Printify API keys can be stored now.")).toBeVisible();

  await page.getByLabel("Shop label").fill("Fixture Printify Shop");
  await page.getByLabel("API key").fill("pk_live_fixture_printify_key_1234");
  await page.getByRole("button", { name: "Save Printify credentials" }).click();

  await expect(
    page.getByText("Printify credentials saved. Live validation and sync will land in a follow-up provider tranche.").last(),
  ).toBeVisible();
  await expect(page.getByText("Stored credential hint: ****1234.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect Printify" })).toBeVisible();

  await page.getByRole("button", { name: "Disconnect Printify" }).click();

  await expect(page.getByText("Printify disconnected.").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Printify credentials" })).toBeVisible();
});

test("provider connections show a visible validation error when Printify API key is blank", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/provider-connections-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.providerConnectionsUrl);

  await page.getByLabel("Shop label").fill("Fixture Printify Shop");
  await page.getByRole("button", { name: "Save Printify credentials" }).click();

  await expect(page.getByText("Printify API key is required.").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Printify credentials" })).toBeVisible();
});
