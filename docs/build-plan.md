# Phased Build Plan — Shopify Donation Manager

Use this document for sequencing, dependencies, phase boundaries, and exit criteria.

This is the authoritative delivery roadmap. It explains when work should happen and what must be true before the next phase begins.

**Version:** 1.2
**Date:** March 2026  
**Developer:** Solo  
**Phase definition:** Each phase ends when all work in that phase is complete, tested, and verifiable on a development store. No phase begins until the previous phase passes its exit criteria.

**v1.2 — March 2026:** §1.3 — replaced `RecalculationRun` with `DeletionJob` as the fourth Phase 1 schema table. RecalculationRun has no Phase 1 role (removed via BE-1 panel flag). DeletionJob is required in Phase 1 to support the uninstall/reinstall lifecycle. See Phase 1 foundation spec v1.1 §3.4.


---

## Pre-build actions (before Phase 1 starts)

These must be in flight or resolved before development begins. They are not code tasks.

| Action | Why it can't wait | Owner |
| --- | --- | --- |
| Create Shopify Partner account and development store | Required for all local development and testing from day one | Project owner |
| Register app in Partner Dashboard, obtain API credentials | Required before any OAuth or webhook work can begin | Project owner |
| Select and configure transactional email provider (Postmark, SendGrid, or Resend) | Required for post-purchase email in Phase 5. Early selection avoids a late dependency. | Project owner |
| Select app name for App Store listing | The name 'Shopify Donation Manager' cannot be used. Must be resolved before any public-facing branding is created. | Project owner |

---

## Phase 1 — Foundation

**Goal:** A working Shopify app shell with OAuth, database, core schema, and webhook infrastructure in place. Nothing financial yet — just the plumbing that everything else depends on.

**Exit criteria:** App installs on dev store, OAuth completes, database migrates cleanly, webhooks receive and verify payloads, merchant is redirected to dashboard on install.

### 1.1 App scaffolding
- Initialise project with Shopify CLI using React Router template
- Configure `shopify.app.toml`: app URL, scopes, webhook subscriptions (all topics from PRD §13.5), compliance webhooks
- Set up Node.js runtime, Prisma ORM, PostgreSQL (Docker locally, managed cloud for staging)
- Configure environment variables: Shopify API credentials, database URL, app secret
- Set up security headers middleware: CSP `frame-ancestors`, HSTS, `X-Content-Type-Options` (PRD §14.2)

### 1.2 OAuth and session management
- Implement OAuth install flow with App Bridge 3
- Session token validation middleware on all admin routes
- Multi-tenant shopId enforcement on all DB queries — no cross-shop access possible
- Uninstall webhook handler: delete metafields/metaobjects immediately, schedule DB deletion within 48 hours
- Reinstall within deletion window: cancel deletion job, restore existing data

### 1.3 Core schema — Phase 1 tables
Deploy initial Prisma migration with the following tables only:

- `Shop` — shopId, shopify_domain, plan_tier, wizard_step, created_at, updated_at
- `WizardState` — step persistence
- `AuditLog` — all financial mutations logged from the start
- `DeletionJob` — tracks scheduled 48hr data deletion after uninstall; allows reinstall within window to cancel deletion

> **Note:** Snapshot tables, library tables, and reporting tables are added in their respective phases. Do not create them here — premature schema means premature migrations.

### 1.4 Webhook infrastructure
- HMAC-SHA256 verification middleware — all webhooks rejected with 401 if unverified
- Async processing pattern: return 2xx immediately, process in background
- `orders/create` handler stub — verified, queued, logged, no processing yet
- `app/uninstalled` handler — functional (data deletion)
- GDPR compliance webhooks: `customers/data_request`, `customers/redact`, `shop/redact` — all return 200 immediately with correct async handling

