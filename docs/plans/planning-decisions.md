# Planning Decisions

This document records product, process, and operational decisions that were worked through from the old pending-questions log.

It is meant to hold decisions and rationale that are useful to keep, but that do not rise to the level of an ADR.

For still-open items, see [docs/plans/pending-questions.md](./pending-questions.md).

## Resolved Decisions

### `#96` / `#97` / `#98` PRD scope alignment follow-ups

Decision:

- Keep the longer-term provider vision broad, but describe the near-term rollout honestly as Printify-first with Printful planned next rather than implied as already supported.
- Preserve provider-neutral seams so future provider work does not inherit Printify-specific assumptions by default.
- For `#96`, narrow the near-term override implementation and prefer tag-based override as the first additional layer beyond product-default assignment.
- For `#97`, target a medium first pass for the bulk editor instead of trying to replace the full variant-detail editing surface in one grid.
- For `#94`, include both cause name and amount in the packing-slip donation summary.
- For `#95`, start with mostly read-only Shopify Admin product/variant surfaces plus deep links back into the embedded app.
- Automated provider sync is the desired long-term behavior, but it should land after the current Printify tranche is stable rather than being forced into the still-settling core flow.

Related:

- `#94`
- `#95`
- `#96`
- `#97`
- `#98`
- [docs/plans/issue-85-printify-pod-rollout-plan.md](./issue-85-printify-pod-rollout-plan.md)
- [docs/adrs/adr-010-provider-rollout-strategy.md](../adrs/adr-010-provider-rollout-strategy.md)

### `#45` Shopify charge sync completion scope

Decision:

- Treat `#45` as a validation-first completion issue rather than assuming it needs a broader UX expansion.
- Only add follow-up work if focused validation shows a real remaining gap in:
  - merchant-facing manual sync / retry controls
  - reporting visibility for imported charges
  - troubleshooting for payout/charge association failures

Related:

- `#45`

### `#75` Country-aware tax guidance rollout

Decision:

- Start with curated links and presets for a small country set.
- Defer broader locale-driven guidance mapping or a larger settings architecture until the first curated-country pass proves useful.

Related:

- `#75`

### `#53` Storefront widget localization and fee detail depth

Decision:

- Managed Markets applicability and fee logic should be handled server-side because it affects snapshot/reporting truth, not just storefront display.
- Customer-currency conversion should stay in the theme layer because it is display-only and should not alter the underlying financial record.

Related:

- `#53`

### `#54` Theme App Extension preload strategy

Decision:

- Accept the current metadata-first strategy as the practical near-term interpretation of the preload/lazy ADR.
- Only revisit the architecture if real storefront performance or theme behavior shows a meaningful problem.

Related:

- `#54`

### `#64` / `#93` Cart donation summary surface breadth

Decision:

- Long-term storefront expectation is both cart-page and cart-drawer support.
- Recommended implementation hierarchy:
  - cart-page app block as the primary supported surface
  - cart-drawer support when the active theme exposes a usable target
  - app-embed / DOM-enhancement fallback for compatible themes
  - documented unsupported cases when no stable cart-line or drawer anchor is available

Related:

- `#64`
- `#93`

### `#57` / `#99` Public donation receipts and transparency surface

Decision:

- The customer-facing storefront experience should be a normal Shopify Page with an app widget, not a raw app-proxy page as the primary UX.
- The app-proxy route should be treated as implementation detail and deep-link infrastructure rather than the main storefront surface.
- This is broader than a receipts page; it is a public transparency surface that can grow to include:
  - donation receipts/download history
  - public-facing breakdown of costs
  - donations made
  - donations still pending disbursement
- Use a two-layer disclosure model:
  - shop-level policy defines the maximum public disclosure allowed
  - widget-level settings control what appears on a specific page placement without exceeding the shop-level maximum

Suggested widget sections:

- overview summary
- cause summary
- receipt browser
- transparency report

Suggested disclosure tiers:

- `minimal`
- `standard`
- `detailed`

