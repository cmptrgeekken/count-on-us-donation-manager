# Current Implementation Status

Use this document as the practical snapshot of what is implemented in the repo today.

This file is intentionally lightweight and operational. It should summarize reality, not restate full product requirements or phase specs.

**Project:** Count On Us  
**Date:** April 2, 2026  
**Summary:** Phase 1 is complete. Phase 2 is largely implemented and currently being hardened. The team is wrapping up pre-Phase-3 issues before beginning the immutable snapshot, causes, and order accounting work.

---

## Current Position

- **Phase 1:** Complete
- **Phase 2:** Mostly complete
- **Current focus:** Phase 2 hardening and pre-Phase-3 cleanup
- **Phase 3:** Not yet started in substantive backend/data-model terms

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

### Still being hardened

- [~] Audit logging is present across many flows, but should be spot-checked against all documented required mutations
- [~] Validation exists in many actions, but is not yet consistently standardized around Zod
- [~] CostEngine behavior is implemented, but documented unit-test expectations do not appear fully in place
- [~] Template and variant UX is still being refined as part of Phase 2 wrap-up

### Deferred or intentionally incomplete

- [ ] POD/provider connections
- [ ] Full inline bulk editor
- [ ] Formal Vitest setup and documented test scripts

---

## Pre-Phase-3 Cleanup Checklist

- [ ] Finish remaining Phase 2 amendment work on templates and variants
- [ ] Clean up hardcoded localization defaults and connect formatter inputs to real shop data
- [ ] Verify shipping-material costing behavior matches the intended rules
- [ ] Verify default labor rate fallback everywhere costs are resolved
- [ ] Confirm `lineItemCount` stays correct through all add/remove paths
- [ ] Replace temporary webhook behavior that should not carry into Phase 3
- [ ] Add or finish automated tests for CostEngine and critical validation paths
- [ ] Reconcile docs and code before starting Phase 3 implementation

---

## Phase 3 Checklist

- [ ] Cause schema and metaobject sync
- [ ] Product cause assignment
- [ ] Snapshot schema
- [ ] Snapshot service
- [ ] Refund/adjustment service
- [ ] Tax offset cache
- [ ] Business expenses
- [ ] Reconciliation job
- [ ] Order history pages
- [ ] Real `orders/create`, `orders/updated`, and `refunds/create` processing

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
- Update this file when a phase meaningfully changes state, not for every small commit.
