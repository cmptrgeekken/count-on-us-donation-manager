# Current Implementation Status

Use this document as the practical snapshot of what is implemented in the repo today.

This file is intentionally lightweight and operational. It should summarize reality, not restate full product requirements or phase specs.

**Project:** Count On Us  
**Date:** April 12, 2026  
**Summary:** Phase 1, Phase 2, and Phase 3 are complete. Phase 4 is functionally implemented, including reporting periods, disbursements, receipts, tax true-up, exports, audit log browsing, analytical recalculation, and rolling cause payables. Phase 5 foundations are also now present in the repo: storefront product/cart blocks, public receipts, post-purchase donation surfaces, and the setup wizard are implemented. The main product gap that still cuts across storefront, reporting, and Provider Connections is POD/provider completion: Printify credentials now validate successfully, manual sync runs now auto-match unique SKUs and cache base POD fulfillment costs, preview-mode cost resolution now consumes cached POD inputs, snapshot creation now attempts a live provider fetch before falling back to cache, Provider Connections shows token lifecycle/health, cached provider catalog variants, manual mapping for unresolved variants, and richer troubleshooting diagnostics, and the Products/Variants admin screens now expose POD mapping visibility. Current provider direction is Printify-first in the near term with Printful still planned next, and recent PRD-gap review also surfaced explicit backlog items for packing-slip donation summaries, Shopify Admin native product/variant surfaces, cause-assignment override hierarchy, and the fuller spreadsheet-style bulk editor.

---

## Current Position

- **Phase 1:** Complete
- **Phase 2:** Complete
- **Current focus:** Provider/POD completion (`#85`) plus supporting storefront, docs, and submission hardening work
- **Phase 3:** Complete

---

## Phase 1 Checklist

- [x] Shopify app shell and embedded admin wiring
- [x] OAuth and session flow
- [x] Core Phase 1 schema (`Shop`, `WizardState`, `AuditLog`, `DeletionJob`)
- [x] Post-install handling and reinstall-within-window lifecycle
- [x] Webhook HMAC verification
- [x] Job queue bootstrapping
- [x] Dashboard and Settings shell
- [x] Tenant guardrails in Prisma
- [~] Phase 1 testing expectations appear functionally covered, but not all expected automated verification is visible in the repo

---

## Phase 2 Checklist

### Core cost model

- [x] Phase 2 Prisma schema
- [x] Catalog sync service
- [x] Install-triggered catalog sync
- [x] Incremental catalog sync for product updates
- [x] Material Library CRUD UI
- [x] Equipment Library CRUD UI
- [x] Cost Templates list/detail UI
- [x] Variant list with filtering
- [x] Bulk template assignment
- [x] Variant detail configuration page
- [x] CostEngine implementation
- [x] Mistake buffer setting
- [x] Default labor rate groundwork
- [x] Currency/localization groundwork

### Hardening completed during Phase 2 exit work

- [x] Staged save/discard UX for template and variant details
- [x] Searchable picker pattern on template and variant editors
- [x] Currency and locale formatting rollout
- [x] Default labor rate rollout
- [x] Shipping-material costing behavior aligned with intended rules
- [x] Polaris Web Components migration off Shopify React dependencies
- [x] Playwright foundation plus real workflow coverage for key Phase 2 surfaces

### Deferred or intentionally incomplete

- [~] POD/provider connections
  Provider Connections now validates Printify credentials, queues sync runs, auto-matches unique SKUs, caches base provider fulfillment costs, persists provider catalog variants for review, and supports manual mapping for unresolved variants. Duplicate/missing-SKU refinement and broader provider support are still pending.
- [ ] Full inline bulk editor
- [ ] Full design revisit for large-list filtering UX

---

## Phase 2 Exit Checklist

- [x] Finish remaining Phase 2 amendment work on templates and variants
- [x] Connect localization and formatter inputs to real shop data
- [x] Verify shipping-material costing behavior matches the intended rules
- [x] Verify default labor rate fallback in cost resolution
- [x] Confirm `lineItemCount` stays correct through add/remove paths
- [x] Replace temporary React-based admin UI dependencies
- [x] Add automated tests for CostEngine regressions and critical UI workflows
- [x] Reconcile docs and code before starting Phase 3 implementation

## Phase 3 Checklist

- [x] Cause schema and metaobject sync
- [x] Product cause assignment
- [x] Snapshot schema
- [x] Snapshot service
- [x] Refund/adjustment service
- [x] Tax offset cache
- [x] Business expenses
- [x] Reconciliation job
- [x] Order history pages
- [x] Real `orders/create`, `orders/updated`, and `refunds/create` processing
- [x] Manual adjustment admin flow
- [x] Order History filtering/pagination
- [x] Playwright coverage for Phase 3 admin workflows

---

## Post-Phase-3 Follow-Up

These are useful next items, but they are no longer blockers for closing Phase 3:

- UI polish and parity follow-ups such as:
  - create-from-search empty states
  - Variant picker parity with Template picker flows
  - large-list filtering UX refinement
- engineering hardening:
  - restore stricter ESLint severities after the config migration
- library metadata and delete-safety enhancements that are shipping as separate PRs
- next major product capability:
  - separate Production vs Shipping template modeling and assignment

---

## Phase 4 Checklist

- [x] Reporting periods
- [x] Cause allocation materialization
- [~] Shopify charge sync
  Daily charge import and reporting integration are in place; the issue remains open for remaining completion/hardening work.
- [x] Reporting dashboard
- [x] Disbursements
  Includes receipt upload plus split disbursement tracking for allocated amount, extra contribution, and fees covered.
- [x] Tax true-up
- [x] Rolling cause payables and cross-period disbursement application
- [x] Export flows
  CSV and PDF reporting-period export support are implemented.
- [x] Analytical recalculation delta view
  Asynchronous analytical recalculation runs and reporting deltas are implemented.
- [x] Audit log browsing UI

---

## Phase 5 Checklist

- [~] Storefront widget endpoint
  Display-safe widget payloads, threshold-based delivery mode, and app-proxy auth are implemented. Further batching, rate-limit, and theme-boundary hardening remain open follow-on work.
- [~] Theme app extension
  Product and cart storefront surfaces ship today as Online Store 2.0 theme app blocks. No app embed currently exists.
- [~] Cart donation summary
  A cart-page donation summary modal block is implemented, including storefront reconciliation and line annotations.
- [~] Thank You / Order Status extension
  Checkout-authenticated donation summary endpoint and extension scaffold are implemented.
- [~] Post-purchase donation email
  Merchant toggle, email service, and snapshot-triggered worker are implemented.
- [~] App Proxy donation receipts page
  A public app-proxy receipts page is implemented.
- [ ] Public storefront transparency page
  A broader Shopify Page plus widget experience for public donation reporting, receipts, donations made, and donations pending is planned but not yet implemented. This follow-on is now tracked in `#99`.
- [~] Full setup wizard
  First-run dashboard wizard and persistent checklist are implemented. Some steps remain intentionally manual because there is no reliable truth source yet.

### Phase 5 Current Gaps

- [~] POD/provider completion
  Provider Connections is no longer a placeholder page. Printify credentials validate before save, sync runs record real mapping/cache counts, cached base POD fulfillment costs now flow into preview-mode cost resolution, snapshot creation now attempts a live Printify refresh before cache fallback, token-added / estimated-expiry metadata is visible in the admin, unresolved variants can now be manually mapped against cached provider catalog variants, and product/variant admin pages now show POD mapping status plus cached provider cost lines on variant detail. Remaining work is concentrated around live validation, duplicate/missing-SKU workflows, provider shipping-cost treatment, and future provider expansion. Current rollout direction is Printify-first, with Printful planned next rather than implied as already supported.
  Current Printify setup expectation: merchants need a personal access token with at least `shops.read` and `products.read`.
  Additional tracked follow-ups:
  packing slips `#94`, Shopify Admin native product/variant surfaces `#95`, cause assignment override hierarchy `#96`, full spreadsheet-style bulk editor `#97`, and Printful parity / scope decision `#98`.
- [~] Storefront hardening
  Product/cart surfaces are live, but batching, theme-boundary hardening, and accessibility/comprehension cleanup remain open follow-on work.

---

## Phase 6 Checklist

- [~] App Store preparation and submission hardening
  Technical audit worksheet is implemented on the active branch; repo-backed blockers and manual verification gaps are now documented.
- [~] Full QA pass against the PRD checklist
  A dedicated workbook based on PRD §18 is implemented on the active branch and awaiting execution/review.
- [~] Demo store setup
  Review-store seed preset and prep checklist are implemented on the active branch and awaiting review/merge.
- [~] Listing assets and copy
  Draft listing copy and screenshot plan are implemented on the active branch and awaiting review/merge.
- [~] Final pre-submission review
  Review template is implemented on the active branch and awaiting review/merge.

---

## Notes

- This file is a practical implementation snapshot, not the source of product requirements.
- The PRD, build plan, ADRs, and implementation plans remain authoritative for scope and architecture.
- For immediate next work, use [docs/plans/issue-85-printify-pod-rollout-plan.md](./plans/issue-85-printify-pod-rollout-plan.md), [docs/plans/pending-questions.md](./plans/pending-questions.md), and the open enhancement issues as the next planning inputs.
- Update this file when a phase meaningfully changes state, not for every small commit.
- Local Shopify CLI development currently uses [shopify.app.toml](../shopify.app.toml) as a safe default. The full Phase 3 webhook subscription set is tracked in [shopify.app.phase3.toml](../shopify.app.phase3.toml) until the local CLI issue around order/refund topics is resolved.