### 1.5 Admin shell
- Shopify Polaris layout with two-level grouped navigation (Cost Config, Donation Setup, Finance, Operations)
- Dashboard page with empty state — no blank pages for new installs
- React error boundaries on all major page components
- Empty states for all pages (no data yet — they'll fill in later phases)
- App Settings page shell — fields will be populated in later phases
- Wizard launch gating stub: wizard must not launch until products and variants are synced via `CatalogSync`. In Phase 1, `CatalogSync` does not exist yet — add a `catalog_synced` flag to `Shop` that defaults to false. Wizard launch logic checks this flag. `CatalogSync` (Phase 2) will set it to true on completion. This prevents the Phase 2 wizard from requiring a rework of the install flow.

**Accessibility — Phase 1 checklist (verify before Phase 2):**
- App renders correctly inside Shopify admin iframe with no console errors
- Navigation: keyboard accessible, current page indicated to screen readers
- Dashboard empty state: semantic heading structure, no colour-only indicators
- Error boundary fallback states: readable and keyboard accessible

### 1.6 Shopify plan detection
- Auto-detect merchant's Shopify plan via Admin API (GraphQL)
- Store payment processing rate in `Shop`
- Daily re-detection job (`PlanDetectionService`)
- Manual override available in Settings

**Tests to pass before Phase 2:**
- Install → uninstall → reinstall flow on dev store works correctly in all three scenarios (Section 3.6)
- Webhook HMAC verification rejects tampered payloads
- GDPR compliance webhooks respond correctly
- Security headers present on all admin responses
- No cross-shop data access possible (verified by test)
- All admin pages show empty states, no blank screens

---

## Phase 2 — Cost model

**Goal:** A merchant can define materials, equipment, and cost templates, assign them to variants, and see a live cost preview. `CostEngine` is complete in both snapshot and preview modes. No orders yet.

**Exit criteria:** Merchant can configure full cost structure for all variant types (yield-based, uses-based, POD, labor). Live cost preview shows correct figures. `CostEngine` unit tests cover all edge cases from ADR-003.

### 2.1 Schema — cost model tables
Deploy Prisma migration:

- `MaterialLibraryItem` — all fields per PRD §12.1 including `costing_model` ENUM, `total_uses_per_unit`
- `EquipmentLibraryItem`
- `CostTemplate`, `CostTemplateMaterialLine`, `CostTemplateEquipmentLine`
- `Product`, `Variant` — synced from Shopify
- `VariantCostConfig`, `VariantMaterialLine`, `VariantEquipmentLine`
- `VariantCostSummary` — materialised count view for widget threshold query (ADR-004)

> **Note (Security Engineer):** `VariantCostSummary` count maintenance must be implemented in this phase alongside the line tables. The `line_item_count` must be incremented/decremented on every insert/delete of `VariantMaterialLine` and `VariantEquipmentLine` records. If this maintenance logic is deferred to Phase 5, the widget threshold query will return stale counts.

### 2.2 CatalogSync
- Cursor-based product/variant sync via GraphQL Admin API
- `CatalogSync` service: initial full sync on install, incremental on `products/update` and `variants/update` webhooks
- Bulk Operations API for large catalogs

### 2.3 Material Library
- Material Library page: list, create, edit, soft-delete
- Yield-based and uses-based costing models — adaptive form inputs
- Live per-unit cost preview as merchant types (purchase_price ÷ purchase_quantity)
- 'Used by X templates, Y variants' indicator before deactivation
- Deactivated items hidden from new config but preserved for existing references

### 2.4 Equipment Library
- Equipment Library page: list, create, edit, soft-delete
- Hourly rate, per-use cost, or both — at least one required
- 'Used by X templates, Y variants' indicator

### 2.5 Cost Templates
- Cost Templates page: list, create, edit, soft-delete
- Add material lines (yield-based and uses-based), equipment lines, shipping material lines
- Adaptive inputs per costing model
- 'Used by X variants' indicator

### 2.6 Variant Cost Configuration
- Variant Costs page: assign template or configure from scratch per variant
- Per-variant overrides: yield, quantity, uses_per_variant, minutes, uses
- Labor: minutes + hourly rate (blended rate, v1)
- Adaptive inputs based on material costing model and equipment fields set
- Mistake Buffer applied to production materials only (global % from Settings)

### 2.7 Bulk cost management
- Bulk template assignment to variants, products, and collections
- Warning when overwriting existing configs
- Bulk table editor (IndexTable): inline editing of yield, quantity, uses_per_variant, minutes, uses
- Keyboard navigation: Tab, Enter, Escape per PRD §5.7

> **Note (Front-end Developer):** Inline cell editing is not a native Polaris `IndexTable` pattern — it requires custom implementation within table cells. This is the most frontend-complex component in Phase 2. Budget time accordingly; do not underestimate.

**Accessibility — Phase 2 checklist (verify before Phase 3):**
- Bulk table editor: Tab/Enter/Escape keyboard navigation functional
- All library and template forms: labels, error messages, and live cost previews accessible to screen readers
- Deactivation confirmation dialogs: focus managed correctly, keyboard dismissible
- All admin pages: no colour-only indicators, sufficient contrast

### 2.8 CostEngine — core
Implement `CostEngine` as a pure function (no DB writes, no internal state):

- Resolution steps 1–3 and 5–7 from ADR-003 (variant config, template, library items, packaging rule, mistake buffer)
- Both output modes: full cost structure (snapshot mode) and display-safe projection (preview mode)
- Display-safe projection must never include net_contribution, margins, or purchase prices
- Edge cases: zero-cost variant, deactivated library item, template deactivated, variant with both template and overrides

### 2.9 POD provider connections
- `ProviderConnection` and `ProviderVariantMapping` schema
- Printful OAuth connection flow
- Printify API key connection flow
- Auto-match variants by SKU on connection
- Manual mapping UI for unmatched variants
- `PODSyncService`: daily sync to `ProviderCostCache`
- Manual refresh from Provider Connections page
- Add POD cost resolution to `CostEngine` (step 4 — preview mode uses cache, snapshot mode uses live API — see ADR-003)

**Tests to pass before Phase 3:**
- `CostEngine` unit tests: all edge cases from ADR-003 edge case table
- Yield-based formula: (purchase_price ÷ purchase_qty ÷ yield) × quantity
- Uses-based formula: (purchase_price ÷ purchase_qty ÷ total_uses_per_unit) × uses_per_variant
- Equipment formula: (hourly × minutes) + (per_use × uses)
- Packaging rule: max shipping material cost across shippable variants
- Mistake buffer applies to production materials only, not shipping/equipment/labor/POD
- Display-safe projection verified: net_contribution never exposed in preview output
- Bulk table editor keyboard navigation works correctly
- POD connection, sync, and fallback behaviour verified on dev store

---

## Phase 3 — Causes, snapshot system, and business expenses

**Goal:** Merchants can assign causes to products. Orders create immutable snapshots with full line-item detail. Business Expenses page is available to support surplus absorption testing. This is the most critical phase for financial correctness — test coverage here is non-negotiable.

**Exit criteria:** Place a test order on dev store. Snapshot is created atomically with all child tables populated correctly. All figures match manual calculation. Surplus absorption verified across all three scenarios using Business Expenses to seed deduction pool state. Refund creates correct negative adjustment.

### 3.1 Schema — causes, snapshot, and expense tables
Deploy Prisma migration:

- `Cause` metaobject definition created on install via GraphQL
- `OrderSnapshot`, `OrderSnapshotLine`
- `OrderSnapshotMaterialLine`, `OrderSnapshotEquipmentLine`, `OrderSnapshotPODLine` (ADR-001)
- `LineCauseAllocation`
- `Adjustment`
- `BusinessExpense` — moved from Phase 4 to support surplus absorption testing
- `TaxOffsetCache` — required by `SnapshotService` to read live `taxable_exposure`

### 3.2 Cause management
- Causes page: create, edit, soft-deactivate
- Metaobject storage via GraphQL: name, legal_nonprofit_name, is_501c3, description, icon, donation_link, website_url, instagram_url, status
- Deactivation blocked if cause assigned to active products — show affected product list
- Reactivation available at any time

### 3.3 Product cause assignment
- Product Donations page: assign causes and donation percentages at product level
- Stored as Shopify product metafields (donation_manager namespace)
- Hard error if cause percentages exceed 100%
- Products with no causes assigned donate 0% — valid, no error

### 3.4 SnapshotService
Implement `SnapshotService` following ADR-001 and ADR-003 critical ordering rules:

1. Fetch POD costs from provider API (outside transaction)
2. Open database transaction
3. Call `CostEngine` (full cost structure, snapshot mode)
4. Write `OrderSnapshotLine` and all three child tables atomically
5. Write `LineCauseAllocation` records
6. Commit transaction — snapshot only considered created on commit

- Idempotent: no action if snapshot already exists for this order ID
- At snapshot creation, read live `taxable_exposure` from DB (not hourly cache) for per-order tax reserve calculation
- Surplus absorption logic: surplus_before_order, taxable_portion, estimated_tax_reserve
- Snapshot flags: `pod_cost_estimated`, `pod_cost_missing`
- Cause assignment priority: manual override > tag > category > product default
- Origin flag: webhook vs reconciliation

> **Note (Back-end Developer):** In Phase 3, `taxable_exposure` will always be read as 0 (or produce a missing `TaxOffsetCache` record) until Business Expenses entries exist. `SnapshotService` must handle a missing `TaxOffsetCache` record gracefully — treat it as `taxable_exposure = 0`, which means `per_order_tax_reserve = 0`. This is correct behaviour in Phase 3 and is not a bug. The surplus absorption test cases require Business Expenses entries to be seeded first (see Phase 3.4a below).

### 3.4a Business Expenses page (moved from Phase 4)
Minimal implementation to support surplus absorption testing:

- `BusinessExpense` schema deployed in Phase 3.1
- Business Expenses page: create and list entries per period (category, sub-type, name, amount, date, notes)
- Inventory & Materials category with material_purchase and cogs_adjustment sub-types
- Cash-basis assumption note and tax disclaimer displayed on page
- `deduction_pool` computed from `BusinessExpense` entries + 501(c)3 cause allocations
- `taxable_exposure` = cumulative_net_contribution - deduction_pool (written to `TaxOffsetCache`)
- Running total of expenses and resulting tax reserve impact shown live

> This is a minimal functional implementation sufficient for testing. The full `ReportingService` hourly job and the complete reporting dashboard integration remain in Phase 4.

### 3.5 Order webhook handlers
- `orders/create`: invoke `SnapshotService`, retry 3x with backoff, queue for reconciliation on failure
- `orders/updated`: adjustment if subtotal or line items changed (ignore tags, notes, fulfillment)
- `refunds/create`: negative adjustment via `AdjustmentService`, proportional to refunded quantity

### 3.6 AdjustmentService
- Append-only adjustment records
- Partial refund: adjustment proportional to refunded quantity vs original
- Cause balances may go negative — expected, preserved for accuracy
- All adjustments audit-logged

### 3.7 Daily reconciliation
- `ReconciliationService`: daily cron, PostgreSQL advisory lock
- Queries Shopify Orders API for orders in the last 7 days, backfills any missing snapshots
- 7-day lookback is sufficient to catch any realistic webhook delivery failure — see ADR-006
- Requires only `read_orders` scope — no `read_all_orders` needed
- Reconciliation snapshots flagged with `origin` enum
- Restartable if interrupted (checkpoint state tracked)

### 3.8 Order History page
- List of all snapshots with origin flag, POD flags, period assignment
- Filter by reconciliation-originated
- Drill-down to snapshot detail: all four category totals, cause allocations, tax reserve breakdown

### 3.9 Bulk migration on install

Removed. See ADR-006.

Historical order import was removed because pre-install orders have no cost configuration or cause assignments, making any retroactive snapshots inaccurate. Count On Us begins tracking from the point of installation and configuration. The onboarding wizard communicates this clearly to merchants.

**Accessibility — Phase 3 checklist (verify before Phase 4):**
- Cause management: deactivation modal focus managed, affected product list accessible
- Product Donations page: percentage inputs labelled, validation errors announced to screen readers
- Order History page: table semantic markup, filter controls keyboard accessible
- Business Expenses page: form inputs labelled, running total announced on change

**Tests to pass before Phase 4:**
- Place test order: snapshot created with all child tables populated atomically
- Verify OrderSnapshotMaterialLine: all cost fields match library values at order time
- Verify OrderSnapshotEquipmentLine: all rate fields correct
- Verify OrderSnapshotPODLine: each provider cost line stored individually
- Verify four category totals on OrderSnapshotLine match sum of detail table line_cost values
- POD fetch failure: fallback to cache, snapshot flagged correctly
- Idempotency: duplicate webhook does not create duplicate snapshot
- Partial refund: adjustment amounts proportional, cause balances update correctly
- Reconciliation job: creates missing snapshots, skips existing, advisory lock prevents concurrent runs
- Missing TaxOffsetCache: SnapshotService handles gracefully, per_order_tax_reserve = $0 (correct behaviour)
- Surplus absorption — test data setup: seed BusinessExpense entries to create known deduction_pool, then place orders to verify:
  - Surplus fully covers order (surplus_before_order ≥ order_net_contribution): per_order_tax_reserve = $0
  - Surplus partially covers order (0 < surplus_before_order < order_net_contribution): tax reserve on exposed portion only
  - No surplus (taxable_exposure ≥ 0): full net contribution taxed at effective_tax_rate × taxable_weight

---

## Phase 4 — Reporting and tax estimation

**Goal:** Merchant can view reporting periods, see the full donation pool and tax reserve dashboard, close periods, log disbursements, and run tax true-ups. Business Expenses was built in Phase 3 — this phase completes the full reporting layer on top of it.

**Exit criteria:** A full reporting period cycle works end-to-end on dev store: open period → orders arrive → expenses logged → period closes → disbursements logged → tax reserve calculated correctly → export produces correct CSV and PDF.

### 4.1 Schema — reporting tables
Deploy Prisma migration:

- `ReportingPeriod`
- `CauseAllocation` — live when OPEN, materialised at CLOSE
- `Disbursement`
- `TaxTrueUp`
- `ShopifyChargeTransaction`

> **Note:** `BusinessExpense` and `TaxOffsetCache` were added in Phase 3. Do not re-migrate them here.

### 4.2 Shopify Charges Sync
- `ChargeSyncService`: import balance transactions on `payouts/create` webhook and daily job
- GraphQL query: `shopifyPaymentsAccount { balanceTransactions }` with `payments_transfer_id` filter (confirmed feasible — see ADR feasibility §1)
- Deduplication by `shopify_transaction_id`
- `shopify_charges` deducted from donation pool

### 4.3 Reporting periods
- Anchored to Shopify payout cycles via `payouts/create` webhook
- Period states: OPEN → CLOSING → CLOSED
- Period close: materialise `CauseAllocation`, lock all related records
- Monthly, campaign, and custom date range views

### 4.4 Summary dashboard
- Per-cause allocation amounts (live when OPEN)
- Disbursed vs pending per cause
- Tax reserve summary: taxable base, rate, mode, expenses deducted
- Shopify charges deducted for the period
- Track 1 and Track 2 figures in strictly separate dashboard sections (ADR-002 enforcement)

### 4.5 ReportingService — full tax offset cache
Complete `ReportingService` hourly job (stub started in Phase 3):

- Compute full `deduction_pool`: cumulative 501(c)3 allocations + all `BusinessExpense` entries
- Compute `taxable_exposure` = cumulative_net_contribution - deduction_pool
- Compute `widget_tax_suppressed = (taxable_exposure <= 0)`
- Write to `TaxOffsetCache` — widget reads from here (up to 1 hour stale)
- `taxable_exposure` unbounded — correctly handles negative values (surplus)

### 4.6 Disbursement logging
- Multiple partial disbursements per cause per period
- Receipt upload: S3 storage, presigned URLs (1hr expiry), PII warning at upload
- Cumulative disbursed vs remaining tracked

### 4.7 Tax true-up
- Per-period form after tax filing
- Records actual tax paid vs estimated reserve
- Surplus: merchant specifies redistribution across causes
- Shortfall: deducted from donation pool
- All scenarios audit-logged in `TaxTrueUp`

### 4.8 Recalculation delta view
- Merchant triggers 'Run recalculation' — async, notified on completion
- Shows per-period and per-cause delta: snapshot values vs recalculated values
- Analytical only — does not affect authoritative figures
- Clearly labelled as analytical in the UI

### 4.9 Export
- CSV and PDF export for reporting periods
- Includes: cause allocations, disbursements, tax reserve breakdown, Shopify charges

**Accessibility — Phase 4 checklist (verify before Phase 5):**
- Reporting period dashboard: Track 1 and Track 2 sections differentiated by headings, not colour alone
- Period close confirmation: focus managed, keyboard accessible
- Disbursement logging form: all fields labelled, receipt upload accessible
- Tax true-up form: redistribution inputs labelled, totals announced on change
- Export buttons: accessible names and loading states

**Tests to pass before Phase 5:**
- Full period lifecycle: OPEN → orders → expenses → CLOSED → disbursements
- Track 1 and Track 2 figures never appear in the same calculation
- Business expense entries reduce taxable_exposure but not donation pool
- TaxOffsetCache refreshes hourly; widget_tax_suppressed correct in all surplus scenarios
- Tax true-up: surplus redistribution and shortfall deduction both correct
- Shopify charges synced correctly via payments_transfer_id filter pattern
- Period close materialises CauseAllocation and prevents edits
- Recalculation delta is analytical only — authoritative figures unchanged

---

## Phase 5 — Storefront display

**Goal:** Customers can see a full cost and donation breakdown on the product page. The Thank You page shows confirmed donation amounts. The post-purchase email is sent. The donation receipts page is live.

**Exit criteria:** Complete customer journey on dev store: product page widget shows correct costs and causes → customer places order → Thank You page shows estimated then confirmed amounts → post-purchase email received → donation receipts page shows disbursements.

### 5.1 Schema — widget support
- `VariantCostSummary` view operational (materialised count per variant, maintained on insert/delete of material/equipment lines)

### 5.2 Storefront widget endpoint
- App server endpoint: accepts product ID and shop context, returns display-safe cost payload
- Threshold query: `SELECT SUM(line_item_count) FROM variant_cost_summary WHERE product_id = ?`
- Pre-load path (< 200 line items): resolve all variants at render time, embed as JSON in Theme App Extension output
- Lazy-load path (≥ 200 line items): return empty response at render time; resolve on fetch request from widget
- Display-safe projection enforced — no net contribution, no margins, no purchase prices
- Rate-limited per shop

### 5.3 Theme App Extension — storefront widget
- App Block with JavaScript rendering (not Liquid — avoids 25-settings limit)
- Reads pre-loaded JSON or fetches from endpoint depending on delivery mode
- Section order: Causes → Cost Breakdown → Shopify Fees → Estimated tax reserve
- Variant change: update in place from in-memory data, no network request
- Quantity change: client-side multiplication of unit costs, shipping materials excluded from scaling
- Tax reserve shown only when: rate > 0%, mode ≠ 'don't deduct', widget_tax_suppressed = false
- Managed Markets fee: shown for international customers via Storefront Localization API, falls back to currency mismatch
- Cause donation amounts in customer's currency via Shopify Storefront API MoneyV2
- Visibility: hidden entirely for products with no cause assignments
- WCAG 2.1 AA: aria-label on toggle, aria-expanded, aria-live for variant changes, semantic table for cost breakdown
- `shopify.extension.toml`: `network_access = true`, `allowed_urls` set, CORS headers on app server

### 5.4 Cart summary modal
- 'See your donation impact' button near cart
- Modal: per-cause donation totals across all cart items
- Focus trapped in modal, returns to trigger on close
- Accessible name via aria-label

### 5.5 Checkout UI Extension — Thank You page
- Register in `shopify.app.toml` with `ui_extension` type
- `purchase.thank-you.block.render` target: poll for confirmed snapshot (3s interval, 30s max)
- Show estimated amounts while polling, replace with confirmed on snapshot arrival
- `customer-account.order-status.block.render` target: recovery path for revisiting customers
- Both targets exported from same extension entry point
- Fail silently if app server unavailable — Thank You page unaffected
- Hidden entirely for orders with no donation products

### 5.6 Post-purchase donation email
- `EmailService`: triggered by `orders/create` webhook after snapshot creation
- Per-cause amounts, icons, donation links, store branding
- Link to `/apps/donation-receipts`
- Respects merchant opt-in setting (default enabled)
- Customer email from `contact_email` field in webhook payload — no `read_customers` scope needed

### 5.7 App Proxy — donation receipts page
- Configure App Proxy in `shopify.app.toml` with `write_app_proxy` scope
- HMAC-SHA256 verification — unsigned requests rejected 403
- Public page: closed periods in reverse chronological order, disbursements, receipt links
- Presigned S3 URLs refreshed on page load (1hr expiry)
- Rate limiting: IP-based (no cookies — App Proxy strips Cookie header, per ADR-004 feasibility §3)
- Accessible: semantic headings, skip navigation, accessible disbursement table

### 5.8 Setup wizard
- Seven-step first-run wizard (PRD §3.2)
- State persists to DB — merchant resumes from last completed step on browser close
- Accessible progress indicator (aria-label, role='progressbar')
- All steps skippable
- Post-wizard checklist: persistent banner until all steps complete

**Tests to pass before Phase 6:**
- Pre-load path: widget renders with embedded JSON, no network requests on variant/quantity change
- Lazy-load path: widget shows loading state on first open, caches result for subsequent variant switches
- Display-safe projection: net_contribution absent from widget payload (verified by inspection)
- Tax reserve shown/hidden correctly based on widget_tax_suppressed flag
- Thank You page: estimated amounts shown on mount, replaced by confirmed amounts after snapshot arrives
- Thank You page: 'Estimated — we'll confirm this shortly' shown if snapshot not available within 30 seconds
- Post-purchase email: sent after snapshot creation, contains correct per-cause amounts
- App Proxy: HMAC verification rejects unsigned requests
- Widget accessibility: keyboard navigation, aria attributes, screen reader announcements verified
- Wizard: state persists across browser close/reopen

---

## Phase 6 — App Store preparation

**Goal:** The app passes all pre-submission technical gates, the demo store is ready for App Store review, and the App Store listing is complete.

**Exit criteria:** All items in PRD §11.8 pre-submission checklist passed. Demo store operational. Listing submitted.

### 6.1 Pre-submission technical audit
Work through every item in PRD §11.8:

- Built for Shopify standards compliance
- All three GDPR compliance webhooks verified end-to-end
- Security headers on all responses (verified with browser dev tools and security header scanner)
- Install → uninstall → reinstall tested on clean dev store in all three scenarios
- All admin pages have empty states
- React error boundaries tested by deliberately triggering errors
- Widget tested on Dawn and two other OS2.0 themes
- App listing discloses OS2.0 requirement and Checkout Extensibility requirement
- Privacy policy URL live and publicly accessible
- DPA available on request

### 6.2 QA pass against PRD §18 checklist
Full systematic pass through every item in the QA checklist (PRD §18). No item skipped. Any failures fixed before proceeding.

### 6.3 Demo store setup
- At least one cause configured with 501(c)3 status
- At least one product with full cost config and cause assignment
- Storefront widget visible and functional
- Sample reporting period with closed status and disbursements logged
- POD provider connected if reviewers will test Printful/Printify

### 6.4 App Store listing
- App name confirmed (not 'Shopify Donation Manager')
- Category: Finance / Reporting
- Minimum 3 screenshots: cost configuration, donation reporting, storefront widget
- Key benefits: 3 concise bullet points
- Detailed description matching actual functionality exactly
- Support contact and response commitment

### 6.5 Final full panel review
Convene all seven personas for pre-submission review before listing is submitted. All 🚩 flags resolved before submission proceeds.

---

## Dependency map

```
Pre-build actions
  └── Phase 1 (Foundation)
        └── Phase 2 (Cost model)
              └── Phase 3 (Causes + Snapshot system)  ← most critical for correctness
                    └── Phase 4 (Reporting + Tax estimation)
                          └── Phase 5 (Storefront display)
                                └── Phase 6 (App Store preparation)
```

No phase can begin until the previous phase passes its exit criteria.

---

## Open decisions to resolve before Phase 1

These are not blocking Phase 1 immediately but must be resolved before the phase they affect:

| Decision | Needed by | Notes |
| --- | --- | --- |
| App name selection | Phase 6 (listing), but branding decisions affect earlier phases | Must not contain 'Shopify'. Consider GiveTrack, CauseCount, or similar. |
| Transactional email provider | Phase 5 | Postmark, SendGrid, or Resend. Select early to avoid late dependency. |
| Cloud provider for S3-compatible storage | Phase 4 | AWS S3 (US-East) recommended. Must be EU-US DPF certified. |
| Privacy policy and DPA drafting | Phase 6, but legal review takes time | Start legal review early — don't leave for the week before submission. |
| Staging environment | Phase 2 | Needed before any real webhook testing. Define hosting provider and deployment pipeline. |
