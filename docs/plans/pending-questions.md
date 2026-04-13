# Pending Questions

This document tracks product or architectural questions that came up during the remaining-issues implementation pass.
It is intentionally lightweight so decisions can be reviewed later without blocking current development.

## Open Questions

### `#85` Printify rollout breaking-change readiness

- `#85` now has a dedicated implementation plan in [docs/plans/issue-85-printify-pod-rollout-plan.md](issue-85-printify-pod-rollout-plan.md).
- Before implementation starts, we should explicitly confirm:
  - whether disconnecting a provider should remove mappings/cache immediately or preserve historical linkage
  - whether manual sync is enough for the first tranche or whether scheduled sync must land in the same issue
  - whether unmapped provider variants should silently fall back to manual cost config or raise a stronger merchant warning
  - whether POD becomes reviewer-facing immediately after `#85`, or only after follow-on storefront/doc hardening
  - how we want to handle Printify credentials that can access multiple provider shops:
    - automatically bind to the first accessible shop for the first tranche
    - prompt the merchant to choose one shop before mapping/sync
    - or allow syncing multiple Printify shops into one Shopify shop
  - how we want to treat Printify product costs that arrive as cents without an explicit currency field:
    - assume shop currency for first-tranche estimates
    - hard-code USD until provider evidence says otherwise
    - or introduce provider-currency handling before POD costs are considered production-ready
  - now that manual mapping exists, duplicate/missing-SKU cases should remain lightweight informational cues rather than stronger warnings or blockers; mismatches are often deliberate in practice
  - provider-side shipping is now explicitly deferred for the first tranche so we do not double-count against existing packaging/shipping assumptions before a clearer shipment-level model exists

### PRD scope alignment follow-ups

- `#96` now tracks the missing cause-assignment override hierarchy that the PRD describes beyond product-default assignments.
- `#97` now tracks the spreadsheet-style bulk variant cost editor that the PRD calls for beyond today's bulk template assignment workflow.
- `#98` now tracks the unresolved Printful parity / scope question.
- Current direction: keep the longer-term provider vision broad, but describe the near-term rollout honestly as Printify-first with Printful planned next rather than implied as already supported.
- Follow-up implication: future provider work should preserve provider-neutral seams instead of letting Printify-specific service logic become the default architecture.
- Current override-direction for `#96`: narrow near-term implementation scope, keep product-default assignment as the primary path, and prefer tag-based override as the first additional override layer instead of category-based override.
- Current bulk-editor direction for `#97`: target a medium first pass that covers the most common operational edits without trying to replace the full variant-detail editing surface in one grid.
- Current packing-slip direction for `#94`: include both cause name and amount in the donation summary rather than only a generic note or cause-name list.
- Current Shopify Admin native-surface direction for `#95`: start with mostly read-only product/variant surfaces plus deep links back into the embedded app, rather than trying to support inline editing in the first tranche.
- Current provider-sync direction: automated sync is the desired long-term behavior because it is less obtrusive for merchants, but it should land as the next provider-hardening step once the current Printify tranche is stable rather than being forced into the still-settling core flow.

### `#45` Shopify charge sync completion scope

- The core Shopify Payments charge sync service, jobs, and reporting integration appear to be implemented already.
- Current direction: treat `#45` as a validation-first completion issue rather than assuming it needs a broader UX expansion.
- Only add follow-up work if focused validation shows a real remaining gap in:
  - merchant-facing manual sync / retry controls
  - reporting visibility for imported charges
  - troubleshooting for payout/charge association failures

### Country-aware tax guidance rollout

- `#75` exists for exploring country-aware tax estimation guidance.
- Current direction: start with curated links and presets for a small country set.
- Defer broader locale-driven guidance mapping or larger settings architecture until the first curated-country pass proves useful.

### Storefront widget localization and fee detail depth

