# Remaining Issue Review Log

This document tracks the multi-issue implementation pass after the Phase 4 reporting core landed.
Each section is meant to give a compact review summary, automated/manual test focus, and any follow-up questions.

## Working Order

1. `#69` Standardize admin auth helper usage across app routes
2. `#70` Standardize Decimal parsing for monetary form inputs
3. `#52` Add audit log browsing UI
4. `#50` Add analytical recalculation delta view
5. `#53` Build storefront widget data endpoint and display-safe projection
6. `#54` Build product page Theme App Extension donation widget
7. `#64` Add cart donation summary modal
8. `#57` Add app proxy donation receipts page
9. `#55` Add Thank You and Order Status donation extension
10. `#56` Add post-purchase donation email
11. `#58` Build first-run setup wizard and persistent setup checklist
12. Remaining issues to follow in priority order after the reporting/storefront foundation tranche

## Issue `#69` Review Notes

### Summary

- Replace remaining `/app/*` route uses of `authenticate.admin(...)` with `authenticateAdminRequest(...)`.
- Keep Shopify admin access only where it is actually needed, with explicit fallback behavior for local fixture mode.

### Files

- `app/routes/app._index.tsx`
- `app/routes/app.dashboard.tsx`
- `app/routes/app.provider-connections.tsx`
- `app/routes/app.settings.tsx`
- `app/utils/admin-auth.server.test.ts`

### Test Cases For Review

#### Automated

- `admin-auth.server.test.ts`
  - local Playwright bypass returns a synthetic session and skips Shopify admin auth
  - normal requests still call through to Shopify admin auth
- full `npm test`
  - regression coverage stays green after the route auth swap

#### Manual

- Open Dashboard, Settings, and Provider Connections through the embedded admin.
- Confirm the app root still redirects to Dashboard.
- In local fixture mode, confirm Settings still loads and the refresh-currency action fails gracefully instead of crashing.

## Issue `#70` Review Notes

### Summary

- Remove the remaining money-related `parseFloat(...)` writes from Variant configuration actions.
- Standardize labor rate and mistake buffer writes onto shared Decimal-based parsing helpers.

### Files

- `app/routes/app.variants.$variantId.tsx`
- `app/utils/money-parsing.ts`
- `app/utils/money-parsing.test.ts`

### Test Cases For Review

#### Automated

- `money-parsing.test.ts`
  - optional percent parsing returns `null` for blank input
  - optional percent parsing stores rounded four-decimal rates for percent inputs
- full `npm test`
  - existing reporting, receipt, export, and parser coverage remains green after the Decimal parsing cleanup

#### Manual

- On a Variant detail page:
  - update labor minutes and labor rate
  - update mistake buffer
  - save and reload
  - confirm values persist and display correctly
- Try invalid values:
  - negative labor rate
  - mistake buffer over `100`
  - invalid numeric text
  - confirm user-facing validation remains intact

## Pending Questions

- `#45` appears functionally complete in code and tests already. It may only need issue/status cleanup unless you want an additional merchant-facing charge-sync control surface.
- `#53` currently returns donation and tax figures in shop currency, and Managed Markets fee data is still placeholder-only. We should confirm whether customer-currency conversion and storefront-aware fee applicability belong in the endpoint itself or in the Theme App Extension tranche.
- `#54` uses a pragmatic storefront preload strategy: metadata fetch first, then eager payload fetch for low-line products. We should confirm whether that is acceptable long-term, or whether we still want to revisit the original ADR language around true page-render preloading inside Theme App Extensions.

## Issue `#52` Review Notes

### Summary

- Add a merchant-facing audit log page under `/app/audit-log`.
- Link it from Settings and the embedded admin nav.
- Support reverse-chronological browsing, event-type filtering, date filtering, payload inspection, and pagination.

### Files

- `app/routes/app.audit-log.tsx`
- `app/routes/app.settings.tsx`
- `app/routes/app.tsx`
- `app/routes/ui-fixtures.audit-log-bootstrap.tsx`
- `app/utils/audit-log.ts`
- `app/utils/audit-log.test.ts`
- `tests\ui\audit-log-workflow.spec.ts`

