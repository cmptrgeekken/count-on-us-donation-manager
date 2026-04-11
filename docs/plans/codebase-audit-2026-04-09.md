# Codebase Audit - April 9, 2026

This audit is a practical implementation review of the current repo state.
It focuses on missing logic, placeholder behavior, and places where the UI or docs still overstate what the app actually does.

## Highest-Priority Gaps

### 1. Provider Connections is only partially implemented

**Status:** Foundation implemented, but not yet operationally complete

**Evidence**
- [app.provider-connections.tsx](/d:/projects/count-on-us-donation-manager/app/routes/app.provider-connections.tsx)

**Current behavior**
- The route authenticates successfully.
- It stores encrypted Printify credential state and shows provider readiness context.
- It does not yet provide live validation, provider catalog sync, mapping management, or sync-run visibility.

**Why it matters**
- Dashboard and setup wizard currently imply a meaningful POD review flow exists.
- PRD/docs describe a fuller provider workflow than the implementation currently delivers.

**Recommendation**
- Treat Provider Connections and POD cost resolution as the next coordinated workstream, and keep merchant/reviewer copy explicit that only the connection foundation exists today.

## Major Functional Gaps

### 2. POD cost resolution is still stubbed

**Status:** Core logic missing

**Evidence**
- [costEngine.server.ts](/d:/projects/count-on-us-donation-manager/app/services/costEngine.server.ts): `// Step 4: POD (stubbed — Phase 2.9)`

**Current behavior**
- `podCost` resolves to zero.
- Reporting, widget, snapshot, and order-history surfaces can display POD fields, but there is no real provider-fed cost input.

**Why it matters**
- Provider Connections cannot be considered complete without this.
- Order snapshots and storefront estimates understate costs for POD-based merchants.

**Recommendation**
- Treat provider connections and POD cost resolution as one coordinated workstream.

### 3. No theme app embed exists

**Status:** Implementation/doc mismatch

**Evidence**
- [donation-widget.liquid](/d:/projects/count-on-us-donation-manager/extensions/count-on-us-product-widget/blocks/donation-widget.liquid)
- [cart-donation-summary.liquid](/d:/projects/count-on-us-donation-manager/extensions/count-on-us-product-widget/blocks/cart-donation-summary.liquid)

**Current behavior**
- Both extension entry points are theme app blocks with `"target": "section"`.
- Shopify Theme Editor `App embeds` is empty because we do not ship an embed block.

**Why it matters**
- Setup copy and checklist language still leans toward “enable the storefront widget” in a way merchants may read as an app embed.

**Recommendation**
- Decide whether the long-term product wants a true app embed.
- Short term, adjust copy everywhere to say “add the theme app block in Theme Editor” rather than implying an embed.

## Medium-Severity Gaps

### 4. Setup wizard still contains roadmap/manual truth gaps

**Status:** Partially implemented workflow

**Evidence**
- [setupWizard.server.ts](/d:/projects/count-on-us-donation-manager/app/services/setupWizard.server.ts)

**Current behavior**
- Managed Markets date is now real and derived.
- POD providers and storefront widget steps are still manual, because there is no reliable underlying truth source yet.

**Why it matters**
- Manual steps are acceptable, but only if the copy clearly states the feature state.
- Right now, the POD step points to a real but partial Provider Connections page.

**Recommendation**
- Keep manual steps where needed, but explicitly mark them as review-only or not-yet-automated.

### 5. Managed Markets behavior is saved, but not storefront-aware

**Status:** Partial implementation

**Evidence**
- [pending-questions.md](/d:/projects/count-on-us-donation-manager/docs/plans/pending-questions.md)
- current Settings flow stores the date, but downstream fee logic is still incomplete

**Current behavior**
- Merchants can now store the Managed Markets enable date.
- The broader fee-model behavior for storefront/customer-facing calculations is still unresolved.

**Why it matters**
- The setting now exists, but its downstream impact is still narrower than the wording may imply.

**Recommendation**
- Keep this as an explicit follow-up item, not an assumed-complete flow.

### 6. Adjustment service still cannot represent new order line items

**Status:** Known functional limitation

**Evidence**
- [adjustmentService.server.ts](/d:/projects/count-on-us-donation-manager/app/services/adjustmentService.server.ts)

**Current behavior**
- Notes explicitly say new order line items cannot yet be represented as adjustments.

**Why it matters**
- This is a real accounting limitation for some correction scenarios.

**Recommendation**
- Track it as an explicit enhancement rather than letting it remain a hidden service-level caveat.

### 7. `plan.detect` job is still a placeholder

**Status:** Non-critical placeholder logic

**Evidence**
- [processors.server.ts](/d:/projects/count-on-us-donation-manager/app/jobs/processors.server.ts)

**Current behavior**
- The job logs a Phase 1 placeholder message.

**Why it matters**
- Lower priority than reporting/storefront work, but it is still incomplete logic in a production-facing job file.

**Recommendation**
- Either remove the dead placeholder path or implement the intended plan-detection behavior.

## Submission / Operational Gaps

### 8. App Store submission fields are still incomplete

**Status:** Release blocker, not runtime blocker

**Evidence**
- [app-store-listing-draft.md](/d:/projects/count-on-us-donation-manager/docs/app-store-listing-draft.md)
- [app-store-technical-audit.md](/d:/projects/count-on-us-donation-manager/docs/app-store-technical-audit.md)

**Current behavior**
- Support email, support URL, privacy policy URL, DPA path, and similar owner-controlled fields are still TODOs.
- `compliance_topics` are still called out as missing in active app TOML configs.

**Why it matters**
- These do not break runtime behavior, but they block submission readiness.

**Recommendation**
- Resolve these on a dedicated submission-hardening pass before app review.

## Current-State Reality Check

### Implemented and working

- Embedded admin app navigation
- Settings, libraries, templates, variants, causes, products
- Reporting periods, disbursements, receipts, tax true-up, exports
- Order history and manual adjustments
- Audit log UI
- Product/cart storefront blocks
- Public donation receipts
- Thank You / Order Status donation extension
- Post-purchase donation email
- Setup wizard and checklist

### Implemented but still partial

- Shopify charge sync hardening
- Provider Connections foundation
- POD/provider completion
- Rolling cause payables follow-through across exports and broader reporting polish
- Managed Markets downstream fee logic
- Submission readiness docs/process

### Not actually implemented yet

- Full provider sync / mapping / real POD cost resolution
- Theme app embed

## Recommended Next Order

1. Keep product/UI honesty around Provider Connections and storefront widget wording aligned with current scope.
2. Complete the POD/provider workstream:
   - provider connection state
   - provider sync/cache
   - POD cost resolution in `CostEngine`
3. Resolve submission blockers:
   - `compliance_topics`
   - privacy policy URL
   - DPA path
   - support/contact details
4. Clean up lower-priority placeholders like `plan.detect` and adjustment-service limitations.