- The `#53` widget endpoint currently returns donation and tax estimate values in shop currency.
- Managed Markets fee data is currently a placeholder and not yet storefront-aware.
- Current direction:
  - Managed Markets applicability and fee logic should be handled server-side because it affects snapshot/reporting truth, not just storefront display.
  - Customer-currency conversion should stay in the theme layer because it is display-only and should not alter the underlying financial record.

### Theme App Extension preload strategy

- The current `#54` app block uses a metadata-first storefront strategy:
  - fetch lightweight metadata immediately
  - eager-fetch the full payload on page load for low-line products
  - wait until first open for high-line products
- Current direction: accept the current metadata-first strategy as the practical near-term interpretation of the preload/lazy ADR.
- Only revisit the architecture if real storefront performance or theme behavior shows a meaningful problem.

### Cart donation summary surface breadth

- `#64` adds a cart-page app block for the donation summary modal.
- `#93` now tracks the follow-up work for future-proof cart-line annotation matching and cart-drawer compatibility.
- Current direction: long-term storefront expectation is both cart-page and cart-drawer support.
- Current recommended implementation hierarchy:
  - cart-page app block as the primary supported surface
  - cart-drawer support when the active theme exposes a usable target
  - app-embed / DOM-enhancement fallback for compatible themes
  - documented unsupported cases when no stable cart-line or drawer anchor is available
- That decision affects whether we keep the current block as-is or factor the modal trigger/summary logic into a more reusable storefront bundle later.

### Public donation receipts URL shape

- `#99` now tracks the broader public storefront transparency page, disclosure controls, and route-shape follow-up.
- `#99` now also has a dedicated implementation plan in [docs/plans/issue-99-public-transparency-page-plan.md](issue-99-public-transparency-page-plan.md).
- `#57` uses the current app proxy base path, so the public receipts page lives at `/apps/count-on-us/donation-receipts`.
- Older product/docs language still sometimes implies a shorter `/apps/donation-receipts` path.
- Current direction: the customer-facing storefront experience should be a normal Shopify Page with an app widget, not a raw app-proxy page as the primary UX.
- The app-proxy route should be treated as implementation detail and deep-link infrastructure rather than the main storefront surface.
- We also need to account for a broader public-facing donations/reporting widget, not only receipt browsing:
  - donation receipts/download history
  - public-facing breakdown of costs
  - donations made
  - donations still pending disbursement
- Because that storefront page may grow beyond receipts alone, we should revisit whether the backing app-proxy path should stay receipts-specific or move to a more generic donations/reporting route when implementation begins.
- Recommended storefront shape:
  - merchant creates a normal Shopify Page such as `Donation Receipts`, `Impact`, or `Transparency`
  - app widget renders the public donations/transparency experience inside that page
  - app proxy remains the backing data/download surface and optional deep-link target for specific receipt views
- Recommended product framing:
  - this is no longer just a "receipt page" question
  - it is a broader public transparency surface that can grow to include receipts, donation status, and reporting summaries without exposing internal merchant-only finance tools
- Proposed public widget sections:
  - overview summary:
    - total donations made
    - total donations pending disbursement
    - optionally last updated date / reporting period coverage
  - cause summary:
    - donations made by cause
    - donations pending by cause
  - receipt browser:
    - date
    - cause
    - amount
    - receipt/download action when a public receipt exists
  - transparency report:
    - display-safe cost and reserve breakdowns at the level the merchant chooses to share
- Current direction for disclosure controls:
  - use a two-layer model
  - shop-level settings define the maximum public disclosure allowed for this shop
  - widget-level settings control which approved sections/details are shown on a specific storefront page placement
  - widget-level settings must not be able to exceed the shop-level maximum
- Suggested control split:
  - shop-level public transparency policy:
    - whether public transparency surfaces are enabled
    - maximum disclosure tier (`minimal`, `standard`, `detailed`)
    - whether public receipts are allowed
    - whether pending disbursement totals are allowed
  - widget-level presentation controls:
    - page/widget title and intro copy
    - whether to show overview totals
    - whether to show receipts/history
    - whether to show cause breakdowns
    - whether to show public cost/transparency breakdowns
    - selected disclosure tier, constrained by the shop-level maximum
