# Current Implementation Status

Use this document as the practical snapshot of what is implemented in the repo today.

This file is intentionally lightweight and operational. It should summarize reality, not restate full product requirements or phase specs.

**Project:** Count On Us  
**Date:** June 8, 2026

**Summary:** Phase 1, Phase 2, Phase 3, and the core Phase 4 reporting/accounting model are implemented. Phase 5 is no longer just a foundation: the repo contains product/cart storefront blocks, a transparency-page block and app-proxy backing route, public receipts, post-purchase donation email/service/worker support, Thank You / Order Status extension code, setup wizard flows, and artist collaboration/submission surfaces. The current state is best described as submission-hardening and scope-alignment, not greenfield implementation. The biggest remaining risks are App Store compliance readiness (`#87`, `#101`), unexecuted full PRD QA (`#60`), demo-store/manual review completion (`#61`, `#63`), storefront production hardening (`#88`, `#90`, `#92`, `#93`), and still-open provider/POD scope decisions (`#98`, `#132`). The recent June changes also make post-purchase donation summary emails opt-in for new shops by default.

---

## Current Position

- **Phase 1:** Complete
- **Phase 2:** Complete
- **Current focus:** App Store readiness, compliance/data-minimization, full QA execution, storefront hardening, and honest scope alignment against open GitHub issues
- **Phase 3:** Complete

## GitHub Issue Snapshot

Reviewed open GitHub issues on June 8, 2026. Important open tracks:

- **Submission blockers and readiness:** `#87` App Review blockers, `#101` compliance webhook/customer-data minimization, `#60` full PRD QA, `#61` demo store, `#63` final pre-submission review.
- **Provider/POD scope:** `#85` is closed for the original Printify baseline; `#132` tracks remaining Printify hardening around duplicate/missing SKUs, shipping-cost treatment, and live validation; `#98` tracks Printful parity and whether it remains v1 scope.
- **Storefront/public hardening:** `#88` proxy/rate-limit/theme boundaries, `#90` accessibility and comprehension, `#92` theme-extension asset-size warnings, `#93` cart annotations and drawer support, `#99` public transparency page/disclosure controls.
- **PRD scope gaps:** `#94` packing-slip donation summaries, `#95` Shopify Admin product/variant surfaces, `#96` cause-assignment override hierarchy, `#97` spreadsheet-style bulk editor.
- **Marketing/acquisition transparency research:** `#102` settings, `#103` display-safe contracts, `#104` late Shop Campaigns attribution tags, `#105` product-description fallback, `#106` billing data research.
- **Reporting and operations polish:** `#86` action-oriented reporting, `#107` edit logged disbursements, `#108` standardized disbursement payment methods, `#114` Reporting Charges Summary pagination, `#115` fulfillment-aware package grouping.
- **Older deferred improvements still open:** `#5`, `#6`, `#17`, `#19`, `#22`, `#34`, `#43`, `#45`, `#73`, `#89`.

## Prioritized Remaining Work

This ordering is a working priority stack for the next pass through the open issues. GitHub Issues remain the source of truth for scope and acceptance criteria.

### P0 - App Store Submission Blockers

Finish these before treating the app as submission-ready:

- `#101` Compliance webhook handling and customer-data minimization
- `#87` Shopify App Review blockers from the technical audit
- `#60` Full PRD QA checklist execution
- `#61` Demo store preparation and review evidence
- `#62` App Store listing assets, owner-controlled URLs, and copy
- `#63` Final pre-submission review

Recommended sequence: complete `#101` and the repo-backed parts of `#87` first, then run `#60` and `#61` in parallel, then finish `#62`, then use `#63` as the final gate.

### P1 - Submission Hardening And Trust

These are not all formal blockers, but they reduce review risk and customer-trust risk:

- `#89` Align docs and setup guidance with actual product state
- `#131` Production Docker Compose and CI deployment hardening
- `#88` Storefront proxy, rate limiting, and theme-support boundaries
- `#90` Storefront donation widget accessibility and customer comprehension
- `#92` Theme app extension asset-size warnings
- `#99` Public transparency disclosure controls and merchant policy boundaries
- `#129` Artist submission upload, retention, and privacy controls
- `#73` In-app receipt redaction before publishing receipts