### Test Cases For Review

#### Automated

- `audit-log.test.ts`
  - normalizes event/date filters safely
  - formats payloads and date boundaries consistently
- full `npm test`
  - regression coverage stays green with the audit helpers added

#### Manual

- Open Audit Log from Settings.
- Confirm newest events appear first.
- Filter by event type and verify rows narrow correctly.
- Filter by date range and verify rows narrow correctly.
- Open a payload block and confirm before/after details are readable.
- Navigate to the next page when more than one page of logs exists.

## Issue `#50` Review Notes

### Summary

- Add asynchronous analytical recalculation runs for reporting periods.
- Persist run status/results separately from authoritative reporting data.
- Show merchant-facing analytical-only deltas for period totals and cause allocations.

### Files

- `prisma/schema.prisma`
- `prisma/migrations/20260409030000_issue50_analytical_recalculation_runs/migration.sql`
- `app/services/analyticalRecalculation.server.ts`
- `app/services/analyticalRecalculation.server.test.ts`
- `app/jobs/processors.server.ts`
- `app/jobs/processors.server.test.ts`
- `app/routes/app.reporting.tsx`
- `app/routes/ui-fixtures.reporting-bootstrap.tsx`
- `tests/ui/reporting-workflow.spec.ts`

### Test Cases For Review

#### Automated

- `analyticalRecalculation.server.test.ts`
  - queuing creates a run and audit event
  - summary calculation produces period/cause deltas
  - analytical recalculation does not mutate snapshots, allocations, or disbursements
  - worker completion persists a completed summary
- `processors.server.test.ts`
  - reporting recalculation queue jobs invoke the analytical service
- full `npm test`
  - regression coverage remains green with the new reporting worker/service

#### Manual

- On Reporting, click `Run recalculation` for a period.
- Confirm the page clearly labels the results as analytical-only.
- While a run is pending, confirm the status banner indicates refresh/polling behavior.
- After completion, confirm period deltas and per-cause deltas are visible.
- Verify authoritative period figures elsewhere on the page do not change after the analytical run.

## Issue `#53` Review Notes

### Summary

- Add the first public storefront widget data endpoint at `/api/widget/products/:productId`.
- Reuse `CostEngine` preview mode to build display-safe per-variant payloads.
- Enforce threshold-based delivery mode (`preload` vs `lazy`) from variant line counts.
- Add public app-proxy auth plus per-shop rate limiting.

### Files

- `app/routes/api.widget.products.$productId.tsx`
- `app/routes/api.widget.products.$productId.test.ts`
- `app/services/widgetData.server.ts`
- `app/services/widgetData.server.test.ts`
- `app/utils/public-auth.server.ts`
- `app/utils/rate-limit.server.ts`
- `app/utils/rate-limit.server.test.ts`

### Test Cases For Review

#### Automated

- `widgetData.server.test.ts`
  - low-line products return `preload`
  - high-line products return `lazy`
  - payload excludes `netContribution`, purchase prices, and other admin-only fields
  - tax suppression follows `TaxOffsetCache`
- `api.widget.products.$productId.test.ts`
  - success path returns widget payloads
  - rate-limited requests return `429`
  - missing products return `404`
- `rate-limit.server.test.ts`
  - requests within the window are allowed
  - over-limit requests are blocked with retry metadata
  - usage resets after the window expires
- full `npm test`
  - regression coverage remains green with the new public widget surface added

#### Manual

- Hit `/api/widget/products/:productId` through the eventual app-proxy path for a product with active causes.
- Confirm the response includes `deliveryMode`, per-variant display lines, cause donation estimates, and tax reserve visibility data.
- Confirm the payload does not include `netContribution`, `purchasePrice`, `perUnitCost`, `laborRate`, or other admin-only fields.
- Confirm a small product resolves to `preload` and a heavily configured product resolves to `lazy`.
- Confirm products without active causes return `visible: false`.

## Issue `#54` Review Notes