- Why this split currently feels right:
  - disclosure is partly policy and partly presentation
  - merchants may want different public pages to show different subsets of the same approved transparency data
  - central guardrails reduce the risk of over-disclosure from an individual widget placement
- Suggested levels:
  - minimal:
    - donations made
    - donations pending
    - receipt list only
  - standard:
    - minimal plus cause-by-cause totals
    - high-level cost categories such as materials, equipment, packaging, fees, and tax reserve
  - detailed:
    - standard plus more granular line breakdowns that are still display-safe
    - intended for merchants who want a stronger transparency story without exposing internal purchase-price math or admin-only reporting data
- Guardrails for any public reporting widget:
  - never expose raw internal financial records or admin-only reporting surfaces directly
  - only expose display-safe aggregates approved for storefront use
  - do not leak material purchase prices, hidden margins, or internal audit-only identifiers
  - keep "pending disbursement" wording explicit so customers understand these are committed-but-not-yet-disbursed amounts rather than completed donations
- Follow-up implementation implication:
  - if this broader transparency widget lands, the backing proxy path should likely become more generic than `donation-receipts`, for example a donations/transparency route with receipts as one subsection rather than the entire contract
- Recommended implementation framing:
  - treat this as a dedicated public transparency feature, not as a small extension of the current public receipts page
  - give it its own issue/backlog track so receipts, public reporting, and disclosure controls can be designed together

### Post-purchase estimate parity for discounted orders

- `#55` currently bases pending order estimates on Shopify Admin order line discounted totals before the authoritative snapshot exists.
- We should confirm whether that is the desired customer-facing approximation, or whether we want tighter parity work later around discounts, shipping allocation, and any order-level adjustments that may cause the confirmed snapshot to differ slightly from the early estimate.

### Post-purchase email provider depth and branding

- `#56` selects a pragmatic transport abstraction with `log` and `resend` drivers so the flow is shippable without forcing a provider SDK install in development.
- We should still decide:
  - whether Resend is the long-term production default
  - whether merchants need a configurable `from` address in-app
  - how much store branding (logo/colors/name treatment) must be present before we consider the donation email production-complete

### Setup wizard truth sources for currently manual steps

- `#58` derives most setup completion directly from shop data, but a few steps are still manual:
  - Managed Markets enable date review
  - POD provider connection review
  - storefront widget placement in Theme Editor
- We should decide whether future iterations should replace those manual completions with:
  - real saved Settings state for Managed Markets
  - actual provider connection state
  - Theme App Extension/theme-placement detection, if Shopify makes that feasible

### Demo-store review scope

- `#61` adds a repeatable seed preset plus a manual finish checklist, but a few reviewer-path decisions still need an explicit call:
  - Which dev store is the canonical review store?
  - Is POD provider review in scope for App Store reviewers or intentionally excluded?
  - Which theme should be treated as the primary reviewer theme once the widget is enabled?

### App Store listing final fields

- `#62` drafts the listing copy, but the following owner-controlled fields still need confirmation:
  - final approved app name
  - support contact email / URL
  - privacy policy URL
  - DPA request path
  - response-time commitment wording

### Technical audit blockers to resolve

- `#59` identified three immediate submission-readiness blockers from repo inspection:
  - `compliance_topics` are not present in the active app TOML configs
  - privacy policy URL is still undefined in submission docs
  - DPA request path is still undefined in submission docs
- We should decide whether each of those becomes its own tracked blocker issue or is resolved directly in the Phase 6 branch before wider submission review.

### Final review gating

- `#63` now has a review template, but the final meeting still depends on one remaining missing artifact:
  - execution of the full PRD QA workbook for `#60`
- We should decide who owns running the workbook end to end and how failures will be recorded:
  - inline in the workbook
  - as linked blocking issues
  - or both
