# Current Implementation Status

Use this document as the practical snapshot of what is implemented in the repo today.

This file is intentionally lightweight and operational. It should summarize reality, not restate full product requirements or phase specs.

**Project:** Count On Us  
**Date:** April 9, 2026  
**Summary:** Phase 1, Phase 2, and Phase 3 are complete. Phase 4 is now well underway, with the reporting foundation, dashboard, charge sync groundwork, disbursement logging, receipt storage, tax true-up, export support, audit log browsing, and analytical recalculation groundwork implemented. Current focus is finishing the remaining reporting follow-up work while the storefront widget, Theme App Extension, cart donation summary, public receipts, post-purchase donation, post-purchase email, setup wizard, demo-store prep, listing-draft, technical-audit, QA-workbook, and final-review-template slices are active on the branch.

---

## Current Position

- **Phase 1:** Complete
- **Phase 2:** Complete
- **Current focus:** Phase 4 reporting completion, with rolling cause payables and cross-period disbursement application active, analytical recalculation implemented on the active branch, and the storefront widget, post-purchase, cart summary, public receipts, email, setup wizard, demo-store prep, listing-draft, technical-audit, QA-workbook, and final-review-template slices now underway
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
  Provider Connections now has a real admin foundation page plus stored Printify credential state, but provider sync, mapping, and POD cost resolution are still pending.
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
- [~] Rolling cause payables and cross-period disbursement application
  ADR direction is accepted and the first implementation tranche is in progress on the active branch.
- [~] Export flows
  CSV and PDF reporting-period export support are implemented on the active branch and awaiting review/merge.
- [~] Analytical recalculation delta view
  Asynchronous analytical recalculation runs and reporting deltas are implemented on the active branch and awaiting review/merge.
- [x] Audit log browsing UI

---

## Phase 5 Checklist

- [~] Storefront widget endpoint
  Display-safe widget payloads, threshold-based delivery mode, app-proxy auth, and per-shop rate limiting are implemented on the active branch and awaiting review/merge.
- [~] Theme app extension
  A first product-page Theme App Extension app block scaffold is implemented on the active branch and awaiting review/merge.
- [~] Cart donation summary
  A cart-page donation summary modal block is implemented on the active branch and awaiting review/merge.
- [~] Thank You / Order Status extension
  Checkout-authenticated donation summary endpoint and extension scaffold are implemented on the active branch and awaiting review/merge.
- [~] Post-purchase donation email
  Merchant toggle, email service, and snapshot-triggered worker are implemented on the active branch and awaiting review/merge.
- [~] App Proxy donation receipts page
  A public app-proxy receipts page is implemented on the active branch and awaiting review/merge.
- [~] Full setup wizard
  First-run dashboard wizard and persistent checklist are implemented on the active branch and awaiting review/merge.

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
- For immediate next work, use `docs/plans/issue-29-production-vs-shipping-templates-plan.md` and the open enhancement issues as the next planning inputs.
- Update this file when a phase meaningfully changes state, not for every small commit.
- Local Shopify CLI development currently uses [shopify.app.toml](../shopify.app.toml) as a safe default. The full Phase 3 webhook subscription set is tracked in [shopify.app.phase3.toml](../shopify.app.phase3.toml) until the local CLI issue around order/refund topics is resolved.
