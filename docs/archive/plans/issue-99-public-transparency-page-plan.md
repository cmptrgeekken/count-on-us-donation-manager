# Issue #99 - Public Storefront Transparency Page Plan

This document turns [GitHub issue #99](https://github.com/cmptrgeekken/count-on-us-donation-manager/issues/99) into an implementation plan with explicit product boundaries, disclosure controls, and delivery sequencing.

The goal is to create a public-facing transparency experience that feels native to the merchant storefront while preserving strict separation between display-safe public reporting and merchant-only operational finance data.

## Goal

Ship a merchant-configurable public transparency surface that:

1. lives on a normal Shopify Page with an app widget
2. can show donation receipts, donations made, and donations still pending disbursement
3. can optionally show display-safe transparency reporting summaries
4. lets merchants choose how much detail to expose publicly without risking accidental over-disclosure

## Current Baseline

What exists today:

- Product and cart storefront widgets exist as Theme App Extension blocks.
- A public app-proxy receipts page exists today under the current proxy base path.
- Reporting periods, cause allocations, disbursements, receipts, and rolling cause payables are implemented in the admin/reporting model.
- Public receipt publishing is already part of the broader product direction.

What is missing:

- no dedicated Shopify Page plus widget flow for a public transparency page
- no merchant-facing disclosure policy for how much public detail is allowed
- no clean separation between "public transparency aggregates" and the deeper merchant admin reporting model
- no consolidated storefront surface for:
  - donations made
  - donations pending disbursement
  - cause-level public summaries
  - receipt history

## Product Direction

### Primary UX

The customer-facing experience should be a normal Shopify Page with an app widget, not a raw app-proxy page as the primary UI.

Recommended shape:

- merchant creates a Shopify Page such as `Impact`, `Transparency`, or `Donation Receipts`
- merchant adds the Count On Us transparency widget to that page
- widget renders the public experience inside the page
- app proxy remains a backing data/download/deep-link contract

### Why this shape

- feels native to the storefront
- gives merchants control over navigation and placement
- supports multiple page variants later if desired
- keeps the proxy route as infrastructure rather than product language

## Non-Goals

Out of scope for `#99`:

- exposing merchant admin reporting screens publicly
- exposing raw finance records, raw receipt storage URLs, or audit-only identifiers
- building a full public donor portal with authentication, profiles, or saved history
- replacing the admin Reporting page
- deciding all future localization strategy for public finance wording
- solving every future disclosure/legal nuance for all countries in the first pass

Related issues:

- `#57` current public receipts proxy surface
- `#73` in-app receipt redaction before public publishing
- `#90` storefront accessibility and customer-comprehension hardening
- `#89` docs/setup guidance alignment

## Core Principles

### 1. Public data must be display-safe

The public widget should only consume display-safe aggregate contracts.

Never expose:

- raw material purchase prices
- hidden margins
- internal-only identifiers
- internal audit payloads
- merchant-only operational notes

### 2. Disclosure is both policy and presentation

Some public transparency choices are shop-wide policy decisions.
Others are page/widget presentation decisions.

The plan should support both without allowing the storefront widget to exceed the shop's policy boundary.

### 3. Pending disbursement language must be explicit

If we show pending amounts publicly, customers must understand that these are committed but not yet paid out.

We should avoid wording that implies:

- funds are already delivered
- the merchant is withholding donations indefinitely
- the app itself disburses money

### 4. Public transparency should not drift from ledger truth

The widget should be powered by authoritative reporting/disbursement aggregates, not a second independent finance model.

## Proposed Public Widget Sections

### A. Overview Summary

Potential fields:

- total donations made
- total donations pending disbursement
- reporting coverage label or "last updated" timestamp

This section should stay concise and easy to understand.

### B. Cause Summary

Potential fields:

- donations made by cause
- donations pending by cause

This helps merchants highlight who has benefited and where committed funds are still awaiting disbursement.

### C. Receipt Browser

Potential fields:

- date
- cause
- amount
- receipt or download action when a public receipt exists

This section should support both transparency and auditability without exposing private donor/merchant details.

### D. Transparency Report

Potential fields:

- display-safe cost/reserve/donation summaries at the level the merchant chooses to expose

This is where disclosure settings matter most.

## Disclosure-Control Model

### Shop-Level Public Transparency Policy

This should live in app settings and define the maximum public disclosure allowed.

Suggested fields:

- public transparency enabled
- maximum disclosure tier:
  - `minimal`
  - `standard`
  - `detailed`
- public receipts enabled
- pending disbursement totals enabled

This layer acts as the guardrail.

### Widget-Level Presentation Settings

This should live with the storefront widget placement and control how a specific page presents the approved data.

Suggested fields:

- title
- intro copy
- whether to show overview totals
- whether to show receipt history
- whether to show cause summaries
- whether to show transparency/cost breakdowns
- selected disclosure tier, constrained by the shop-level maximum

This layer acts as the presentation control.

### Recommended Tier Definitions

#### `minimal`

- donations made
- donations pending disbursement
- receipt list/history only

#### `standard`

- minimal plus cause-by-cause totals
- high-level cost categories such as:
  - materials
  - equipment
  - packaging
  - Shopify fees
  - estimated tax reserve

#### `detailed`

- standard plus more granular but still display-safe line breakdowns
- appropriate for merchants who want stronger transparency without exposing internal purchase-price or admin-only reporting math

## Data Contract Direction

### Public Contract Should Be Separate From Admin Reporting

Do not reuse admin page payloads directly.

Instead, introduce a dedicated public transparency contract that is:

- display-safe
- cacheable
- explicitly versioned if it grows
- shaped around storefront comprehension, not admin workflows

### Likely Contract Areas

- page metadata / coverage label
- public totals
- cause summaries
- public receipts
- optional public reporting breakdowns
- disclosure metadata so the widget knows what is intentionally hidden

## Route Direction

The current receipts-specific proxy path may be too narrow if this surface becomes broader than receipts.

Recommended near-term position:

- keep the current route working
- do not treat its exact path as the product's main UX promise
- revisit whether implementation should use a broader donations/transparency backing route when `#99` is built

Examples of future direction:

- `/apps/count-on-us/donation-receipts` if the contract remains narrowly receipt-oriented
- `/apps/count-on-us/donations`
- `/apps/count-on-us/transparency`

The exact route is less important than keeping the visible storefront experience Page + Widget based.

## Suggested Delivery Strategy

### Phase A - Public Model Definition

- define display-safe public aggregates
- define which ledger/reporting concepts can appear publicly
- finalize disclosure tiers and terminology
- document public/private data boundaries

### Phase B - Settings and Widget Contract

- add shop-level public transparency policy settings
- add widget-level settings model
- enforce "widget cannot exceed shop maximum" behavior
- define the dedicated public transparency payload

### Phase C - Public Receipts and Summary Surface

- wire published receipt/history data into the public contract
- add overview totals
- add cause-level summaries
- add last-updated / coverage framing if useful

### Phase D - Public Transparency Breakdown

- expose standard-tier display-safe breakdown categories
- add detailed-tier support if it can be done cleanly in the same pass
- validate public wording and hierarchy with customer-comprehension goals

### Phase E - Theme/Docs Hardening

- document merchant setup for the Page + Widget flow
- align setup wizard/docs if this becomes a merchant-facing setup step
- validate accessibility and small-screen behavior

## Copy and Terminology Considerations

We should settle public-facing wording deliberately.

Areas needing care:

- `donations made`
- `pending disbursement`
- `receipt`
- `estimated`
- `last updated`
- whether cost lines should read as:
  - "Less: Materials"
  - "Covered by production costs"
  - "Reserved for taxes and fees"

The wording should feel trustworthy to customers, not like internal accounting jargon leaked onto the storefront.

## Risks

### Risk 1 - Over-disclosure

If we blur shop policy and widget settings, merchants may accidentally expose more detail than intended.

Mitigation:

- shop-level maximum disclosure policy
- widget-level settings constrained by that maximum

### Risk 2 - Public confusion about pending amounts

Customers may interpret pending amounts as already donated or as a sign that donations are not being fulfilled.

Mitigation:

- careful wording
- visible explanation copy
- optional receipts/history to show completed disbursements

### Risk 3 - Admin/public contract coupling

If we reuse admin reporting payloads directly, we create both security and maintainability risk.

Mitigation:

- separate public contract
- display-safe aggregate service layer

### Risk 4 - Route churn

If we over-commit to a receipts-specific route now, it may become awkward once the surface expands.

Mitigation:

- treat the route as implementation detail for now
- keep the storefront promise centered on the Page + Widget UX

## Test Plan

### Unit Tests

- disclosure-tier gating
- widget-level settings cannot exceed shop-level maximum
- public aggregate serialization excludes restricted fields
- public receipts visibility respects publication controls
- pending-disbursement totals respect the policy toggle

### Integration Tests

- public transparency payload returns only display-safe fields
- published receipts appear when allowed and stay hidden when disabled
- cause totals and overall totals align with source aggregates
- widget settings correctly filter the returned/used sections

### UI / End-to-End Tests

- merchant can configure shop-level transparency policy
- merchant can place/configure the public transparency widget on a Shopify Page
- public page renders the expected sections for minimal/standard/detailed configurations
- small-screen layout remains usable
- disclosure and explanation copy remain accessible and understandable

## Breaking Changes / Future-Work Impacts

Once `#99` lands:

- the product will no longer be accurately described as having only a public receipts page
- docs/setup guidance will need to distinguish:
  - admin reporting
  - storefront transparency
  - public receipts
- `#57` should be reframed as one part of a broader public transparency system
- future transparency work should extend the dedicated public contract rather than adding one-off public endpoints per section

## Exit Criteria

`#99` is complete when all of the following are true:

- a merchant can publish a normal Shopify Page with the Count On Us transparency widget
- the widget can render a public-facing transparency experience using display-safe data only
- public receipts/history can be shown when enabled
- donations made and donations pending disbursement can be shown with customer-safe wording
- disclosure is controlled by both:
  - shop-level maximum policy
  - widget-level presentation settings constrained by that maximum
- docs clearly explain the difference between the public transparency page and admin reporting
