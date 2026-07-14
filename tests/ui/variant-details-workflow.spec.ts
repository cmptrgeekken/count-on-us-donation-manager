/* eslint-disable testing-library/prefer-screen-queries */
import { expect, test } from "@playwright/test";

test("variant details save and discard work on the real route", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(bootstrap.variantUrl);

  await expect(page.getByRole("link", { name: "View product" })).toHaveAttribute(
    "href",
    new RegExp(`/app/products/${bootstrap.productId ?? "[^?]+"}`),
  );

  const minutesField = page.getByLabel("Minutes per variant");
  const saveButton = page.locator("ui-save-bar button", { hasText: "Save" });
  const discardButton = page.locator("ui-save-bar button", { hasText: "Discard" });

  await expect(minutesField).toHaveValue("");

  await minutesField.fill("12");
  await saveButton.click();

  await expect(minutesField).toHaveValue("12");
  await expect(page.getByText("Variant configuration saved.")).toBeVisible();

  await page.reload();
  await expect(minutesField).toHaveValue("12");

  await minutesField.fill("20");
  await discardButton.click();

  await expect(minutesField).toHaveValue("12");
});

test("variant details default new variable-yield material lines to 1", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Add material" }).click();
  await expect(page.getByText("Add material line")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add", exact: true }).first()).toBeDisabled();
  await page.getByRole("button", { name: "Choose material" }).click();
  const searchInput = page.getByPlaceholder("Search materials");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("Playwright Yield Material");
  await page.getByRole("radio", { name: /Playwright Yield Material/ }).check();
  await page.getByRole("button", { name: "Add selected" }).click();

  await expect(page.getByLabel("Products made per purchased unit")).toHaveValue("1");
});

test("variant details groups additional shipping material lines separately", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Add material" }).click();
  await expect(page.getByText("Add material line")).toBeVisible();
  await page.getByRole("button", { name: "Choose material" }).click();
  let searchInput = page.getByPlaceholder("Search materials");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("ZZZ Playwright Shipping Material");
  await page.getByRole("radio", { name: /ZZZ Playwright Shipping Material/ }).check();
  await page.getByRole("button", { name: "Add selected" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  await expect(page.getByRole("heading", { name: "Variant-specific shipping" })).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "ZZZ Playwright Shipping Material" }),
  ).toBeVisible();
  await expect(page.locator("s-badge").filter({ hasText: /^Variant-specific$/ })).toHaveCount(0);
  await expect(page.locator("s-badge").filter({ hasText: /^Shipping$/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editDialog = page.getByRole("dialog").filter({ hasText: "Edit material line" });
  await editDialog.getByLabel("Products made per purchased unit").fill("4");
  await editDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Variable yield: 1 purchased unit(s), 4 product(s)", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add material" }).click();
  await expect(page.getByText("Add material line")).toBeVisible();
  await page.getByRole("button", { name: "Choose material" }).click();
  searchInput = page.getByPlaceholder("Search materials");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("ZZZ Playwright Shipping Material");
  await expect(page.getByRole("radio", { name: /ZZZ Playwright Shipping Material/ })).toHaveCount(0);
});

test("variant details use searchable equipment add picker and suppress duplicates", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Add equipment" }).click();
  let addDialog = page.getByRole("dialog").filter({ hasText: "Add equipment line" });
  await expect(addDialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await addDialog.getByRole("button", { name: "Choose equipment" }).click();
  await page.getByRole("radio", { name: /Playwright Heat Press/ }).check();
  await page.getByRole("button", { name: "Add selected" }).click();
  await addDialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByRole("paragraph").filter({ hasText: "Playwright Heat Press" })).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editDialog = page.getByRole("dialog").filter({ hasText: "Edit equipment line" });
  await editDialog.getByLabel("Minutes").fill("6");
  await editDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("6 min", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add equipment" }).click();
  addDialog = page.getByRole("dialog").filter({ hasText: "Add equipment line" });
  await addDialog.getByRole("button", { name: "Choose equipment" }).click();
  await addDialog.getByPlaceholder("Search equipment").fill("Playwright Heat Press");
  await expect(page.getByRole("radio", { name: /Playwright Heat Press/ })).toHaveCount(0);
});