Guardrails:

- expose only display-safe aggregates
- do not expose raw internal financial records, hidden margins, purchase prices, or audit-only identifiers

Related:

- `#57`
- `#99`
- [docs/plans/issue-99-public-transparency-page-plan.md](./issue-99-public-transparency-page-plan.md)

### `#55` Post-purchase estimate parity for discounted orders

Decision:

- Treat the pre-snapshot customer-facing value as a close-enough estimate rather than trying to fully reproduce final ledger truth before snapshot creation.
- The product promise should be:
  - customer-facing pending-order values are directionally reliable and not misleading
  - final authoritative donation truth is established at snapshot time
- Only invest in tighter parity where:
  - the mismatch is customer-visible
  - it appears in common discount scenarios
  - and it can be improved without duplicating the full snapshot accounting model in the estimate path

Packaging/shipping implication:

- The PRD currently assumes a one-package max-cost estimate for storefront/pre-fulfillment calculations.
- Actual package truth after fulfillment is tracked in `#41`.
- Near-term estimate behavior can stay heuristic/close-enough while `#41` handles the shift from estimated package assumptions to actual fulfilled package truth.

Related:

- `#41`
- `#55`

### `#56` Post-purchase email provider depth and branding

Decision:

- Keep `log` as the development/local driver.
- Treat `resend` as the near-term production default.
- Do not pull multi-provider email support into this tranche unless a concrete production need appears.

Sender identity:

- Do not require merchant-configurable `from` addresses in the first production-complete pass.
- Prefer a stable app-controlled sender identity for reliability.
- If merchant-controlled reply behavior is needed later, explore `reply-to` before full custom sender-domain support.

Branding:

- The email should be store-aware and intentional, but not fully theme-customizable.
- Minimum acceptable branding should include:
  - merchant/store name
  - clear donation summary framing
  - readable mobile-friendly layout
  - accessible heading/content hierarchy
  - links to public receipts/transparency surfaces when enabled

Guardrail:

- Treat the email primarily as a trustworthy donation summary/follow-up communication.
- Do not frame it as a legal or tax receipt unless the underlying workflow/data truly supports that claim.

Related:

- `#56`

### `#58` Setup wizard truth sources for currently manual steps

Decision:

- Prefer saved app state when the truth is merchant acknowledgement/review.
- Prefer actual system state when the app has a durable integration/source-of-truth signal.
- Keep steps manual when Shopify/theme truth is not reliably observable.

Managed Markets:

- If the shop `createdAt` date is after the October 14, 2025 Managed Markets cutoff, and Managed Markets is enabled, we can safely infer the shop uses the post-cutoff pricing model.
- If the shop was created on or before October 14, 2025, creation date alone is not enough because Shopify's rule is based on when Managed Markets was originally applied for/activated.
- For older stores, keep using saved merchant confirmation until Shopify exposes a reliable activation-date signal.
- Until a reliable Shopify signal is confirmed, treat Managed Markets enablement as merchant-confirmed rather than auto-detected.

Provider connections:

- Move this step toward actual provider connection state.
- Completion should be automatic when a valid provider connection exists.
- A future refinement could distinguish `connected` from `connected and synced`.

Theme/widget placement:

- Keep manual for now.
- Only automate if Shopify provides a dependable placement signal.
- Partial detection, if added later, should be assistive rather than authoritative.

Future refinement:

- Support states such as `not started`, `detected/configured`, and `confirmed` rather than forcing every step into a simple binary.

Related:

- `#58`
- `#100`

### `#61` Demo-store review scope

Decision:

- Choose one canonical review store and document its exact shop name.
- Choose one canonical OS 2.0 reviewer theme and build the walkthrough around that theme.
- Keep POD out of the primary App Store reviewer path for now.
- Treat POD/provider flows as a secondary demo path until storefront/provider hardening is further along.

Recommended default reviewer baseline:

