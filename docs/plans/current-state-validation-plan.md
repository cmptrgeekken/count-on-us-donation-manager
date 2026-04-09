# Current-State Validation Plan

This checklist is the practical validation pass for the app as it exists today.
It is meant to be run against the current `main` behavior, not the aspirational PRD.

## Automated Baseline

Run these first:

```powershell
npx prisma migrate dev --skip-generate
npx tsc --noEmit
npm run lint
npm test
npm run test:ui
```

Expected current result:
- TypeScript passes
- ESLint passes
- Vitest passes
- Playwright passes

## Admin App Navigation

- Open the embedded app from Shopify Admin.
- Use the sidebar nav to visit:
  - Dashboard
  - Settings
  - Materials
  - Equipment
  - Cost Templates
  - Variants
  - Causes
  - Products
  - Reporting
  - Expenses
  - Audit Log
  - Provider Connections
  - Order History
- Confirm internal links stay inside the embedded app and do not bounce to login.

## Dashboard And Setup Wizard

- Open Dashboard with a synced shop.
- Confirm the setup wizard renders when setup is incomplete.
- Confirm these real derived steps advance automatically when configured:
  - first cause
  - Shopify Payments fee rate
  - Managed Markets enable date
  - material/equipment libraries
  - cost template
  - variant costs
  - product cause assignment
- Confirm these manual steps are still manual:
  - POD provider review
  - storefront widget enablement
- Confirm skip/resume works.
- Confirm the checklist persists incomplete/skipped items.

## Settings

### Shopify Payments

- Verify current plan and payment rate display.
- Enable manual override, save a payment rate, refresh, and confirm it persists.
- Remove the override and confirm the status copy updates.
- Save a Managed Markets enable date.
- Clear the Managed Markets enable date and confirm the success message.

### Cost Defaults

- Save mistake buffer and default labor rate.
- Refresh and confirm both persist.
- Try invalid values:
  - negative labor rate
  - mistake buffer over 100

### Tax Estimation

- Save effective tax rate and deduction mode.
- Use each preset once and confirm the input updates.
- Confirm the IRS link opens externally.

### Donation Email

- Enable and disable the post-purchase donation email toggle.
- Confirm success messages and persistence.

### Audit Log Link

- Use the Settings link to open Audit Log.
- Confirm it does not redirect to login.

## Libraries And Cost Model

### Materials

- Create, edit, deactivate, reactivate, and delete an unused material.
- Confirm Production and Shipping sections render separately.
- Save purchase link and weight metadata.

### Equipment

- Create, edit, deactivate, reactivate, and delete unused equipment.
- Save purchase link and equipment cost metadata.

### Templates

- Create Production and Shipping templates.
- Confirm the material picker only shows materials matching template type.
- Set a default Shipping template on a Production template.

### Variants

- Assign production and shipping templates.
- Confirm searchable add pickers for extra material/equipment lines.
- Confirm duplicate suppression in add dialogs.
- Confirm shipping additional lines are shown separately.

## Causes And Product Donations

- Create causes, including one with a public donation URL.
- Deactivate/reactivate/delete unused causes.
- Assign causes to products.
- Confirm product cause totals cannot exceed 100%.

## Reporting

### Reporting Periods

- Open Reporting.
- Confirm track summaries render.
- Close an open period.

### Disbursements

- Log a disbursement with:
  - allocated amount
  - extra contribution
  - fees covered
- Attach a receipt and confirm the receipt link works.
- Confirm allocated amount reduces payable balance while extra contribution and fees covered do not.
- Confirm prior-period payables appear in Outstanding Cause Payables.

### Tax True-Up

- Record a surplus true-up.
- Confirm current period summaries reflect carry-forward behavior.

### Analytical Recalculation

- Run analytical recalculation.
- Confirm the delta view is read-only and renders without error.

### Exports

- Download CSV and PDF exports from Reporting.
- Confirm CSV is tabular and PDF content is not clipped.

## Expenses And Order History

- Create and delete an expense.
- Use Order History filters.
- Create a manual adjustment on an order snapshot.

## Storefront And Public Surfaces

### Product Page Theme Block

- In Theme Editor, add the product donation widget block to a product template.
- Confirm it renders on the storefront and shows donation impact.

### Cart Page Theme Block

- Add the cart donation summary block to a cart template.
- Confirm the modal opens and closes cleanly.
- Confirm focus returns to the trigger.

### Public Donation Receipts

- Visit the public donation receipts page through the app proxy.
- Confirm closed periods and receipt links render.

### Thank You / Order Status

- Use the preview or a test order flow to confirm:
  - estimated state renders before confirmation
  - confirmed state replaces it when snapshot data is available
  - hidden state is used when app data is unavailable

## Known Current Limitations To Keep In Mind

- Provider Connections is still a placeholder page.
- POD/provider cost resolution is still stubbed at zero.
- The theme extension currently ships app blocks, not a true app embed.
- Managed Markets fee behavior is not yet storefront-aware.