### Summary

- Add the first Theme App Extension app block for the product page donation widget.
- Use app-proxy-backed metadata lookup to choose eager preload vs first-open lazy fetch.
- Render causes, cost breakdown, Shopify fee guidance, and estimated tax reserve in a customer-facing block.
- Update the widget in place when variant or quantity changes, while keeping shipping lines fixed per shipment.

### Files

- `extensions/count-on-us-product-widget/shopify.extension.toml`
- `extensions/count-on-us-product-widget/package.json`
- `extensions/count-on-us-product-widget/blocks/donation-widget.liquid`
- `extensions/count-on-us-product-widget/assets/donation-widget.js`
- `extensions/count-on-us-product-widget/assets/donation-widget.css`
- `extensions/count-on-us-product-widget/locales/en.default.json`
- `extensions/count-on-us-product-widget/locales/en.default.schema.json`
- `shopify.app.toml`
- `shopify.app.phase3.toml`
- `app/routes/api.widget.products.$productId.tsx`
- `app/routes/api.widget.products.$productId.test.ts`
- `app/services/widgetData.server.ts`
- `app/services/widgetData.server.test.ts`
- `app/utils/widget-display.ts`
- `app/utils/widget-display.test.ts`

### Test Cases For Review

#### Automated

- `widgetData.server.test.ts`
  - donation estimates now reflect production costs, Shopify payment fees, and tax reserve
  - metadata-only responses support preload vs lazy selection
- `api.widget.products.$productId.test.ts`
  - metadata-only mode returns lightweight product visibility/delivery data
- `widget-display.test.ts`
  - quantity scaling multiplies labor, materials, equipment, donation, and tax amounts
  - shipping lines remain fixed per shipment
  - selected-variant lookup falls back safely
- full `npm test`
  - regression coverage remains green with the extension-support changes layered on top

#### Manual

- Add the `Donation widget` app block to a product template in the theme editor.
- Confirm products without active causes hide the block entirely.
- Confirm the toggle opens and closes with `aria-expanded` updates.
- Confirm the widget shows:
  - causes
  - cost breakdown
  - Shopify fee guidance
  - estimated tax reserve
- Change variants and confirm the widget updates in place.
- Change quantity and confirm labor/material/equipment/donation/tax values scale while shipping lines stay fixed.
- Confirm low-line products feel loaded immediately after page load, while high-line products wait until first open.

## Issue `#64` Review Notes

### Summary

- Add a cart-page Theme App Extension block that opens a donation-impact modal for the current cart.
- Aggregate per-cause donation totals across donation products in the cart, using the existing storefront widget payloads.
- Handle empty / no-donation carts gracefully while preserving modal focus management and keyboard-close behavior.

### Files

- `extensions/count-on-us-product-widget/blocks/cart-donation-summary.liquid`
- `extensions/count-on-us-product-widget/assets/donation-widget.js`
- `extensions/count-on-us-product-widget/assets/donation-widget.css`
- `app/routes/ui-fixtures.cart-donation-summary.tsx`
- `app/utils/cart-summary.ts`
- `app/utils/cart-summary.test.ts`
- `tests/ui/cart-donation-summary-workflow.spec.ts`

### Test Cases For Review

#### Automated

- `cart-summary.test.ts`
  - aggregates per-cause totals across multiple cart lines
  - returns an empty state for carts without visible donation products
- full `npm test`
  - regression coverage remains green with the cart summary helper and fixture route added
- `cart-donation-summary-workflow.spec.ts`
  - modal opens from the cart summary trigger
  - per-cause totals render for a mixed cart
  - `Escape` closes the modal and returns focus to the trigger
  - no-donation carts show a graceful empty-state message

#### Manual

- Add the `Cart donation summary` app block to the cart template in the theme editor.
- Confirm the trigger opens a modal with `aria-haspopup="dialog"` and `aria-expanded` updates.
- Confirm the modal shows per-cause totals aggregated across cart items, not just per-product totals.
- Confirm `Escape`, overlay click, and the close button all dismiss the modal and return focus to the trigger.
- Confirm carts without donation products show a non-broken empty state.
- Confirm external cause links only render when a valid donation link exists.