- use `Dawn` as the canonical reviewer theme
- treat other themes as secondary compatibility validation rather than the primary review path
- use one canonical seeded dev store with the exact shop name documented in the review materials
- use a remote hosted review environment pinned to a known review/release-candidate state rather than a local workstation

Environment direction:

- Prefer a remote hosted review environment over a developer workstation as the canonical reviewer/demo environment.
- The canonical review environment should be:
  - stable
  - remotely reachable without relying on a local machine being online
  - seeded/resettable
  - pinned to a known branch or release-candidate state

Cost-conscious hosting options worth exploring:

- Railway Hobby
- Fly.io shared CPU
- Render
- Google Cloud Run

Current recommendation:

- start by evaluating Railway Hobby, Fly.io shared CPU, and Cloud Run as the likely best cost/effort tradeoffs

Related:

- `#61`

### `#62` App Store listing final fields

Decision:

- Support, privacy policy, and DPA request paths should be treated as real submission inputs, not placeholders.
- Best-practice near-term direction is to host these pages on a stable public app domain rather than relying on Shopify storefront pages or temporary docs.
- A lightweight public site or public routes on the app host are sufficient for the first pass, for example:
  - `/support`
  - `/privacy`
  - `/dpa`
- Explore the actual content and wording further when working this issue, including:
  - drafting a privacy policy tailored to the app's real behavior
  - defining a simple DPA request intake path
  - deciding what support contact path and response-time wording we can sustain
- DPA request handling is related to privacy/compliance readiness, but it is not the same thing as uninstall-driven deletion handling.

Supporting draft content:

- [docs/legal/privacy-policy-draft.md](../legal/privacy-policy-draft.md)
- [docs/legal/dpa-request-page-draft.md](../legal/dpa-request-page-draft.md)
- [docs/legal/dpa-template-draft.md](../legal/dpa-template-draft.md)

Related:

- `#62`

### `#59` / `#101` Technical audit blockers and compliance follow-up

Decision:

- Keep the original submission-readiness blockers bundled conceptually under `#59`, but track the follow-up implementation work for compliance webhook handling and customer-data minimization in `#101`.
- Recommended `compliance_topics` set for the active app TOML configs:
  - `customers/data_request`
  - `customers/redact`
  - `shop/redact`
- These should be configured via the TOML `compliance_topics` field rather than treated as ordinary operational webhook topics.

Current implementation note on customer-linked data:

- The app appears intentionally low-PII in its primary reporting domain models, but it is not truly zero-PII today.
- Likely customer-linked data surfaces that compliance work should account for include:
  - customer email passed into post-purchase email jobs
  - customer email persisted today in `AuditLog.payload` for `POST_PURCHASE_EMAIL_SENT`
  - uploaded receipt files, which may contain personal data depending on merchant uploads
  - Shopify session records for merchant/staff users

Compliance implication:

- `customers/redact` and `customers/data_request` work should start from an explicit inventory of these stored customer-linked data surfaces.
- Post-purchase email audit logging is a likely minimization target because it currently stores the recipient email in audit payloads.

Related:

- `#59`
- `#101`

### `#60` / `#63` Final review gating

Decision:

- Treat the QA workbook for `#60` as the execution checklist for the review process.
- Treat `#63` as the final signoff/decision template layered on top of that workbook.

Ownership:

- Assign one explicit primary owner for running the workbook end to end.
- Supporting participants can help with execution and review, but accountability for completion should stay singular.

Failure recording:

- Record failures both inline in the workbook and as linked blocking issues when they are real/actionable.
- Inline notes preserve the execution trail.
- Linked issues ensure failures do not disappear inside a long checklist document.

Completion:

- The final review is only complete when:
  - the workbook has been executed end to end
  - failures are either fixed or explicitly accepted as non-blocking
  - blocking issues are linked and resolved
  - the canonical review store/theme/environment were the ones actually used during the pass

Related:

- `#60`
- `#63`
- [docs/prd-qa-workbook.md](../prd-qa-workbook.md)
- [docs/final-pre-submission-review.md](../final-pre-submission-review.md)
