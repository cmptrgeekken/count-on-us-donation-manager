# Current Implementation Status

Use this document as the practical snapshot of what is implemented in the repo today.

This file is intentionally lightweight and operational. It should summarize reality, not restate full product requirements or phase specs.

**Project:** Count On Us  
**Date:** June 8, 2026

**Summary:** Phase 1, Phase 2, Phase 3, and the core Phase 4 reporting/accounting model are implemented. Phase 5 is no longer just a foundation: the repo contains product/cart storefront blocks, a transparency-page block and app-proxy backing route, public receipts, post-purchase donation email/service/worker support, Thank You / Order Status extension code, setup wizard flows, and artist collaboration/submission surfaces. The current state is best described as submission-hardening and scope-alignment, not greenfield implementation. The biggest remaining risks are App Store compliance readiness (`#87`, `#101`), unexecuted full PRD QA (`#60`), demo-store/manual review completion (`#61`, `#63`), storefront production hardening (`#88`, `#90`, `#92`, `#93`), and still-open provider/POD scope decisions (`#85`, `#98`). The recent June changes also make post-purchase donation summary emails opt-in for new shops by default.

---

## Current Position

- **Phase 1:** Complete
- **Phase 2:** Complete
- **Current focus:** App Store readiness, compliance/data-minimization, full QA execution, storefront hardening, and honest scope alignment against open GitHub issues
- **Phase 3:** Complete

## GitHub Issue Snapshot

Reviewed open GitHub issues on June 8, 2026. Important open tracks:

- **Submission blockers and readiness:** `#87` App Review blockers, `#101` compliance webhook/customer-data minimization, `#60` full PRD QA, `#61` demo store, `#63` final pre-submission review.
- **Provider/POD scope:** `#85` Printify completion remains open even though validation, sync/cache, mapping, and cost-resolution foundations exist; `#98` tracks Printful parity and whether it remains v1 scope.
- **Storefront/public hardening:** `#88` proxy/rate-limit/theme boundaries, `#90` accessibility and comprehension, `#92` theme-extension asset-size warnings, `#93` cart annotations and drawer support, `#99` public transparency page/disclosure controls.
- **PRD scope gaps:** `#94` packing-slip donation summaries, `#95` Shopify Admin product/variant surfaces, `#96` cause-assignment override hierarchy, `#97` spreadsheet-style bulk editor.
- **Marketing/acquisition transparency research:** `#102` settings, `#103` display-safe contracts, `#104` late Shop Campaigns attribution tags, `#105` product-description fallback, `#106` billing data research.
- **Reporting and operations polish:** `#86` action-oriented reporting, `#107` edit logged disbursements, `#108` standardized disbursement payment methods, `#114` Reporting Charges Summary pagination, `#115` fulfillment-aware package grouping.
- **Older deferred improvements still open:** `#5`, `#6`, `#17`, `#19`, `#22`, `#34`, `#43`, `#45`, `#73`, `#89`.

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
  Product, cart, artist submission, and transparency storefront surfaces ship today as Online Store 2.0 theme app blocks. No app embed currently exists.
- [~] Cart donation summary
  A cart-page donation summary modal block is implemented, including storefront reconciliation and line annotations.
- [~] Thank You / Order Status extension
  Checkout-authenticated donation summary endpoint and extension scaffold are implemented.
- [~] Post-purchase donation email
  Merchant toggle, email service, and snapshot-triggered worker are implemented. New shops now default this setting to disabled, so the feature is opt-in unless existing shop data says otherwise.
- [~] App Proxy donation receipts page
  A public app-proxy receipts page is implemented.
- [~] Public storefront transparency page
  A broader Shopify Page plus widget experience now has repo foundations: a transparency-page theme app block, app-proxy route, and display-safe public transparency service. Persisted merchant disclosure settings, broader policy UX, and final disclosure-control hardening remain open under `#99` and related marketing/transparency issues.
- [~] Full setup wizard
  First-run dashboard wizard and persistent checklist are implemented. Some steps remain intentionally manual because there is no reliable truth source yet.
- [~] Artist collaboration and submission intake
  Artist records, artist payout/allocation models, storefront submission block/API, admin review queue, file storage, conversion-to-draft-artist flow, and optional artist-submission notification emails are implemented. Remaining hardening should focus on review UX, file/PII policy, public copy, and end-to-end submission QA.

### Phase 5 Current Gaps

- [~] POD/provider completion
  Provider Connections is no longer a placeholder page. Printify credentials validate before save, sync runs record real mapping/cache counts, cached base POD fulfillment costs now flow into preview-mode cost resolution, snapshot creation now attempts a live Printify refresh before cache fallback, token-added / estimated-expiry metadata is visible in the admin, unresolved variants can now be manually mapped against cached provider catalog variants, and product/variant admin pages now show POD mapping status plus cached provider cost lines on variant detail. Remaining work is concentrated around live validation, duplicate/missing-SKU workflows, provider shipping-cost treatment, and future provider expansion. Current rollout direction is Printify-first, with Printful planned next rather than implied as already supported.
  Current Printify setup expectation: merchants need a personal access token with at least `shops.read` and `products.read`.
  Additional tracked follow-ups:
  packing slips `#94`, Shopify Admin native product/variant surfaces `#95`, cause assignment override hierarchy `#96`, full spreadsheet-style bulk editor `#97`, and Printful parity / scope decision `#98`.
- [~] Storefront hardening
  Product/cart/transparency/artist-submission surfaces are live, but production-safe shared rate limiting, app-proxy boundary cleanup, theme compatibility, asset-size cleanup, cart drawer support, accessibility, and customer-comprehension cleanup remain open follow-on work.

---

## Phase 6 Checklist

- [~] App Store preparation and submission hardening
  Technical audit worksheet is implemented. Repo-backed blockers and manual verification gaps are documented, with `#87` and `#101` now the key compliance/submission blocker issues.
- [~] Full QA pass against the PRD checklist
  A dedicated workbook based on PRD §18 exists but is still unexecuted; this remains open as `#60`.
- [~] Demo store setup
  Review-store seed preset and prep checklist exist; the review store still needs manual setup, credential/path decisions, and evidence capture under `#61`.
- [~] Listing assets and copy
  Draft listing copy and screenshot plan exist. Owner-controlled submission fields remain TODO: support contact, support URL, privacy policy URL, DPA request path, and response-time commitment.
- [~] Final pre-submission review
  Review template exists and should be filled after `#60`, `#61`, `#87`, and `#101` are resolved or explicitly deferred.

---

## Notes

- This file is a practical implementation snapshot, not the source of product requirements.
- The PRD, build plan, ADRs, standards, and GitHub Issues remain authoritative for scope, architecture, and open work.
- For immediate next work, use GitHub Issues. The likely priority order is `#101`/`#87` compliance and App Review blockers, `#60` QA workbook execution, `#61` demo-store completion, `#63` final review, then storefront/provider/product-scope hardening issues.
- Update this file when a phase meaningfully changes state, not for every small commit.
- Local Shopify CLI development currently uses [shopify.app.toml](../shopify.app.toml) as a safe default. The full Phase 3 webhook subscription set is tracked in [shopify.app.phase3.toml](../shopify.app.phase3.toml) until the local CLI issue around order/refund topics is resolved.