## Issue `#57` Review Notes

### Summary

- Add a public app-proxy donation receipts page for closed periods with recorded disbursements.
- Verify app-proxy auth via the existing public-auth helper, apply IP-based rate limiting, and refresh signed receipt URLs on each request.
- Keep the page semantically structured with skip navigation, section headings, and accessible disbursement tables.

### Files

- `app/routes/apps.count-on-us.donation-receipts.tsx`
- `app/routes/apps.count-on-us.donation-receipts.test.tsx`
- `app/routes/ui-fixtures.donation-receipts-bootstrap.tsx`
- `app/services/donationReceiptsPage.server.ts`
- `app/services/donationReceiptsPage.server.test.ts`
- `app/utils/public-routes.ts`
- `tests/ui/donation-receipts-workflow.spec.ts`

### Test Cases For Review

#### Automated

- `donationReceiptsPage.server.test.ts`
  - returns closed periods in reverse chronological order
  - generates fresh receipt URLs for disbursements with uploaded receipts
  - returns an empty state when no closed periods have disbursements
- `apps.count-on-us.donation-receipts.test.tsx`
  - valid app-proxy requests return page data
  - invalid/failed app-proxy auth propagates as a forbidden response
  - IP-based rate limiting returns `429` after the per-minute limit is exceeded
- full `npm test`
  - regression coverage remains green with the public receipts route added
- `donation-receipts-workflow.spec.ts`
  - receipts page renders a closed period, disbursement rows, and a receipt link

#### Manual

- Open the donation receipts page through the app proxy path.
- Confirm the page shows closed periods in reverse chronological order.
- Confirm each period shows:
  - total donated
  - cause breakdown pills
  - disbursement table with amount, paid date, method, reference, and receipt link
- Confirm receipts with uploads get a working refreshed link on page load.
- Confirm shops with no disbursements show the empty state instead of a broken table.
- Confirm keyboard users can skip directly to the main receipts content.

## Issue `#55` Review Notes

### Summary

- Add a checkout-authenticated order donation summary endpoint at `GET /api/orders/:orderId/donation`.
- Return `confirmed` data from snapshots when available, or `pending` estimated amounts while waiting for snapshot creation.
- Add a first Checkout UI Extension scaffold for Thank You and Order Status surfaces, plus a local preview harness to review the expected pending/confirmed/timeout/hidden states.

### Files

- `app/routes/api.orders.$orderId.donation.tsx`
- `app/routes/api.orders.$orderId.donation.test.ts`
- `app/services/postPurchaseDonation.server.ts`
- `app/services/postPurchaseDonation.server.test.ts`
- `app/utils/checkout-auth.server.ts`
- `app/utils/checkout-auth.server.test.ts`
- `app/routes/ui-fixtures.post-purchase-donation-preview.tsx`
- `tests/ui/post-purchase-donation-preview.spec.ts`
- `extensions/count-on-us-post-purchase/shopify.extension.toml`
- `extensions/count-on-us-post-purchase/package.json`
- `extensions/count-on-us-post-purchase/src/Extension.jsx`

### Test Cases For Review

#### Automated

- `postPurchaseDonation.server.test.ts`
  - confirmed snapshot allocations aggregate by cause
  - Shopify Admin order data maps into estimate-ready payloads
  - pending estimates aggregate per-cause amounts from live order data
- `api.orders.$orderId.donation.test.ts`
  - confirmed responses return `200`
  - pending responses return `202`
  - no-donation orders return `404`
  - repeated polling is rate-limited per order
- `checkout-auth.server.test.ts`
  - local preview bypass works only in non-production local mode
  - checkout session token shop normalization works for extension requests
- full `npm test`
  - regression coverage remains green with the post-purchase endpoint and helper added
- `post-purchase-donation-preview.spec.ts`
  - estimated state transitions to confirmed
  - timeout copy remains when confirmation never arrives
  - hidden/no-data mode renders no donation panel