Work on these as soon as they block QA evidence, demo-store confidence, or review-facing claims.

### P2 - Financial And Operational Reliability

These improve the merchant's ability to trust reporting and reconcile money:

- `#45` Complete remaining Shopify Payments charge-sync hardening
- `#84` Charge sync status and troubleshooting UX
- `#114` Reporting Charges Summary pagination or rollup
- `#86` More action-oriented reporting
- `#107` Edit logged cause disbursements with auditability
- `#108` Standardize disbursement payment method values
- `#82` Exclude labor from sole proprietor deduction calculations
- `#115` Fulfillment-aware package grouping for packaging reconciliation
- `#41` Shopify package source-of-truth for shipping material costs

Prefer the charge/reporting items before deeper packaging reconciliation unless packaging truth becomes a review-store demo requirement.

### P3 - Scope Alignment And V1 Product Shape

These decide what the first public product honestly includes:

- `#98` Printful parity and v1 provider scope decision
- `#132` Printify provider sync edge cases and shipping-cost treatment
- `#94` Donation summaries on packing slips
- `#95` Shopify Admin product and variant extension surfaces
- `#96` Cause assignment override hierarchy beyond product defaults
- `#97` Spreadsheet-style bulk editor for variant cost adjustments
- `#83` Storefront donation-enabled product badges
- `#93` Cart donation annotations and cart drawer support
- `#100` Managed Markets detection research for wizard automation

Use this tier to keep docs, listing copy, and demo-store expectations honest even when implementation is deferred.

### P4 - Later Roadmap And Strategic Architecture

These are useful, but should not displace submission readiness:

- `#102` Marketing/acquisition cost configuration
- `#103` Marketing reserve in display-safe transparency contracts
- `#104` Shop Campaigns post-order attribution tags
- `#105` Product-description donation breakdowns for Shop app visibility
- `#106` Shop Campaigns billing data research
- `#75` Country-aware tax estimation guidance
- `#19` Optional Shopify variant cost sync
- `#6` Full application localization planning
- `#5` Draft configuration workflow design
- `#17` Create-from-search empty states for template pickers
- `#22` Web Components filtering UX pattern
- `#34` ESLint severity hardening
- `#43` Settings staged Save / Discard workflow
- `#130` Capability-aware admin shell and route inventory

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
  Provider Connections is no longer a placeholder page. Printify credentials validate before save, sync runs record real mapping/cache counts, cached base POD fulfillment costs now flow into preview-mode cost resolution, snapshot creation now attempts a live Printify refresh before cache fallback, token-added / estimated-expiry metadata is visible in the admin, unresolved variants can now be manually mapped against cached provider catalog variants, and product/variant admin pages now show POD mapping status plus cached provider cost lines on variant detail. The original Printify baseline issue `#85` is closed; remaining work is concentrated in `#132` around live validation, duplicate/missing-SKU workflows, provider shipping-cost treatment, and future provider expansion. Current rollout direction is Printify-first, with Printful planned next rather than implied as already supported.
  Current Printify setup expectation: merchants need a personal access token with at least `shops.read` and `products.read`.
  Additional tracked follow-ups:
  packing slips `#94`, Shopify Admin native product/variant surfaces `#95`, cause assignment override hierarchy `#96`, full spreadsheet-style bulk editor `#97`, Printful parity / scope decision `#98`, Printify hardening `#132`, artist submission upload/privacy hardening `#129`, capability-aware admin shell planning `#130`, and production deployment hardening `#131`.
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
- For immediate next work, use GitHub Issues and the priority stack above. The likely first sequence is `#101`, repo-backed `#87`, `#60`/`#61`, `#62`, then `#63`.
- Update this file when a phase meaningfully changes state, not for every small commit.
- Local Shopify CLI development currently uses [shopify.app.toml](../shopify.app.toml) as a safe default. The full Phase 3 webhook subscription set is tracked in [shopify.app.phase3.toml](../shopify.app.phase3.toml) until the local CLI issue around order/refund topics is resolved.