test("variant details persist production and shipping template assignments", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Assign", exact: true }).click();
  const productionDialog = page.locator("dialog").filter({ hasText: "Assign production template" });
  await expect(productionDialog).toBeVisible();
  await productionDialog.getByRole("button", { name: "Change template" }).click();
  await page.getByRole("radio", { name: /Playwright Production Template/ }).check();
  await page.getByRole("button", { name: "Add selected" }).click();
  await productionDialog.getByRole("button", { name: "Assign", exact: true }).click();

  await expect(page.getByText("Inherited", { exact: true })).toBeVisible();
  await expect(page.locator("p").filter({ hasText: "Playwright Shipping Template" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shipping template" })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "ZZZ Playwright Shipping Material" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Override", exact: true })).toBeVisible();
  await expect(page.locator("s-badge").filter({ hasText: /^(Template|Production|Shipping template|Shipping)$/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Set override" }).click();
  const shippingDialog = page.locator("dialog").filter({ hasText: "Assign shipping template override" });
  await expect(shippingDialog).toBeVisible();
  await shippingDialog.getByRole("button", { name: /template/ }).click();
  await page.getByRole("radio", { name: /Playwright Shipping Override Template/ }).check();
  await page.getByRole("button", { name: "Add selected" }).click();
  await shippingDialog.getByRole("button", { name: "Set override", exact: true }).click();

  const saveButton = page.locator("ui-save-bar button", { hasText: "Save" });
  await saveButton.click();

  await expect(page.getByText("Variant configuration saved.")).toBeVisible();
  await expect(page.locator("s-badge").filter({ hasText: "Override" })).toBeVisible();
  await expect(page.getByText("Playwright Shipping Override Template", { exact: true }).first()).toBeVisible();

  await page.reload();

  await expect(page.getByText("Playwright Production Template", { exact: true }).first()).toBeVisible();
  await expect(page.locator("s-badge").filter({ hasText: "Override" })).toBeVisible();
  await expect(page.getByText("Playwright Shipping Override Template", { exact: true }).first()).toBeVisible();
});

test("variant details persist inherited shipping template line overrides", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByRole("button", { name: "Assign", exact: true }).click();
  const productionDialog = page.locator("dialog").filter({ hasText: "Assign production template" });
  await productionDialog.getByRole("button", { name: "Change template" }).click();
  await page.getByRole("radio", { name: /Playwright Production Template/ }).check();
  await page.getByRole("button", { name: "Add selected" }).click();
  await productionDialog.getByRole("button", { name: "Assign", exact: true }).click();

  await page.getByRole("button", { name: "Override", exact: true }).click();
  const overrideDialog = page.getByRole("dialog").filter({ hasText: "Override ZZZ Playwright Shipping Material" });
  await overrideDialog.getByLabel("Products made per purchased unit").fill("5");
  await overrideDialog.getByRole("button", { name: "Apply override" }).click();
  await page.locator("ui-save-bar button", { hasText: "Save" }).click();

  await expect(page.getByText("Variant configuration saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Override active")).toBeVisible();
  await expect(page.getByText("Override: Variable yield: 1 purchased unit(s), 5 product(s)")).toBeVisible();
  await expect(page.getByText("Default cost per item: $3.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Override cost per item: $0.60", { exact: true })).toBeVisible();
});

test("variant details can copy configuration from another variant", async ({ page, request }) => {
  const bootstrapResponse = await request.get("/ui-fixtures/variant-details-bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();

  const bootstrap = await bootstrapResponse.json();
  await page.goto(bootstrap.variantUrl);

  await page.getByText("Actions & automation", { exact: true }).click();
  await page.getByRole("button", { name: "Copy from variant" }).click();
  const copyDialog = page.getByRole("dialog").filter({ hasText: "Copy variant configuration" });
  await expect(copyDialog).toBeVisible();
  await expect(copyDialog.getByRole("button", { name: "Copy configuration" })).toBeDisabled();

  await copyDialog.getByRole("button", { name: "Choose source" }).click();
  await page.getByPlaceholder("Search configured variants").fill("Source");
  await page.getByRole("radio", { name: /Playwright Test Product - Playwright Source Variant/ }).check();
  await page.getByRole("button", { name: "Add selected" }).click();
  await expect(copyDialog.getByText("Production template: Playwright Production Template")).toBeVisible();
  await copyDialog.getByRole("button", { name: "Copy configuration" }).click();

  await expect(page.getByText("Variant configuration copied.")).toBeVisible();
  await expect(page.locator("p").filter({ hasText: "Playwright Production Template" })).toBeVisible();
  await expect(page.locator("s-badge").filter({ hasText: "Override" })).toBeVisible();
  await expect(page.getByText("Playwright Shipping Template", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Minutes per variant")).toHaveValue("17");
  await expect(page.getByLabel("Hourly rate ($)")).toHaveValue("18.5");
  await expect(page.getByLabel("Mistake buffer (%)")).toHaveValue("7.50");
  await expect(page.getByRole("paragraph").filter({ hasText: "Playwright Yield Material" })).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "Playwright Heat Press" })).toBeVisible();
  await expect(page.getByText("Cost per item: $3.20", { exact: true })).toBeVisible();
  await expect(page.getByText("Cost per item: $1.05", { exact: true })).toBeVisible();

  await page.reload();

  await expect(page.getByLabel("Minutes per variant")).toHaveValue("17");
  await expect(page.getByRole("paragraph").filter({ hasText: "Playwright Heat Press" })).toBeVisible();
});
