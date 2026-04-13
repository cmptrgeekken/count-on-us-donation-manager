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
- Current direction: treat the pre-snapshot customer-facing value as a close-enough estimate rather than trying to fully reproduce final ledger truth before snapshot creation.
- The product promise should be:
  - customer-facing pending-order values are directionally reliable and not misleading
  - final authoritative donation truth is established at snapshot time
- We should only invest in tighter parity where:
  - the mismatch is customer-visible
  - it appears in common discount scenarios
  - and it can be improved without duplicating the full snapshot accounting model in the estimate path
- Related packaging/shipping implication:
  - the PRD currently assumes a one-package max-cost estimate for storefront/pre-fulfillment calculations and explicitly treats true cartonization as future work
  - actual package truth after fulfillment is already tracked in `#41`, which is the right home for multi-package fulfillment costing and reconciliation against Shopify package usage
  - near-term estimate behavior can stay heuristic/close-enough while `#41` handles the future shift from estimated package assumptions to actual fulfilled package truth

### Post-purchase email provider depth and branding

- `#56` selects a pragmatic transport abstraction with `log` and `resend` drivers so the flow is shippable without forcing a provider SDK install in development.
- Current direction:
  - keep `log` as the development/local driver
  - treat `resend` as the near-term production default
  - do not pull multi-provider email support into this tranche unless a concrete production need appears
- Sender identity direction:
  - do not require merchant-configurable `from` addresses in the first production-complete pass
  - prefer a stable app-controlled sender identity for reliability
  - if we need merchant-controlled reply behavior later, explore `reply-to` before full custom sender-domain support
- Branding direction:
  - the email should be store-aware and intentional, but not fully theme-customizable
  - minimum acceptable branding should include:
    - merchant/store name
    - clear donation summary framing
    - readable mobile-friendly layout
    - accessible heading/content hierarchy
    - links to public receipts/transparency surfaces when enabled
  - logo support is useful if it is easy to source reliably, but full visual theme customization should be deferred
- Product-positioning guardrail:
  - treat the email primarily as a trustworthy donation summary / follow-up communication
  - do not frame it as a legal or tax receipt unless the underlying workflow/data truly supports that claim

### Setup wizard truth sources for currently manual steps

- `#100` now tracks follow-up research into whether Managed Markets enablement / activation timing can be detected reliably enough for wizard automation.
- `#58` derives most setup completion directly from shop data, but a few steps are still manual:
  - Managed Markets enable date review
  - POD provider connection review
  - storefront widget placement in Theme Editor
- Current direction:
  - prefer saved app state when the truth is merchant acknowledgement/review
  - prefer actual system state when the app has a durable integration/source-of-truth signal
  - keep steps manual when Shopify/theme truth is not reliably observable
- Managed Markets direction:
  - if the shop `createdAt` date is after the October 14, 2025 Managed Markets cutoff, and Managed Markets is enabled, we can safely infer the shop uses the post-cutoff pricing model
  - if the shop was created on or before October 14, 2025, creation date alone is not enough because Shopify's rule is based on when Managed Markets was originally applied for / activated
  - for older stores, keep using saved merchant confirmation until Shopify exposes a reliable activation-date signal
  - Managed Markets "enabled" status itself still needs a trustworthy detection source before this step can become fully automatic; generic Markets state is not enough to treat Managed Markets as definitively detected
  - until a reliable Shopify signal is confirmed, treat Managed Markets enablement as merchant-confirmed rather than auto-detected
  - follow-up research should verify whether Shopify exposes a dependable Managed Markets enabled / activation-date signal that we can safely use later
- POD provider connection direction:
  - move this step toward actual provider connection state
  - completion should be automatic when a valid provider connection exists
  - a future refinement could distinguish `connected` from `connected and synced`
- Theme/widget placement direction:
  - keep manual for now
  - only automate if Shopify provides a dependable placement signal
  - partial detection, if added later, should be assistive rather than authoritative
- Future refinement worth considering:
  - support distinct wizard states such as `not started`, `detected/configured`, and `confirmed`, rather than forcing every step into a simple incomplete/complete binary

### Demo-store review scope

- `#61` adds a repeatable seed preset plus a manual finish checklist, but a few reviewer-path decisions still need an explicit call:
  - Which dev store is the canonical review store?
  - Is POD provider review in scope for App Store reviewers or intentionally excluded?
  - Which theme should be treated as the primary reviewer theme once the widget is enabled?
- Current direction:
  - choose one canonical review store and document its exact shop name
  - choose one canonical OS 2.0 reviewer theme and build the walkthrough around that theme
  - keep POD out of the primary App Store reviewer path for now
  - treat POD/provider flows as a secondary demo path until storefront/provider hardening is further along
