# Current Implementation Status

Use this document as the practical snapshot of what is implemented in the repo today.

This file is intentionally lightweight and operational. It should summarize reality, not restate full product requirements or phase specs.

**Project:** Count On Us  
**Date:** April 5, 2026  
**Summary:** Phase 1 and Phase 2 are complete. Phase 3 is actively in progress on the implementation branch, including the schema foundation, causes/products/expenses, snapshot and adjustment services, reconciliation, and the first Order History admin surface.

---

## Current Position

- **Phase 1:** Complete
- **Phase 2:** Complete
- **Current focus:** Phase 3 implementation
- **Phase 3:** In progress

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

- [ ] POD/provider connections
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
- [ ] Manual adjustment admin flow polish
- [ ] Order History filtering/pagination polish
- [ ] Additional Playwright coverage for new Phase 3 admin workflows

---

## Phase 4 Checklist

- [ ] Reporting periods
- [ ] Cause allocation materialization
- [ ] Shopify charge sync
- [ ] Reporting dashboard
- [ ] Disbursements
- [ ] Tax true-up
- [ ] Export flows
- [ ] Audit log browsing UI

---

## Phase 5 Checklist

- [ ] Storefront widget endpoint
- [ ] Theme app extension
- [ ] Cart donation summary
- [ ] Thank You / Order Status extension
- [ ] Post-purchase donation email
- [ ] App Proxy donation receipts page
- [ ] Full setup wizard

---

## Phase 6 Checklist

- [ ] App Store preparation and submission hardening
- [ ] Full QA pass against the PRD checklist
- [ ] Demo store setup
- [ ] Listing assets and copy
- [ ] Final pre-submission review

---

## Notes

- This file is a practical implementation snapshot, not the source of product requirements.
- The PRD, build plan, ADRs, and implementation plans remain authoritative for scope and architecture.
- For immediate next work, use `docs/plans/phase-3-kickoff-checklist.md` alongside the Phase 3 implementation plan.
- Update this file when a phase meaningfully changes state, not for every small commit.