#### Manual

- Add the post-purchase extension to a Thank You / Order Status surface in Shopify.
- Place an order containing donation products.
- Confirm the Thank You page shows estimated amounts immediately when the snapshot is still pending.
- Confirm the extension replaces the estimate with confirmed values once the snapshot exists.
- Confirm revisiting through Order Status still shows the donation summary.
- Confirm orders without donation products hide the extension entirely.
- Confirm app-server failure leaves the Shopify surface usable and does not show a broken error block.

## Issue `#56` Review Notes

### Summary

- Add a merchant setting to enable or disable post-purchase donation summary emails.
- Add an email service and follow-up queue worker that send after successful snapshot creation, using the order `contact_email`.
- Include per-cause amounts, donation links, and the public donation receipts URL in the delivered message.

### Files

- `prisma/schema.prisma`
- `prisma/migrations/20260409093000_issue56_post_purchase_donation_email/migration.sql`
- `app/routes/app.settings.tsx`
- `app/routes/ui-fixtures.settings-email-bootstrap.tsx`
- `app/services/postPurchaseEmail.server.ts`
- `app/services/postPurchaseEmail.server.test.ts`
- `app/jobs/processors.server.ts`
- `app/jobs/processors.server.test.ts`
- `tests/ui/settings-email-workflow.spec.ts`

### Test Cases For Review

#### Automated

- `postPurchaseEmail.server.test.ts`
  - sends when enabled and a contact email is present
  - skips when the merchant disables post-purchase email
  - skips when `contact_email` is missing
  - rethrows provider failures so the worker can retry
- `processors.server.test.ts`
  - successful snapshot creation queues the post-purchase email job
  - post-purchase email failures are audit-logged and rethrown
- full `npm test`
  - regression coverage remains green with the email worker/service layered in
- `settings-email-workflow.spec.ts`
  - settings exposes the post-purchase email toggle and save flow

#### Manual

- In Settings, toggle the post-purchase donation email on and off and confirm the status message updates.
- Place a donation order with a `contact_email` present.
- Confirm the snapshot worker triggers an email job after snapshot creation.
- Confirm the delivered email includes:
  - per-cause donation amounts
  - donation links where available
  - a link to the public donation receipts page
- Disable the setting and confirm no post-purchase email is sent for subsequent donation orders.

## Issue `#58` Review Notes

### Summary

- Add a first-run setup wizard directly on the Dashboard once catalog sync is complete.
- Persist skip/manual completion state through `WizardState`, while deriving completion from real shop data wherever possible.
- Keep a persistent setup checklist visible until every step is truly complete, including previously skipped steps.

### Files

- `app/routes/app.dashboard.tsx`
- `app/routes/ui-fixtures.setup-wizard-bootstrap.tsx`
- `app/services/setupWizard.server.ts`
- `app/services/setupWizard.server.test.ts`
- `tests/ui/setup-wizard-workflow.spec.ts`

### Test Cases For Review

#### Automated

- `setupWizard.server.test.ts`
  - catalog-sync gating suppresses wizard launch until setup is meaningful
  - skipped steps advance the current wizard step while remaining on the checklist
  - manual completion steps (for example storefront widget placement) can mark as complete explicitly
  - derived steps auto-complete based on current shop data
- full `npm test`
  - regression coverage remains green with wizard helper logic added

#### Manual

- For a newly synced shop, open Dashboard and confirm the setup wizard appears above the welcome content.
- Confirm the current step advances automatically after completing real data steps:
  - create a Cause
  - add a Material or Equipment item
  - create a Cost Template
  - configure at least one Variant
  - assign at least one Cause to a Product
- Skip one or more steps and confirm:
  - the wizard advances
  - the checklist still shows the skipped steps as needing attention
- Use `Resume step` on a skipped checklist item and confirm it becomes the active wizard step again.
- Use `Mark complete` on manual steps such as Managed Markets review, Provider Connections, and storefront widget enablement.
- Confirm the Theme Editor link opens Shopify theme editing in a new tab.