- Recommended default reviewer baseline:
  - use `Dawn` as the canonical reviewer theme
  - treat other themes as secondary compatibility validation rather than the primary review path
  - use one canonical seeded dev store with the exact shop name documented in the review materials
  - use a remote hosted review environment pinned to a known review/release-candidate state rather than a local workstation
- Environment direction:
  - prefer a remote hosted review environment over a developer workstation as the canonical reviewer/demo environment
  - local development remains the right place for active implementation and exploratory testing, but not for the official review path
  - the canonical review environment should be:
    - stable
    - remotely reachable without relying on a local machine being online
    - seeded/resettable
    - pinned to a known branch or release-candidate state
- Why a remote review environment is preferred:
  - better availability and less operational drift than DNS-routing traffic through a local PC
  - less risk that local experiments or incomplete changes leak into the reviewer path
  - easier to document as the single source of truth for screenshots, walkthroughs, and QA
- Cost-conscious hosting options worth exploring for the canonical review environment:
  - Railway Hobby:
    - low entry cost (`$5/month`, with the subscription counting toward usage)
    - easy for app-style deployments
    - attractive if we want a lightweight always-on review instance
  - Fly.io shared CPU:
    - very low baseline cost for a small always-on app (for example, shared-CPU presets can be only a few dollars per month depending on RAM/region)
    - good fit if we are comfortable with a slightly more infra-oriented setup
  - Render:
    - simple app deployment UX
    - worth exploring if we value operational simplicity over the absolute lowest spend
  - Google Cloud Run:
    - attractive for low/variable traffic because of pay-per-use pricing and free tier
    - better fit if we are comfortable owning a bit more cloud configuration
- Current recommendation:
  - start by evaluating Railway Hobby, Fly.io shared CPU, and Cloud Run as the likely best cost/effort tradeoffs
  - only use a local machine as the canonical review path if remote hosting overhead would materially slow current progress

### App Store listing final fields

- `#62` drafts the listing copy, but the following owner-controlled fields still need confirmation:
  - final approved app name
  - support contact email / URL
  - privacy policy URL
  - DPA request path
  - response-time commitment wording
- Supporting draft content now exists for later refinement and legal review:
  - [docs/legal/privacy-policy-draft.md](../legal/privacy-policy-draft.md)
  - [docs/legal/dpa-request-page-draft.md](../legal/dpa-request-page-draft.md)
  - [docs/legal/dpa-template-draft.md](../legal/dpa-template-draft.md)

### Technical audit blockers to resolve

- `#101` now tracks the follow-up implementation work for compliance webhook handling and customer-data minimization.
- `#59` identified three immediate submission-readiness blockers from repo inspection:
  - `compliance_topics` are not present in the active app TOML configs
  - privacy policy URL is still undefined in submission docs
  - DPA request path is still undefined in submission docs
- Current direction:
  - keep these bundled under `#59` as explicit submission-readiness checklist blockers rather than splitting them into additional issues for now
  - resolve them directly in the Phase 6/submission-hardening work unless one unexpectedly expands in scope
- Recommended `compliance_topics` set for the active app TOML configs:
  - `customers/data_request`
  - `customers/redact`
  - `shop/redact`
- These should be configured via the TOML `compliance_topics` field rather than treated as ordinary operational webhook topics.
- Practical implication:
  - config/TOML work still needs to be paired with real webhook handling behavior for all three required compliance topics, not only declaration in config
- Current implementation note on customer-linked data:
  - the app appears intentionally low-PII in its primary reporting domain models
  - however, it is not truly zero-PII today
  - likely customer-linked data surfaces that compliance work should account for include:
    - customer email passed into post-purchase email jobs
    - customer email persisted today in `AuditLog.payload` for `POST_PURCHASE_EMAIL_SENT`
    - uploaded receipt files, which may contain personal data depending on merchant uploads
    - Shopify session records for merchant/staff users
- Compliance follow-up implication:
  - `customers/redact` and `customers/data_request` work should start from an explicit inventory of these stored customer-linked data surfaces
  - post-purchase email audit logging is a likely minimization target because it currently stores the recipient email in audit payloads

### Final review gating

- `#63` now has a review template, but the final meeting still depends on one remaining missing artifact:
  - execution of the full PRD QA workbook for `#60`
- Current direction:
  - treat the QA workbook for `#60` as the execution checklist for the review process
  - treat `#63` as the final signoff / decision template layered on top of that workbook
- Ownership direction:
  - assign one explicit primary owner for running the workbook end to end
  - supporting participants can help with execution and review, but accountability for completion should stay singular
- Failure-recording direction:
  - record failures both inline in the workbook and as linked blocking issues when they are real/actionable
  - inline notes preserve the execution trail
  - linked issues ensure failures do not disappear inside a long checklist document
- Completion direction:
  - the final review is only complete when:
    - the workbook has been executed end to end
    - failures are either fixed or explicitly accepted as non-blocking
    - blocking issues are linked and resolved
    - the canonical review store/theme/environment were the ones actually used during the pass
