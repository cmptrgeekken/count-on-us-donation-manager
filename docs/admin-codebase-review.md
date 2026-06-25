# Admin Codebase Review

Date: June 21, 2026

This review records the current admin code and UX shape before the Reporting and Settings cleanup. It is intentionally practical: the goal is to identify repeated patterns, inconsistent page behavior, and the first consolidation steps that reduce friction without changing route URLs or historical financial behavior.

For the deeper page-by-page audit against Shopify admin app conventions, see `docs/admin-page-audit.md`.

## Current Admin Shape

The app has grown beyond a small embedded Shopify settings companion. ADR-015 already points toward workflow-oriented navigation, and the current route list confirms that direction. The highest-complexity routes are operational workflow pages rather than simple CRUD screens:

- Reporting: period selection, accounting summaries, payables, payments, exports, tax true-ups, packaging review, and recalculation diagnostics.
- Variant detail: cost template inheritance, per-variant overrides, and estimate preview.
- Causes, Products, Templates, Materials, Equipment, and Settings: mixed data management plus operational side effects.
- Settings: plan/payment assumptions, cost defaults, tax settings, localization, emails, and audit navigation.

## Route Inventory By Workflow

- Home and setup: Dashboard.
- Cost modeling: Materials, Equipment, Shipping Packages, Cost Templates, Variants, Variant detail.
- Product donation setup: Products, Product detail, Causes, Artists, Artist detail, Artist submissions.
- Provider operations: Provider Connections.
- Financial operations: Reporting, Expenses, Order History, Audit Log.
- Storefront and public surfaces: app proxy widget routes, donation receipts, transparency, artist submissions.
- System and lifecycle: Settings, webhooks, health, auth, UI fixtures.

## Consistency Findings

- Layout is mostly section-based, but pages use different local conventions for headers, actions, summaries, tables, and form spacing.
- Many routes define their own `fieldStyle`, date formatting, fetcher banners, empty table rows, and dialog structures.
- Some pages use native `s-button`, some use hand-styled `button`, and some use the local Polaris shim. This makes loading, disabled, and tone behavior inconsistent.
- Empty states appear as `s-banner`, table rows with blank cells, dashed boxes, or plain text depending on route.
- Fetcher status handling is repeated across pages, often with multiple separate success/error banner blocks.
- Several large routes combine loader data shaping, mutation handling, validation, UI state, forms, and tables in one file.
- The Shopify `ui-nav-menu` is a long flat list. ADR-015 recommends grouped workflow navigation, but that should be a separate shell project after page-level cleanup.

## Reporting Findings

Reporting is currently a complete accounting console, but its first screen does not answer the merchant's most urgent question: what needs to be paid or handled next.

The route appears to be trying to support:

- open and closed reporting-period selection
- period closing
- donation pool calculation
- cause allocation review
- cause payable tracking across periods
- artist allocation and artist payable tracking
- disbursement and artist payment logging
- tax true-up recording
- Shopify charge review
- packaging reconciliation review
- analytical recalculation diagnostics
- CSV and PDF exports

The redesign direction is to keep all capabilities on the same route, but reorder the experience:

- top: period status, outstanding cause payables, outstanding artist payables, overdue/prior-period balances, and primary next actions
- middle: payment entry flows and recent payment evidence
- lower: period math, allocation details, tax details, charges, packaging, and diagnostics

## Settings Findings

Settings is currently a single long stack of unrelated configuration groups. It is functionally useful, but it mixes operational assumptions and communication settings without an orientation layer.

The first cleanup should keep one route and add grouped in-page tabs:

- Financial: Shopify Payments rate, override controls, Managed Markets date
- Cost Defaults: mistake buffer and default labor rate
- Tax: effective tax rate, presets, deduction mode, disclaimer/help copy
- Notifications: donation email and artist submission notification email
- Localization: currency and active locale
- Advanced: audit log shortcut and future capability/data lifecycle controls

## Consolidation Candidates

Start with small shared admin primitives and migrate pages incrementally:

- standard input/select style
- fetcher success/error banner wrapper
- metric card/grid for dashboards and reporting summaries
- section header with optional actions
- in-page segmented tabs
- table empty-state helper
- modal/dialog helper for native dialog workflows

The initial shared module is `app/components/admin-ui.tsx`. Future route work should prefer these primitives over adding new local style objects.

## Prioritized Implementation Sequence

1. Add this review document and shared admin UI primitives.
2. Reorganize Settings into grouped tabs without changing action intents or route URL.
3. Add an action-oriented Reporting dashboard above the existing detail sections.
4. Move the highest-value Reporting action forms closer to the top-level payables workflow.
5. Replace repeated banner, metric, and field patterns in Products, Expenses, Order History, and Audit Log.
6. Revisit ADR-015 grouped navigation after page-level cleanup clarifies the target workflow groups.

## Acceptance Notes

- Keep `/app/reporting` and `/app/settings` URLs intact.
- Preserve existing loader/action behavior and financial math.
- Preserve Track 1 and Track 2 separation in Reporting, but make payables and next actions prominent.
- Use automated UI checks for Reporting action visibility, cause disbursement logging, artist payment logging, and Settings tab/form behavior.
